/**
 * Tests for GET /api/horizon/events — Horizon staking events via ampd.
 * Mocks ampQuery + hasAmpAccess at the @/lib/amp boundary but keeps the real
 * pure helpers (TOPIC0, topicToAddress, hexToBigInt, strip0x, AmpError, etc.)
 * so the event decoding is exercised for real. Covers the no-access degrade,
 * input validation, delegator/provider event mapping, and the AmpError 502.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { TOPIC0, AmpError } from '@/lib/amp';

const ampQuery = vi.fn();
const hasAmpAccess = vi.fn(() => true);
vi.mock('@/lib/amp', async () => {
  const actual = await vi.importActual<typeof import('@/lib/amp')>('@/lib/amp');
  return {
    ...actual,
    ampQuery: (...a: unknown[]) => (ampQuery as (...a: unknown[]) => unknown)(...a),
    hasAmpAccess: () => hasAmpAccess(),
  };
});

// cache: pass-through so the real loader runs
vi.mock('@/lib/cache', () => ({
  cached: (_k: string, _t: number, f: () => unknown) => f(),
}));

vi.mock('@/lib/logger', () => ({
  log: { ingest: { warn: vi.fn(), error: vi.fn() } },
}));

async function load() {
  const mod = await import('@/app/api/horizon/events/route');
  return mod.GET as (req: NextRequest) => Promise<Response>;
}

function req(qs: string) {
  return new NextRequest(`http://localhost/api/horizon/events${qs}`);
}

const ADDR = '0x1111111111111111111111111111111111111111';

/** Build a 32-byte (64 hex) data field encoding a single uint256 amount. */
function dataWord(amountWei: bigint) {
  return '0x' + amountWei.toString(16).padStart(64, '0');
}
/** Pad a 20-byte address to a 32-byte topic. */
function topic(addr: string) {
  return '0x' + addr.slice(2).padStart(64, '0');
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  hasAmpAccess.mockReturnValue(true);
});

describe('horizon events guards', () => {
  it('503s when amp is not configured', async () => {
    hasAmpAccess.mockReturnValue(false);
    const GET = await load();
    const res = await GET(req(`?address=${ADDR}`));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'Amp not configured' });
    expect(ampQuery).not.toHaveBeenCalled();
  });

  it('400s on a missing/invalid address', async () => {
    const GET = await load();
    const res = await GET(req('?address=not-an-address'));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'Invalid address' });
  });

  it('400s on an invalid type', async () => {
    const GET = await load();
    const res = await GET(req(`?address=${ADDR}&type=banana`));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'type must be delegator or provider' });
  });
});

describe('delegator event mapping', () => {
  it('maps a TokensDelegated log into a delegated event with GRT amount', async () => {
    const sp = '0x2222222222222222222222222222222222222222';
    const verifier = '0x3333333333333333333333333333333333333333';
    ampQuery.mockResolvedValue([
      {
        block_num: 100,
        tx_hash: '0xtx1',
        log_index: 0,
        topic0: TOPIC0.TokensDelegated,
        topic1: topic(sp),
        topic2: topic(verifier),
        topic3: topic(ADDR),
        // first 32-byte word = tokens = 5 GRT (5e18 wei)
        data: dataWord(5n * 10n ** 18n),
      },
    ]);

    const GET = await load();
    const res = await GET(req(`?address=${ADDR}&type=delegator`));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
      type: 'delegated',
      block: 100,
      txHash: '0xtx1',
      serviceProvider: sp.toLowerCase(),
      verifier: verifier.toLowerCase(),
      delegator: ADDR,
      tokensGRT: 5,
    });
  });

  it('filters out unrecognised topic0 rows (parseDelegationEvent returns null)', async () => {
    ampQuery.mockResolvedValue([
      {
        block_num: 1, tx_hash: '0xz', log_index: 0,
        topic0: '0x' + 'ab'.repeat(32), // not a known delegation topic
        topic1: topic(ADDR), topic2: topic(ADDR), topic3: topic(ADDR),
        data: dataWord(1n),
      },
    ]);
    const GET = await load();
    const res = await GET(req(`?address=${ADDR}&type=delegator`));
    expect((await res.json()).data).toEqual([]);
  });
});

describe('provider event mapping', () => {
  it('maps a HorizonStakeDeposited log into a deposited stake event', async () => {
    ampQuery.mockResolvedValue([
      {
        block_num: 200,
        tx_hash: '0xtx2',
        log_index: 1,
        topic0: TOPIC0.HorizonStakeDeposited,
        topic1: topic(ADDR),
        topic2: '0x' + '0'.repeat(64),
        topic3: null,
        data: dataWord(2n * 10n ** 18n), // 2 GRT
      },
    ]);

    const GET = await load();
    const res = await GET(req(`?address=${ADDR}&type=provider`));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
      type: 'deposited',
      block: 200,
      txHash: '0xtx2',
      serviceProvider: ADDR,
      tokensGRT: 2,
    });
  });

  it('maps a ProvisionSlashed log via the fallthrough branch', async () => {
    ampQuery.mockResolvedValue([
      {
        block_num: 300, tx_hash: '0xtx3', log_index: 0,
        topic0: TOPIC0.ProvisionSlashed,
        topic1: topic(ADDR),
        topic2: topic('0x4444444444444444444444444444444444444444'),
        topic3: null,
        data: dataWord(10n ** 18n),
      },
    ]);
    const GET = await load();
    const res = await GET(req(`?address=${ADDR}&type=provider`));
    const { data } = await res.json();
    expect(data[0]).toMatchObject({
      type: 'provision_slashed',
      verifier: '0x4444444444444444444444444444444444444444',
      tokensGRT: 1,
    });
  });
});

describe('horizon events errors', () => {
  it('502s on an AmpError', async () => {
    ampQuery.mockRejectedValue(new AmpError('ampd 500', 500));
    const GET = await load();
    const res = await GET(req(`?address=${ADDR}&type=delegator`));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: 'Amp query failed', detail: 'ampd 500' });
  });

  it('500s on an unexpected error', async () => {
    ampQuery.mockRejectedValue(new Error('boom'));
    const GET = await load();
    const res = await GET(req(`?address=${ADDR}&type=delegator`));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: 'Failed to fetch horizon events' });
  });
});
