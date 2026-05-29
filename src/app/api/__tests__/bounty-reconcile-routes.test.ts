/**
 * Tests for the bounty reconciliation backend: the reconcile-bounties cron and
 * the hardened single-bounty PATCH. Both read the chain and mirror it into the
 * cache. Mocks are isolated to this file (separate from routes.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Env must be set before the route modules are imported (they capture it at load).
const BOARD = '0x1111111111111111111111111111111111111111';
process.env.NEXT_PUBLIC_BOUNTY_BOARD_ADDRESS = BOARD;
process.env.CRON_SECRET = 'test-secret';

const mockReadContract = vi.fn();
vi.mock('@/lib/reo-contract', () => ({
  arbitrumClient: { readContract: (...a: unknown[]) => mockReadContract(...a) },
}));

const mockListReconcilable = vi.fn();
const mockGetBounty = vi.fn();
const mockUpdateStatus = vi.fn();
vi.mock('@/lib/studio/db', () => ({
  listReconcilableBounties: (...a: unknown[]) => mockListReconcilable(...a),
  getBounty: (...a: unknown[]) => mockGetBounty(...a),
  updateBountyStatus: (...a: unknown[]) => mockUpdateStatus(...a),
}));

vi.mock('@/lib/db', () => ({ hasDbAccess: () => true, db: {} }));
vi.mock('@/lib/logger', () => ({
  log: { api: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

const WINNER = '0xAbC0000000000000000000000000000000000001';
const ZERO = '0x0000000000000000000000000000000000000000';

// A full on-chain Bounty tuple as viem would decode it.
function chainBounty(over: Partial<{ winner: string; settled: boolean; expiresAt: bigint }> = {}) {
  return {
    developer: '0xdev0000000000000000000000000000000000000',
    deploymentId: '0x' + '00'.repeat(32),
    amount: 1000n,
    postedAt: 1n,
    expiresAt: over.expiresAt ?? 0n,
    winner: over.winner ?? ZERO,
    settled: over.settled ?? false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('/api/cron/reconcile-bounties', () => {
  async function load() {
    const mod = await import('@/app/api/cron/reconcile-bounties/route');
    return mod.GET as (req: NextRequest) => Promise<Response>;
  }
  const authedReq = () =>
    new NextRequest('http://localhost/api/cron/reconcile-bounties', {
      headers: { authorization: 'Bearer test-secret' },
    });

  it('rejects unauthenticated requests with 401', async () => {
    const GET = await load();
    const res = await GET(new NextRequest('http://localhost/api/cron/reconcile-bounties'));
    expect(res.status).toBe(401);
    expect(mockListReconcilable).not.toHaveBeenCalled();
  });

  it('flips open → claimed when the chain shows a winner', async () => {
    mockListReconcilable.mockResolvedValueOnce([
      { id: 7, status: 'open', chain_bounty_id: '3', claimed_by: null },
    ]);
    mockReadContract.mockResolvedValueOnce(chainBounty({ settled: true, winner: WINNER }));

    const GET = await load();
    const res = await GET(authedReq());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.updated).toBe(1);
    expect(mockUpdateStatus).toHaveBeenCalledWith(7, 'claimed', WINNER.toLowerCase());
  });

  it('flips open → expired when unsettled and past expiry', async () => {
    const past = BigInt(Math.floor(Date.now() / 1000) - 60);
    mockListReconcilable.mockResolvedValueOnce([
      { id: 8, status: 'open', chain_bounty_id: '4', claimed_by: null },
    ]);
    mockReadContract.mockResolvedValueOnce(chainBounty({ settled: false, expiresAt: past }));

    const GET = await load();
    const res = await GET(authedReq());
    const json = await res.json();

    expect(json.updated).toBe(1);
    expect(mockUpdateStatus).toHaveBeenCalledWith(8, 'expired', undefined);
  });

  it('leaves an open, unsettled, non-expired bounty untouched', async () => {
    const future = BigInt(Math.floor(Date.now() / 1000) + 3600);
    mockListReconcilable.mockResolvedValueOnce([
      { id: 9, status: 'open', chain_bounty_id: '5', claimed_by: null },
    ]);
    mockReadContract.mockResolvedValueOnce(chainBounty({ settled: false, expiresAt: future }));

    const GET = await load();
    const res = await GET(authedReq());
    const json = await res.json();

    expect(json.updated).toBe(0);
    expect(mockUpdateStatus).not.toHaveBeenCalled();
  });

  it('continues past an RPC failure without aborting the run', async () => {
    mockListReconcilable.mockResolvedValueOnce([
      { id: 10, status: 'open', chain_bounty_id: '6', claimed_by: null },
      { id: 11, status: 'open', chain_bounty_id: '7', claimed_by: null },
    ]);
    mockReadContract
      .mockRejectedValueOnce(new Error('rpc down'))
      .mockResolvedValueOnce(chainBounty({ settled: true, winner: WINNER }));

    const GET = await load();
    const res = await GET(authedReq());
    const json = await res.json();

    expect(json.scanned).toBe(2);
    expect(json.updated).toBe(1);
    expect(mockUpdateStatus).toHaveBeenCalledWith(11, 'claimed', WINNER.toLowerCase());
  });
});

describe('PATCH /api/studio/bounties/[id]', () => {
  async function load() {
    const mod = await import('@/app/api/studio/bounties/[id]/route');
    return mod.PATCH as (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  }
  const req = () => new NextRequest('http://localhost/api/studio/bounties/1', { method: 'PATCH' });

  it('returns 404 for an unknown bounty', async () => {
    mockGetBounty.mockResolvedValueOnce(null);
    const PATCH = await load();
    const res = await PATCH(req(), { params: Promise.resolve({ id: '1' }) });
    expect(res.status).toBe(404);
  });

  it('returns 409 when the bounty has no on-chain id', async () => {
    mockGetBounty.mockResolvedValueOnce({ id: 1, status: 'open', chain_bounty_id: null, claimed_by: null });
    const PATCH = await load();
    const res = await PATCH(req(), { params: Promise.resolve({ id: '1' }) });
    expect(res.status).toBe(409);
  });

  it('marks claimed only when the chain confirms a winner', async () => {
    mockGetBounty.mockResolvedValueOnce({ id: 1, status: 'open', chain_bounty_id: '2', claimed_by: null });
    mockReadContract.mockResolvedValueOnce(chainBounty({ settled: true, winner: WINNER }));

    const PATCH = await load();
    const res = await PATCH(req(), { params: Promise.resolve({ id: '1' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.status).toBe('claimed');
    expect(mockUpdateStatus).toHaveBeenCalledWith(1, 'claimed', WINNER.toLowerCase());
  });

  it('does NOT mark claimed when the chain has no winner (anti-forgery)', async () => {
    mockGetBounty.mockResolvedValueOnce({ id: 1, status: 'open', chain_bounty_id: '2', claimed_by: null });
    mockReadContract.mockResolvedValueOnce(chainBounty({ settled: false }));

    const PATCH = await load();
    const res = await PATCH(req(), { params: Promise.resolve({ id: '1' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.status).toBe('open');
    expect(mockUpdateStatus).not.toHaveBeenCalled();
  });
});
