/**
 * Tests for /api/subgraph-history/[hash] - hash validation, the nest guard, empty result,
 * cumulative signal/stake aggregation, and error path. Inputs are the nest's two row sets
 * (nuthatch#1160); the gateway path left with the key.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const nuthatchSql = vi.fn();
const hasNuthatch = vi.fn(() => true);
vi.mock('@/lib/nuthatch', () => ({
  hasNuthatch: () => hasNuthatch(),
  nuthatchSqlReady: async (...a: unknown[]) => {
    const rows = await nuthatchSql(...a);
    return { ok: true, data: { rows, count: rows.length } };
  },
}));
/** Route the nest mock's two queries: signal transactions (curation events) and allocations. */
function nest(
  signals: { timestamp: number; type: string; tokens: string }[],
  allocations: { allocated_tokens: string; created_at: number; closed_at: number | null }[],
) {
  nuthatchSql.mockImplementation(async (sql: string) => {
    if (sql.includes('curation__signalled')) return signals;
    if (sql.includes('FROM lodestar_allocations')) return allocations;
    return [];
  });
}
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
  hasNuthatch.mockReturnValue(true);
});

describe('/api/subgraph-history validation', () => {
  it('400 on invalid hash', async () => {
    const GET = await load();
    const res = await call(GET, 'not-a-hash');
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/Invalid deployment hash/i);
    expect(nuthatchSql).not.toHaveBeenCalled();
  });

  it('503 when no nest is configured', async () => {
    hasNuthatch.mockReturnValue(false);
    const GET = await load();
    const res = await call(GET, VALID_HASH);
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toMatch(/Nuthatch is not configured/i);
  });
});

describe('/api/subgraph-history aggregation', () => {
  it('returns empty history when no signal txs and no allocations', async () => {
    nest([], []);
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
    nest(
      [
        { timestamp: start, type: 'MintSignal', tokens: '100000000000000000000' }, // +100 GRT
        { timestamp: start + 7 * 24 * 3600, type: 'BurnSignal', tokens: '40000000000000000000' }, // -40
      ],
      [{ allocated_tokens: '500000000000000000000', created_at: start, closed_at: null }], // 500 GRT, still open
    );
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
    nest(
      [{ timestamp: start, type: 'MintSignal', tokens: '100000000000000000000' }],
      [{ allocated_tokens: '500000000000000000000', created_at: start, closed_at: start + 1 }],
    );
    const GET = await load();
    const res = await call(GET, VALID_HASH);
    const json = await res.json();
    const history = json.data.history as { stakeGrt: number }[];
    // allocation closed almost immediately -> last bucket has no live stake
    expect(history[history.length - 1].stakeGrt).toBe(0);
  });

  it('500 when the nest query throws', async () => {
    nuthatchSql.mockRejectedValueOnce(new Error('boom'));
    const GET = await load();
    const res = await call(GET, VALID_HASH);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toMatch(/Failed to fetch subgraph history/i);
  });
});
