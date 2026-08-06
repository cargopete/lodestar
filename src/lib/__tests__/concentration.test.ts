import { describe, it, expect } from 'vitest';
import { gini, nakamoto, computeConcentration, type IndexerAllocation } from '../concentration';

describe('gini', () => {
  it('is 0 for a perfectly equal distribution', () => {
    expect(gini([10, 10, 10, 10])).toBeCloseTo(0, 9);
  });
  it('matches the known value for [1,2,3,4] = 0.25', () => {
    expect(gini([1, 2, 3, 4])).toBeCloseTo(0.25, 9);
  });
  it('approaches high concentration when one dominates', () => {
    expect(gini([1, 1, 1, 1, 1, 95])).toBeGreaterThan(0.7);
  });
  it('ignores zeros and handles empty', () => {
    expect(gini([])).toBe(0);
    expect(gini([0, 0, 5])).toBe(0); // single positive → trivially equal
  });
});

describe('nakamoto', () => {
  it('counts the minimum holders to exceed 50%', () => {
    expect(nakamoto([25, 25, 25, 25])).toBe(3); // 2 = exactly 50% (not >50), need 3
    expect(nakamoto([60, 10, 10, 10, 10])).toBe(1);
  });
  it('handles empty/zero total', () => {
    expect(nakamoto([])).toBe(0);
  });
});

describe('computeConcentration', () => {
  const rows: IndexerAllocation[] = [
    { allocated_grt: 100, q_score: 80 }, // good
    { allocated_grt: 50, q_score: 5 }, // zero
    { allocated_grt: 30, q_score: 20 }, // low
    { allocated_grt: 20, q_score: null }, // unscored
  ];

  it('buckets allocation by quality tier with correct shares', () => {
    const c = computeConcentration(rows);
    expect(c.totalAllocatedGrt).toBe(200);
    const byTier = Object.fromEntries(c.tiers.map((t) => [t.tier, t.alloc_share]));
    expect(byTier.good).toBeCloseTo(0.5, 9);
    expect(byTier.zero).toBeCloseTo(0.25, 9);
    expect(byTier.low).toBeCloseTo(0.15, 9);
    expect(byTier.unscored).toBeCloseTo(0.1, 9);
  });

  it('computes the crowded-out (low-value) share + counterfactual uplift', () => {
    const c = computeConcentration(rows);
    // zero(50) + low(30) = 80 of 200. The unscored 20 is NOT crowding — see below.
    expect(c.lowValueGrt).toBe(80);
    expect(c.lowValueShare).toBeCloseTo(0.4, 9);
    // removing 40% → productive rewards scale by 1/(1-0.4) ≈ 1.667×
    expect(c.productiveUpliftFactor).toBeCloseTo(1 / 0.6, 9);
  });

  it('computes top-N share', () => {
    const c = computeConcentration(rows, 2);
    expect(c.topN).toBe(2);
    // top 2 allocations: 100 + 50 = 150 of 200
    expect(c.topNShare).toBeCloseTo(0.75, 9);
  });

  /**
   * Unmeasured allocation is a gap in coverage, never evidence of low value.
   *
   * It used to count as crowding, back when "unscored" meant the gateway had never routed to them.
   * Under the Lodestar Oracle it means "we have not probed them", and most of the network is in
   * that state — so counting it would assert that two thirds of the network's stake is worthless
   * on the strength of us not having looked.
   */
  it('does not count unmeasured allocation as crowding', () => {
    const c = computeConcentration([
      { allocated_grt: 1000, q_score: null },
      { allocated_grt: 1000, q_score: 90 },
    ]);
    expect(c.lowValueShare).toBe(0);
    expect(c.unmeasuredShare).toBeCloseTo(0.5, 9);
    // No measured low-value allocation means no counterfactual uplift to claim.
    expect(c.productiveUpliftFactor).toBeCloseTo(1, 9);
  });
});
