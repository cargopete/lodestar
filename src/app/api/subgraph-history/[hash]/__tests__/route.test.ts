/**
 * Tests for /api/subgraph-history/[hash] — hash validation, access guard,
 * empty result, cumulative signal/stake aggregation, and error path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const subgraphQuery = vi.fn();
const hasSubgraphAccess = vi.fn(() => true);
vi.mock('@/lib/subgraph', () => ({
  subgraphQuery: (...a: unknown[]) => subgraphQuery(...a),
  hasSubgraphAccess: () => hasSubgraphAccess(),
}));
vi.mock('@/lib/cache', () => ({
  cached: vi.fn((_k: string, _t: number, f: () => unknown) => f()),
}));
vi.mock('@/lib/logger', () => ({ log: { api: { error: vi.fn() } } }));

const VALID_HASH = 'Qm123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijk';

async function load() {
  const mod = await import('@/app/api/subgraph-history/[hash]/route');
  return mod.GET as (
    req: NextRequest,
    ctx: { params: Promise<{ hash: string }> },
  ) => Promise<Response>;
}

function call(GET: Awaited<ReturnType<typeof load>>, hash: string) {
  return GET(new NextRequest('http://localhost/api/subgraph-history/x'), {
    params: Promise.resolve({ hash }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  hasSubgraphAccess.mockReturnValue(true);
});

describe('/api/subgraph-history validation', () => {
  it('400 on invalid hash', async () => {
    const GET = await load();
    const res = await call(GET, 'not-a-hash');
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/Invalid deployment hash/i);
    expect(subgraphQuery).not.toHaveBeenCalled();
  });

  it('503 when no subgraph access', async () => {
    hasSubgraphAccess.mockReturnValue(false);
    const GET = await load();
    const res = await call(GET, VALID_HASH);
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toMatch(/No API key/i);
  });
});

describe('/api/subgraph-history aggregation', () => {
  it('returns empty history when no signal txs and no allocations', async () => {
    subgraphQuery.mockResolvedValueOnce({ signalTransactions: [], allocations: [] });
    const GET = await load();
    const res = await call(GET, VALID_HASH);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.history).toEqual([]);
  });

  it('builds weekly cumulative signal + stake series', async () => {
    const now = Math.floor(Date.now() / 1000);
    const sixWeeks = 6 * 7 * 24 * 3600;
    const start = now - sixWeeks;
    subgraphQuery.mockResolvedValueOnce({
      signalTransactions: [
        { timestamp: start, type: 'MintSignal', tokens: '100000000000000000000' }, // +100 GRT
        { timestamp: start + 7 * 24 * 3600, type: 'BurnSignal', tokens: '40000000000000000000' }, // -40
      ],
      allocations: [
        { allocatedTokens: '500000000000000000000', createdAt: start, closedAt: null }, // 500 GRT, still open
      ],
    });
    const GET = await load();
    const res = await call(GET, VALID_HASH);
    expect(res.status).toBe(200);
    const json = await res.json();
    const history = json.data.history as { date: string; signalGrt: number; stakeGrt: number }[];
    expect(history.length).toBeGreaterThan(0);
    // every point is shaped correctly
    for (const p of history) {
      expect(typeof p.date).toBe('string');
      expect(p.signalGrt).toBeGreaterThanOrEqual(0);
      expect(p.stakeGrt).toBeGreaterThanOrEqual(0);
    }
    // open allocation contributes 500 GRT stake at the latest point
    const last = history[history.length - 1];
    expect(last.stakeGrt).toBeCloseTo(500, 3);
    // cumulative signal after mint+burn = 60 GRT at the end
    expect(last.signalGrt).toBeCloseTo(60, 3);
  });

  it('excludes allocations closed before the bucket timestamp', async () => {
    const now = Math.floor(Date.now() / 1000);
    const start = now - 4 * 7 * 24 * 3600;
    subgraphQuery.mockResolvedValueOnce({
      signalTransactions: [
        { timestamp: start, type: 'MintSignal', tokens: '100000000000000000000' },
      ],
      allocations: [
        { allocatedTokens: '500000000000000000000', createdAt: start, closedAt: start + 1 },
      ],
    });
    const GET = await load();
    const res = await call(GET, VALID_HASH);
    const json = await res.json();
    const history = json.data.history as { stakeGrt: number }[];
    // allocation closed almost immediately -> last bucket has no live stake
    expect(history[history.length - 1].stakeGrt).toBe(0);
  });

  it('500 when subgraphQuery throws', async () => {
    subgraphQuery.mockRejectedValueOnce(new Error('boom'));
    const GET = await load();
    const res = await call(GET, VALID_HASH);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toMatch(/Failed to fetch subgraph history/i);
  });
});
