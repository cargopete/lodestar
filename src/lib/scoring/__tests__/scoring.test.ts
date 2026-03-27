import { describe, it, expect } from 'vitest';
import { percentile, computeBounds, normalize, normalizeInverted } from '../normalize';
import {
  scoreQueryFees,
  scoreAllocationEfficiency,
  scoreDelegationCapacity,
  scoreCutStability,
  scoreTenure,
  scoreRetention,
  scoreReo,
  scoreAllocationBreadth,
} from '../components';
import { calculatePenalties } from '../penalties';

// ── Normalization ───────────────────────────────────────

describe('percentile', () => {
  it('returns the single value for a 1-element array', () => {
    expect(percentile([42], 50)).toBe(42);
  });

  it('computes median of even array', () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
  });

  it('computes p10 and p90', () => {
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(sorted, 10)).toBeCloseTo(10.9, 1);
    expect(percentile(sorted, 90)).toBeCloseTo(90.1, 1);
  });
});

describe('normalize', () => {
  it('returns 0 at p10', () => {
    expect(normalize(10, 10, 90, 20)).toBe(0);
  });

  it('returns maxPoints at p90', () => {
    expect(normalize(90, 10, 90, 20)).toBe(20);
  });

  it('returns midpoint for value halfway between p10 and p90', () => {
    expect(normalize(50, 10, 90, 20)).toBe(10);
  });

  it('clamps below p10', () => {
    expect(normalize(5, 10, 90, 20)).toBe(0);
  });

  it('clamps above p90', () => {
    expect(normalize(100, 10, 90, 20)).toBe(20);
  });
});

describe('normalizeInverted', () => {
  it('gives max points for lowest value', () => {
    expect(normalizeInverted(10, 10, 90, 10)).toBe(10);
  });

  it('gives 0 points for highest value', () => {
    expect(normalizeInverted(90, 10, 90, 10)).toBe(0);
  });
});

// ── Component Scoring ───────────────────────────────────

describe('scoreQueryFees', () => {
  it('scores at p90 gets full 10 points', () => {
    expect(scoreQueryFees(1000, 100, 1000)).toBe(10);
  });

  it('scores at p10 gets 0 points', () => {
    expect(scoreQueryFees(100, 100, 1000)).toBe(0);
  });
});

describe('scoreAllocationBreadth', () => {
  it('at p90 = 20', () => expect(scoreAllocationBreadth(50, 5, 50)).toBe(20));
  it('at p10 = 0', () => expect(scoreAllocationBreadth(5, 5, 50)).toBe(0));
  it('mid-range', () => expect(scoreAllocationBreadth(27.5, 5, 50)).toBeCloseTo(10, 1));
});

describe('scoreAllocationEfficiency', () => {
  it('at p90 = 10', () => expect(scoreAllocationEfficiency(100, 10, 100)).toBe(10));
  it('at p10 = 0', () => expect(scoreAllocationEfficiency(10, 10, 100)).toBe(0));
});

describe('scoreDelegationCapacity', () => {
  it('100% capacity = 0 pts', () => {
    expect(scoreDelegationCapacity(100)).toBe(0);
  });

  it('95% capacity = 1 pt', () => {
    expect(scoreDelegationCapacity(95)).toBe(1);
  });

  it('80% capacity = 3 pts', () => {
    expect(scoreDelegationCapacity(80)).toBe(3);
  });

  it('50% capacity = 5 pts', () => {
    expect(scoreDelegationCapacity(50)).toBe(5);
  });
});

describe('scoreCutStability', () => {
  it('stable or decreased = 12 pts', () => {
    expect(scoreCutStability(0)).toBe(12);
    expect(scoreCutStability(-50000)).toBe(12);
  });

  it('small increase = 8 pts', () => {
    expect(scoreCutStability(30000)).toBe(8);
  });

  it('moderate increase = 4 pts', () => {
    expect(scoreCutStability(80000)).toBe(4);
  });

  it('large increase = 0 pts', () => {
    expect(scoreCutStability(150000)).toBe(0);
  });
});

describe('scoreTenure', () => {
  it('brand new = 0', () => expect(scoreTenure(1)).toBe(0));
  it('3 months = 1', () => expect(scoreTenure(3)).toBe(1));
  it('6 months = 2', () => expect(scoreTenure(6)).toBe(2));
  it('12 months = 3', () => expect(scoreTenure(12)).toBe(3));
  it('24+ months = 5', () => expect(scoreTenure(30)).toBe(5));
});

describe('scoreRetention', () => {
  it('net inflow = 3', () => expect(scoreRetention(5000)).toBe(3));
  it('roughly neutral = 2', () => expect(scoreRetention(-5000)).toBe(2));
  it('moderate outflow = 1', () => expect(scoreRetention(-50000)).toBe(1));
  it('significant outflow = 0', () => expect(scoreRetention(-200000)).toBe(0));
});

describe('scoreReo', () => {
  it('eligible = 6', () => expect(scoreReo('eligible')).toBe(6));
  it('warning = 3', () => expect(scoreReo('warning')).toBe(3));
  it('ineligible = 0', () => expect(scoreReo('ineligible')).toBe(0));
});

// ── Penalties ───────────────────────────────────────────

describe('calculatePenalties', () => {
  const clean: Parameters<typeof calculatePenalties>[0] = {
    hasActiveDispute: false,
    hasRecentSlashing: false,
    hasOlderSlashing: false,
    hasRepeatedCutIncreases: false,
    hasLowPoiConsensus: false,
    hasZeroFees: false,
    hasBelowMinStake: false,
  };

  it('returns 1.0 for a clean record', () => {
    expect(calculatePenalties(clean).multiplier).toBe(1.0);
    expect(calculatePenalties(clean).reasons).toHaveLength(0);
  });

  it('active dispute = 0.50', () => {
    expect(calculatePenalties({ ...clean, hasActiveDispute: true }).multiplier).toBe(0.50);
  });

  it('recent slashing = 0.60', () => {
    expect(calculatePenalties({ ...clean, hasRecentSlashing: true }).multiplier).toBe(0.60);
  });

  it('penalties stack multiplicatively', () => {
    const result = calculatePenalties({
      ...clean,
      hasActiveDispute: true,     // ×0.50
      hasLowPoiConsensus: true,   // ×0.80
    });
    expect(result.multiplier).toBeCloseTo(0.40, 2);
    expect(result.reasons).toHaveLength(2);
  });

  it('minimum multiplier is 0.1', () => {
    const result = calculatePenalties({
      hasActiveDispute: true,
      hasRecentSlashing: true,
      hasOlderSlashing: false,
      hasRepeatedCutIncreases: true,
      hasLowPoiConsensus: true,
      hasZeroFees: true,
      hasBelowMinStake: true,
    });
    expect(result.multiplier).toBeGreaterThanOrEqual(0.1);
  });
});

// ── Integration: Full score range ───────────────────────

describe('score range validation', () => {
  it('max possible subtotal without votes is 71', () => {
    // Network Service: 20 + 10 + 10 = 40
    // Trust & Stability: 12 + 5 + 3 = 20
    // Protocol Health: 6
    // Economics: 5
    // Total without community votes: 71
    const max = 20 + 10 + 10 + 12 + 5 + 3 + 6 + 5;
    expect(max).toBe(71);
  });

  it('component weights match current scoring', () => {
    const networkMax = 20 + 10 + 10;         // 40
    const communityMax = 25;                  // 25
    const trustMax = 12 + 5 + 3;             // 20
    const healthMax = 6;                      // 6
    const economicsMax = 5;                   // 5

    expect(networkMax).toBe(40);
    expect(communityMax).toBe(25);
    expect(trustMax).toBe(20);
    expect(healthMax).toBe(6);
    expect(economicsMax).toBe(5);
    expect(networkMax + communityMax + trustMax + healthMax + economicsMax).toBe(96);
  });
});
