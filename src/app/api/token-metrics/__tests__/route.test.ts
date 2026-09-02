/**
 * GET /api/token-metrics — no successful empty series, ever.
 *
 * This route had the fault twice: the access guard and the catch-all both answered `200 { data: []
 * }`. A subgraph outage, a malformed response and a genuinely empty range therefore all drew the
 * same flat line on the chart (#36). `fetchTokenMetrics` throws on a non-OK response, so the fix
 * turns that flat line into a visible error state rather than changing nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const subgraphQuery = vi.fn();
const hasSubgraphAccess = vi.fn(() => true);
const hasDbAccess = vi.fn(() => false);
const dbTag = vi.fn();

vi.mock('@/lib/subgraph', () => ({
  subgraphQuery: (...a: unknown[]) => subgraphQuery(...a),
  hasSubgraphAccess: () => hasSubgraphAccess(),
}));
vi.mock('@/lib/db', () => ({
  hasDbAccess: () => hasDbAccess(),
  get db() {
    return dbTag;
  },
}));
vi.mock('@/lib/cache', () => ({
  cached: (_k: string, _t: number, f: () => Promise<unknown>) => f(),
}));
vi.mock('@/lib/logger', () => ({ log: { api: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } } }));

import { GET } from '../route';

const call = (qs = '') => GET(new NextRequest(`http://localhost/api/token-metrics${qs}`));

const EPOCH = {
  id: '700',
  totalRewards: '2000000000000000000',
  taxedQueryFees: '500000000000000000',
};

beforeEach(() => {
  vi.clearAllMocks();
  hasSubgraphAccess.mockReturnValue(true);
  hasDbAccess.mockReturnValue(false);
});

describe('/api/token-metrics', () => {
  it('503s rather than returning an empty series when there is no gateway key', async () => {
    hasSubgraphAccess.mockReturnValue(false);
    const res = await call();

    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toMatch(/No API key/i);
    expect(json.data).toBeUndefined();
    expect(subgraphQuery).not.toHaveBeenCalled();
  });

  it('500s rather than returning an empty series when the source fails', async () => {
    subgraphQuery.mockRejectedValue(new Error('gateway exploded'));
    const res = await call();

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Failed to load token metrics');
    expect(json.data).toBeUndefined();
  });

  it('does not leak the underlying error to the caller', async () => {
    subgraphQuery.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:5432'));
    const body = await (await call()).json();
    expect(JSON.stringify(body)).not.toContain('10.0.0.5');
  });

  it('serves a genuinely empty series as a successful empty array', async () => {
    // The case the two failures above exist to stay distinguishable from.
    subgraphQuery.mockResolvedValue({ epoches: [] });
    const res = await call();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [] });
  });

  it('shapes a datapoint from the subgraph, converting out of wei', async () => {
    subgraphQuery.mockResolvedValue({ epoches: [EPOCH] });
    const { data } = await (await call()).json();

    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
      epoch: 700,
      issuance: 2,
      queryFeeTaxBurn: 0.5,
      disputeBurn: 0,
      totalBurn: 0.5,
      net: 1.5,
    });
  });

  it.each(['999999', '-1', 'abc', '', '101'])(
    'falls back to 100 for count=%s rather than interpolating it',
    async (bad) => {
      // The count reaches a GraphQL string by interpolation, so the allowlist is the only thing
      // between a caller and an arbitrary `first:` value.
      subgraphQuery.mockResolvedValue({ epoches: [] });
      await call(`?count=${bad}`);

      expect(subgraphQuery.mock.calls[0][0]).toContain('first: 100');
      expect(subgraphQuery.mock.calls[0][0]).not.toContain(bad === '' ? 'first: NaN' : `first: ${bad}`);
    },
  );

  it('accepts an allowed count', async () => {
    subgraphQuery.mockResolvedValue({ epoches: [] });
    await call('?count=200');
    expect(subgraphQuery.mock.calls[0][0]).toContain('first: 200');
  });
});
