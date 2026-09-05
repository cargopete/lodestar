/**
 * `api/indexer-stake-history` from `lodestar_indexer_ledger` (nightswatchhq/nuthatch#1160). Pinned
 * here: the flag off changes nothing; the nest path never consults the gateway key; 27 weekly Unix
 * cutoffs reach the SQL and come back as dated GRT points, oldest first; an unready nest is a 503.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/cache', () => ({
  cached: vi.fn((_k: string, _t: number, f: () => Promise<unknown>) => f()),
}));
const hasSubgraphAccess = vi.fn(() => false);
const subgraphQuery = vi.fn();
vi.mock('@/lib/subgraph', () => ({
  hasSubgraphAccess: () => hasSubgraphAccess(),
  subgraphQuery: (...a: unknown[]) => subgraphQuery(...a),
}));
const nuthatchSqlReady = vi.fn();
let nuthatchConfigured = true;
vi.mock('@/lib/nuthatch', () => ({
  hasNuthatch: () => nuthatchConfigured,
  nuthatchEnabled: (flag: string) => nuthatchConfigured && process.env[flag] === 'true',
  nuthatchSqlReady: (...a: unknown[]) => nuthatchSqlReady(...a),
}));
vi.mock('@/lib/logger', () => ({ log: { api: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } } }));

import { GET } from '../route';

const ADDR = '0x6f9bb7e454f5b3eb2310343f0e99269dc2bb8a1d';
const ok = (rows: unknown[]) => ({ ok: true, data: { count: rows.length, rows, truncated: false } });
const req = () => GET(new NextRequest(`http://localhost/api/indexer-stake-history/${ADDR}`), { params: Promise.resolve({ address: ADDR }) });

describe('api/indexer-stake-history from the nest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nuthatchConfigured = true;
    process.env.NUTHATCH_INDEXERS = 'true';
  });
  afterEach(() => {
    delete process.env.NUTHATCH_INDEXERS;
  });

  it('with the flag off, the gateway path is untouched', async () => {
    delete process.env.NUTHATCH_INDEXERS;
    hasSubgraphAccess.mockReturnValue(true);
    subgraphQuery.mockResolvedValueOnce({ _meta: { block: { number: 500_000_000 } } }).mockResolvedValueOnce({});
    const res = await req();
    expect(res.status).toBe(200);
    expect(subgraphQuery).toHaveBeenCalledTimes(2);
    expect(nuthatchSqlReady).not.toHaveBeenCalled();
  });

  it('27 weekly cutoffs reach the SQL and come back as dated GRT points, oldest first', async () => {
    nuthatchSqlReady.mockImplementation((sql: string) => {
      const cutoffs = [...sql.matchAll(/\((\d{9,})\)/g)].map((m) => Number(m[1]));
      return Promise.resolve(ok(cutoffs.map((c, i) => ({ cutoff: c, staked_tokens: `${(i + 1) * 1000}000000000000000000`, delegated_tokens: `${i * 10}000000000000000000` }))));
    });
    const res = await req();
    expect(res.status).toBe(200);
    expect(hasSubgraphAccess).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.source).toBe('nuthatch');
    expect(body.data.history).toHaveLength(27);
    expect(body.data.history[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.data.history[0].selfStakeGrt).toBeCloseTo(1000, 6);
    expect(body.data.history[0].delegatedGrt).toBeCloseTo(0, 6);
    expect(body.data.history[26].selfStakeGrt).toBeCloseTo(27000, 6);
    // dates ascend a week apart
    const d0 = new Date(body.data.history[0].date).getTime(); const d1 = new Date(body.data.history[1].date).getTime();
    expect(Math.round((d1 - d0) / 86400000)).toBe(7);
    const sql = nuthatchSqlReady.mock.calls[0][0] as string;
    expect(sql).toContain('FROM lodestar_indexer_ledger');
    // the delegated series is pool plus thawing, the subgraph's per-indexer figure
    expect(sql).toContain('SUM(pool_delta) + SUM(thawing_delta)');
    expect(sql).toContain(`l.indexer = '${ADDR}'`);
    expect((sql.match(/\(\d{9,}\)/g) ?? []).length).toBe(27);
    expect(nuthatchSqlReady.mock.calls[0][1]).toBe('/alloc');
  });

  it('an unready nest is a 503 with no fallback to the gateway', async () => {
    nuthatchSqlReady.mockResolvedValue({ ok: false, status: 503, error: 'nest is not ready: stalled' });
    const res = await req();
    expect(res.status).toBe(503);
    expect(subgraphQuery).not.toHaveBeenCalled();
  });
});
