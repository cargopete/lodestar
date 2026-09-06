/**
 * Tests for /api/cron/tap-provision — Bearer CRON_SECRET auth, config/skip
 * guards, claimed-bounty → indexer resolution, and escrow provisioning loop.
 * All external boundaries (db, chain client, subgraph, tap, ipfs) are mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// --- db: tagged-template fn behind a getter so we can swap it per-test ---
const mockSql = vi.fn();
const hasDbAccess = vi.fn(() => true);
vi.mock('@/lib/db', () => ({
  db: (..._a: unknown[]) => mockSql(),
  hasDbAccess: () => hasDbAccess(),
}));

const readContract = vi.fn();
vi.mock('@/lib/reo-contract', () => ({ arbitrumClient: { readContract: (...a: unknown[]) => readContract(...a) } }));
vi.mock('@/lib/bountyBoard', () => ({ BOUNTY_BOARD_ABI: [] }));

const nuthatchSql = vi.fn();
let nuthatchConfigured = true;
vi.mock('@/lib/nuthatch', () => ({
  hasNuthatch: () => nuthatchConfigured,
  nuthatchEnabled: (flag: string) => nuthatchConfigured && process.env[flag] === 'true',
  nuthatchSql: (...a: unknown[]) => nuthatchSql(...a),
}));

vi.mock('@/lib/studio/ipfs', () => ({ ipfsHashToBytes32: (h: string) => `0x${h}` }));

const hasTapSigner = vi.fn(() => true);
const getEscrowBalance = vi.fn();
const ensureEscrow = vi.fn();
vi.mock('@/lib/tap', () => ({
  hasTapSigner: () => hasTapSigner(),
  getEscrowBalance: (...a: unknown[]) => getEscrowBalance(...a),
  ensureEscrow: (...a: unknown[]) => ensureEscrow(...a),
  MIN_ESCROW_WEI: 1_000_000_000_000_000_000n,
}));

vi.mock('@/lib/logger', () => ({
  log: { cron: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

const SECRET = 'tap-secret';
const ZERO = '0x0000000000000000000000000000000000000000';

async function load() {
  const mod = await import('@/app/api/cron/tap-provision/route');
  return mod.GET as (req: NextRequest) => Promise<Response>;
}

function req(auth?: string) {
  return new NextRequest('http://localhost/api/cron/tap-provision', {
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  process.env.CRON_SECRET = SECRET;
  process.env.NEXT_PUBLIC_BOUNTY_BOARD_ADDRESS = '0x00000000000000000000000000000000000000bb';
  hasDbAccess.mockReturnValue(true);
  hasTapSigner.mockReturnValue(true);
});

afterEach(() => {
  delete process.env.CRON_SECRET;
  delete process.env.NEXT_PUBLIC_BOUNTY_BOARD_ADDRESS;
});

describe('auth + config guards', () => {
  it('401 without bearer token', async () => {
    const GET = await load();
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it('401 with wrong token', async () => {
    const GET = await load();
    const res = await GET(req('Bearer nope'));
    expect(res.status).toBe(401);
  });

  it('401 when CRON_SECRET unset (fail-closed)', async () => {
    delete process.env.CRON_SECRET;
    const GET = await load();
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(401);
  });

  it('skips when TAP signer not configured', async () => {
    hasTapSigner.mockReturnValue(false);
    const GET = await load();
    const res = await GET(req(`Bearer ${SECRET}`));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.skipped).toBe(true);
    expect(json.reason).toMatch(/TAP_SIGNER/);
  });

  it('503 when DB unavailable', async () => {
    hasDbAccess.mockReturnValue(false);
    const GET = await load();
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(503);
  });
});

describe('bounty board config guard', () => {
  it('skips when BOUNTY_BOARD address is unset', async () => {
    // module reads the env var at import time → reset modules & unset first
    delete process.env.NEXT_PUBLIC_BOUNTY_BOARD_ADDRESS;
    vi.resetModules();
    const GET = await load();
    const res = await GET(req(`Bearer ${SECRET}`));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.skipped).toBe(true);
    expect(json.reason).toMatch(/BOUNTY_BOARD/);
  });
});

describe('main path', () => {
  it('returns note when there are no claimed bounties', async () => {
    mockSql.mockResolvedValueOnce([]);
    const GET = await load();
    const res = await GET(req(`Bearer ${SECRET}`));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.note).toMatch(/no claimed bounties/);
    expect(json.provisioned).toEqual({});
  });

  it('reports sufficient escrow without depositing', async () => {
    mockSql.mockResolvedValueOnce([{ chain_bounty_id: '1', deployment_id: 'Qm1' }]);
    // resolveIndexers: getBounty returns a winner with a URL in the subgraph
    readContract.mockResolvedValueOnce({ winner: '0x00000000000000000000000000000000000000a1' });
    nuthatchSql.mockResolvedValueOnce([{ url: 'https://idx.example.com' }]);
    getEscrowBalance.mockResolvedValueOnce(2_000_000_000_000_000_000n); // 2 GRT >= 1
    const GET = await load();
    const res = await GET(req(`Bearer ${SECRET}`));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.provisioned['0x00000000000000000000000000000000000000a1']).toBe('sufficient');
    expect(ensureEscrow).not.toHaveBeenCalled();
  });

  it('deposits when balance below the minimum', async () => {
    mockSql.mockResolvedValueOnce([{ chain_bounty_id: '1', deployment_id: 'Qm1' }]);
    readContract.mockResolvedValueOnce({ winner: '0x00000000000000000000000000000000000000a1' });
    nuthatchSql.mockResolvedValueOnce([{ url: 'https://idx.example.com' }]);
    getEscrowBalance.mockResolvedValueOnce(0n);
    ensureEscrow.mockResolvedValueOnce(undefined);
    const GET = await load();
    const res = await GET(req(`Bearer ${SECRET}`));
    const json = await res.json();
    expect(json.provisioned['0x00000000000000000000000000000000000000a1']).toBe('deposited');
    expect(ensureEscrow).toHaveBeenCalledWith('0x00000000000000000000000000000000000000a1');
  });

  it('records an error string when provisioning throws', async () => {
    mockSql.mockResolvedValueOnce([{ chain_bounty_id: '1', deployment_id: 'Qm1' }]);
    readContract.mockResolvedValueOnce({ winner: '0x00000000000000000000000000000000000000a1' });
    nuthatchSql.mockResolvedValueOnce([{ url: 'https://idx.example.com' }]);
    getEscrowBalance.mockRejectedValueOnce(new Error('rpc timeout'));
    const GET = await load();
    const res = await GET(req(`Bearer ${SECRET}`));
    const json = await res.json();
    expect(json.provisioned['0x00000000000000000000000000000000000000a1']).toMatch(/error: rpc timeout/);
  });

  it('falls back to active allocations when winner has no URL', async () => {
    mockSql.mockResolvedValueOnce([{ chain_bounty_id: '1', deployment_id: 'Qm1' }]);
    readContract.mockResolvedValueOnce({ winner: '0x00000000000000000000000000000000000000a1' });
    // winner has no url
    nuthatchSql
      .mockResolvedValueOnce([{ url: null }])
      // active-allocation scan returns one indexer with a URL
      .mockResolvedValueOnce([{ id: '0x00000000000000000000000000000000000000B2', url: 'https://b2.example.com' }]);
    getEscrowBalance.mockResolvedValue(5_000_000_000_000_000_000n);
    const GET = await load();
    const res = await GET(req(`Bearer ${SECRET}`));
    const json = await res.json();
    // resolved to the lowercased fallback indexer, not the winner
    expect(json.provisioned['0x00000000000000000000000000000000000000b2']).toBe('sufficient');
    expect(json.provisioned['0x00000000000000000000000000000000000000a1']).toBeUndefined();
  });

  it('emits empty provisioned map when winner is the zero address', async () => {
    mockSql.mockResolvedValueOnce([{ chain_bounty_id: '1', deployment_id: 'Qm1' }]);
    readContract.mockResolvedValueOnce({ winner: ZERO });
    const GET = await load();
    const res = await GET(req(`Bearer ${SECRET}`));
    const json = await res.json();
    expect(json.provisioned).toEqual({});
    expect(getEscrowBalance).not.toHaveBeenCalled();
  });

  it('deduplicates the same indexer across multiple bounties', async () => {
    mockSql.mockResolvedValueOnce([
      { chain_bounty_id: '1', deployment_id: 'Qm1' },
      { chain_bounty_id: '2', deployment_id: 'Qm2' },
    ]);
    readContract
      .mockResolvedValueOnce({ winner: '0x00000000000000000000000000000000000000a1' })
      .mockResolvedValueOnce({ winner: '0x00000000000000000000000000000000000000a1' });
    getEscrowBalance.mockResolvedValue(5_000_000_000_000_000_000n);
    const GET = await load();
    await GET(req(`Bearer ${SECRET}`));
    expect(getEscrowBalance).toHaveBeenCalledTimes(1);
  });

  it('behind NUTHATCH_INDEXERS both lookups read the nest and the gateway is never asked (nuthatch#1160)', async () => {
    nuthatchConfigured = true;
    process.env.NUTHATCH_INDEXERS = 'true';
    try {
      mockSql.mockResolvedValueOnce([{ chain_bounty_id: '1', deployment_id: 'Qm1' }]);
      readContract.mockResolvedValueOnce({ winner: '0x00000000000000000000000000000000000000a1' });
      nuthatchSql
        .mockResolvedValueOnce([{ url: null }]) // the winner has no URL on the nest
        .mockResolvedValueOnce([{ id: '0x00000000000000000000000000000000000000B2', url: 'https://b2.example.com' }]);
      getEscrowBalance.mockResolvedValue(5_000_000_000_000_000_000n);
      const GET = await load();
      const res = await GET(req(`Bearer ${SECRET}`));
      const json = await res.json();
      expect(nuthatchSql).toHaveBeenCalledTimes(2);
      expect(nuthatchSql.mock.calls[0][0]).toBe("SELECT url FROM lodestar_indexers WHERE id = '0x00000000000000000000000000000000000000a1'");
      expect(nuthatchSql.mock.calls[1][0]).toContain("LOWER(a.subgraph_deployment) = '0xqm1'");
      expect(nuthatchSql.mock.calls.every((c) => c[1] === '/alloc')).toBe(true);
      expect(json.provisioned['0x00000000000000000000000000000000000000b2']).toBe('sufficient');
      expect(json.provisioned['0x00000000000000000000000000000000000000a1']).toBeUndefined();
    } finally {
      nuthatchConfigured = false;
      delete process.env.NUTHATCH_INDEXERS;
    }
  });
});
