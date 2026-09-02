/**
 * GET /api/network-health — the QoS leaderboard, plus concentration and clustering over the whole
 * allocated set.
 *
 * Three SQL results are folded into four summary numbers, and every one of those numbers is the
 * kind that gets quoted at people. The failures worth pinning are the ones that still produce a
 * number:
 *
 *  - the median. Taken over the *scored* rows, not all of them, because the query orders with
 *    `NULLS LAST` and an unscored tail would drag a median taken over everything.
 *  - `flaggedGap` and `failing`, which are thresholds. An unscored row must not count as failing,
 *    for the same reason it must not count as a zero anywhere else on this surface.
 *  - the concentration and cluster inputs, which are deliberately taken over *all* allocated
 *    indexers including the never-routed ones. Narrowing them to the scored set would quietly
 *    make the network look less concentrated than it is.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const hasDbAccess = vi.fn(() => true);
const db = vi.fn();
vi.mock('@/lib/db', () => ({
  hasDbAccess: () => hasDbAccess(),
  get db() {
    return hasDbAccess() ? (...a: unknown[]) => db(...a) : null;
  },
}));

const computeConcentration = vi.fn();
const detectClusters = vi.fn();
vi.mock('@/lib/concentration', () => ({
  computeConcentration: (...a: unknown[]) => computeConcentration(...a),
}));
vi.mock('@/lib/clustering', () => ({ detectClusters: (...a: unknown[]) => detectClusters(...a) }));

vi.mock('@/lib/cache', () => ({
  cached: (_k: string, _t: number, f: () => Promise<unknown>) => f(),
}));
vi.mock('@/lib/logger', () => ({ log: { api: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } } }));

import { GET } from '../route';

/** A leaderboard row, with only the fields the folding actually reads spelled out. */
function scored(q_score: number | null, served_gap: number | null = 0) {
  return { address: `0x${Math.random().toString(16).slice(2, 10)}`, q_score, served_gap };
}

/** Queue the three reads the route makes, in order: leaderboard, allocations, cluster input. */
function reads(leaderboard: unknown[], allocs: unknown[] = [], clusterInput: unknown[] = []) {
  db.mockResolvedValueOnce(leaderboard).mockResolvedValueOnce(allocs).mockResolvedValueOnce(clusterInput);
}

const summary = async () => (await (await GET()).json()).data.summary;

beforeEach(() => {
  vi.clearAllMocks();
  hasDbAccess.mockReturnValue(true);
  computeConcentration.mockReturnValue({ gini: 0.5 });
  detectClusters.mockReturnValue([]);
  db.mockResolvedValue([]);
});

describe('the guard', () => {
  it('503s without a database rather than reporting an empty network', async () => {
    hasDbAccess.mockReturnValue(false);
    const res = await GET();
    expect(res.status).toBe(503);
    expect(db).not.toHaveBeenCalled();
  });
});

describe('the summary', () => {
  it('counts only the scored rows as the total', async () => {
    reads([scored(90), scored(null), scored(40)]);
    expect((await summary()).total).toBe(2);
  });

  it('takes the median over the scored rows only', async () => {
    // The query sorts descending with NULLS LAST, so the unscored tail sits at the end and would
    // pull a median taken over the whole list downward.
    reads([scored(90), scored(50), scored(10), scored(null), scored(null)]);
    expect((await summary()).medianQ).toBe(50);
  });

  it('reports a median of zero when nothing is scored, rather than undefined', async () => {
    reads([scored(null), scored(null)]);
    const s = await summary();
    expect(s.medianQ).toBe(0);
    expect(s.total).toBe(0);
  });

  it('flags a served gap above 0.3 and treats a null gap as no gap', async () => {
    reads([scored(80, 0.31), scored(80, 0.3), scored(80, null), scored(80, 0.9)]);
    expect((await summary()).flaggedGap).toBe(2);
  });

  it('counts a Q below 30 as failing, and an unscored indexer as neither', async () => {
    reads([scored(29.9), scored(30), scored(0), scored(null)]);
    const s = await summary();
    expect(s.failing).toBe(2);
    expect(s.total).toBe(3);
  });
});

describe('the network-wide reads', () => {
  it('hands concentration every allocated indexer, including the unscored ones', async () => {
    const allocs = [
      { allocated_grt: 1000, q_score: 90 },
      { allocated_grt: 5000, q_score: null },
    ];
    reads([scored(90)], allocs, []);

    await GET();
    expect(computeConcentration).toHaveBeenCalledWith(allocs);
  });

  it('hands the clusterer its own query result', async () => {
    const clusterInput = [{ address: '0xa', deployments: ['Qm1'] }];
    reads([], [], clusterInput);

    await GET();
    expect(detectClusters).toHaveBeenCalledWith(clusterInput);
  });

  it('returns the leaderboard rows untouched alongside the derived figures', async () => {
    const leaderboard = [scored(90), scored(50)];
    detectClusters.mockReturnValue([{ members: ['0xa', '0xb'] }]);
    reads(leaderboard, [], []);

    const { data } = await (await GET()).json();
    expect(data.indexers).toHaveLength(2);
    expect(data.concentration).toEqual({ gini: 0.5 });
    expect(data.clusters).toEqual([{ members: ['0xa', '0xb'] }]);
  });
});

describe('the envelope', () => {
  it('carries the half-hour cache header', async () => {
    const res = await GET();
    expect(res.headers.get('Cache-Control')).toBe('public, s-maxage=1800, stale-while-revalidate=3600');
  });

  it('500s when a query fails', async () => {
    db.mockRejectedValue(new Error('statement timeout'));
    const res = await GET();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/failed to fetch/i);
  });
});
