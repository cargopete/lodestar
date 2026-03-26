import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { calculateIndexerScore, SCORE_WEIGHTS, type ScoreInput } from '../risk-score';

// Fix Date.now for deterministic cut stability tests
const FIXED_NOW = 1711382400000; // 2024-03-25T12:00:00Z
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(FIXED_NOW); });
afterEach(() => { vi.useRealTimers(); });

function toUnix(daysAgo: number): number {
  return Math.floor(FIXED_NOW / 1000) - daysAgo * 86400;
}

function makeInput(overrides: Partial<ScoreInput> = {}): ScoreInput {
  return {
    reoStatus: 'eligible',
    reoDaysRemaining: 30,
    reoSource: 'oracle',
    selfStakeGRT: 1_000_000,
    lastDelegationParameterUpdate: toUnix(180),
    delegatorParameterCooldown: 86400,
    allocationCount: 5,
    allocatedTokens: '500000000000000000000000', // 500K
    provisionedGRT: 1_000_000,
    delegationUtilization: 50,
    ensName: 'indexer.eth',
    url: 'https://example.com',
    name: 'My Indexer',
    id: '0x1234567890abcdef',
    rewardCutPPM: 100_000,
    queryFeeCutPPM: 100_000,
    queryFeesCollectedGRT: 50_000,
    netFlowGRT: 10_000,
    delegatedGRT: 500_000,
    ...overrides,
  };
}

// ---------- weights ----------

describe('SCORE_WEIGHTS', () => {
  it('sum to 100', () => {
    const total = Object.values(SCORE_WEIGHTS).reduce((s, w) => s + w, 0);
    expect(total).toBe(100);
  });
});

// ---------- REO dimension ----------

describe('REO scoring', () => {
  it('scores 100 for oracle-eligible with plenty of runway', () => {
    const { breakdown } = calculateIndexerScore(makeInput({
      reoStatus: 'eligible', reoDaysRemaining: 30, reoSource: 'oracle',
    }));
    expect(breakdown.reo).toBe(100);
  });

  it('scores 80 for 3-6 days remaining', () => {
    const { breakdown } = calculateIndexerScore(makeInput({
      reoStatus: 'eligible', reoDaysRemaining: 5, reoSource: 'oracle',
    }));
    expect(breakdown.reo).toBe(80);
  });

  it('scores 60 for 1-2 days remaining', () => {
    const { breakdown } = calculateIndexerScore(makeInput({
      reoStatus: 'eligible', reoDaysRemaining: 1, reoSource: 'oracle',
    }));
    expect(breakdown.reo).toBe(60);
  });

  it('scores 20 for eligible but 0 days (overdue)', () => {
    const { breakdown } = calculateIndexerScore(makeInput({
      reoStatus: 'eligible', reoDaysRemaining: 0, reoSource: 'oracle',
    }));
    expect(breakdown.reo).toBe(20);
  });

  it('scores 0 for ineligible', () => {
    const { breakdown } = calculateIndexerScore(makeInput({ reoStatus: 'ineligible' }));
    expect(breakdown.reo).toBe(0);
  });

  it('scores 50 for heuristic-eligible', () => {
    const { breakdown } = calculateIndexerScore(makeInput({
      reoStatus: 'eligible', reoSource: 'heuristic',
    }));
    expect(breakdown.reo).toBe(50);
  });

  it('scores 25 for unknown status', () => {
    const { breakdown } = calculateIndexerScore(makeInput({ reoStatus: 'unknown' }));
    expect(breakdown.reo).toBe(25);
  });
});

// ---------- Self-stake dimension ----------

describe('self-stake scoring', () => {
  it('scores 100 for 10M+ GRT', () => {
    const { breakdown } = calculateIndexerScore(makeInput({ selfStakeGRT: 15_000_000 }));
    expect(breakdown.selfStake).toBe(100);
  });

  it('scores 80 for 1M GRT', () => {
    const { breakdown } = calculateIndexerScore(makeInput({ selfStakeGRT: 1_000_000 }));
    expect(breakdown.selfStake).toBe(80);
  });

  it('scores 35 for 100K GRT (minimum)', () => {
    const { breakdown } = calculateIndexerScore(makeInput({ selfStakeGRT: 100_000 }));
    expect(breakdown.selfStake).toBe(35);
  });

  it('scores 0 for zero stake', () => {
    const { breakdown } = calculateIndexerScore(makeInput({ selfStakeGRT: 0 }));
    expect(breakdown.selfStake).toBe(0);
  });

  it('interpolates between anchors', () => {
    const { breakdown } = calculateIndexerScore(makeInput({ selfStakeGRT: 750_000 }));
    // Between 500K(65) and 1M(80), at 50% → ~73
    expect(breakdown.selfStake).toBeGreaterThan(65);
    expect(breakdown.selfStake).toBeLessThan(80);
  });
});

// ---------- Cut stability dimension ----------

describe('cut stability scoring', () => {
  it('scores 100 for 180+ days unchanged with cooldown', () => {
    const { breakdown } = calculateIndexerScore(makeInput({
      lastDelegationParameterUpdate: toUnix(200),
      delegatorParameterCooldown: 86400,
    }));
    expect(breakdown.cutStability).toBe(100);
  });

  it('scores 95 for 90+ days with cooldown', () => {
    const { breakdown } = calculateIndexerScore(makeInput({
      lastDelegationParameterUpdate: toUnix(100),
      delegatorParameterCooldown: 86400,
    }));
    expect(breakdown.cutStability).toBe(95);
  });

  it('scores 10 for recent change without cooldown', () => {
    const { breakdown } = calculateIndexerScore(makeInput({
      lastDelegationParameterUpdate: toUnix(2),
      delegatorParameterCooldown: 0,
    }));
    expect(breakdown.cutStability).toBe(10);
  });

  it('adds 10 bonus for having cooldown set', () => {
    const withCooldown = calculateIndexerScore(makeInput({
      lastDelegationParameterUpdate: toUnix(45),
      delegatorParameterCooldown: 86400,
    }));
    const withoutCooldown = calculateIndexerScore(makeInput({
      lastDelegationParameterUpdate: toUnix(45),
      delegatorParameterCooldown: 0,
    }));
    expect(withCooldown.breakdown.cutStability)
      .toBe(withoutCooldown.breakdown.cutStability + 10);
  });
});

// ---------- Allocation efficiency dimension ----------

describe('allocation efficiency scoring', () => {
  it('scores 0 for no allocations', () => {
    const { breakdown } = calculateIndexerScore(makeInput({ allocationCount: 0 }));
    expect(breakdown.allocationEfficiency).toBe(0);
  });

  it('scores 40 for allocations but no provision data', () => {
    const { breakdown } = calculateIndexerScore(makeInput({
      allocationCount: 3,
      provisionedGRT: null,
    }));
    expect(breakdown.allocationEfficiency).toBe(40);
  });

  it('scores 100 for 80%+ utilisation', () => {
    const { breakdown } = calculateIndexerScore(makeInput({
      allocationCount: 5,
      allocatedTokens: '900000000000000000000000', // 900K
      provisionedGRT: 1_000_000,
    }));
    expect(breakdown.allocationEfficiency).toBe(100);
  });

  it('scores 20 for very low utilisation', () => {
    const { breakdown } = calculateIndexerScore(makeInput({
      allocationCount: 1,
      allocatedTokens: '100000000000000000000000', // 100K
      provisionedGRT: 1_000_000,
    }));
    expect(breakdown.allocationEfficiency).toBe(20);
  });
});

// ---------- Over-delegation dimension ----------

describe('over-delegation scoring', () => {
  it('scores 0 for 100% utilisation', () => {
    const { breakdown } = calculateIndexerScore(makeInput({ delegationUtilization: 100 }));
    expect(breakdown.overDelegation).toBe(0);
  });

  it('scores 100 for low utilisation (<50%)', () => {
    const { breakdown } = calculateIndexerScore(makeInput({ delegationUtilization: 30 }));
    expect(breakdown.overDelegation).toBe(100);
  });

  it('scores 55 for 70% utilisation', () => {
    const { breakdown } = calculateIndexerScore(makeInput({ delegationUtilization: 70 }));
    expect(breakdown.overDelegation).toBe(55);
  });

  it('scores 15 for 95% utilisation', () => {
    const { breakdown } = calculateIndexerScore(makeInput({ delegationUtilization: 95 }));
    expect(breakdown.overDelegation).toBe(15);
  });
});

// ---------- Transparency dimension ----------

describe('transparency scoring', () => {
  it('scores 100 for all present', () => {
    const { breakdown } = calculateIndexerScore(makeInput({
      ensName: 'test.eth', url: 'https://x.com', name: 'Display Name', id: '0x123',
    }));
    expect(breakdown.transparency).toBe(100);
  });

  it('scores 0 for nothing present', () => {
    const { breakdown } = calculateIndexerScore(makeInput({
      ensName: null, url: null, name: '0x123', id: '0x123',
    }));
    expect(breakdown.transparency).toBe(0);
  });

  it('scores 40 for ENS only', () => {
    const { breakdown } = calculateIndexerScore(makeInput({
      ensName: 'test.eth', url: null, name: '0x123', id: '0x123',
    }));
    expect(breakdown.transparency).toBe(40);
  });

  it('scores 30 for URL only', () => {
    const { breakdown } = calculateIndexerScore(makeInput({
      ensName: null, url: 'https://x.com', name: '0x123', id: '0x123',
    }));
    expect(breakdown.transparency).toBe(30);
  });

  it('scores 30 for display name only', () => {
    const { breakdown } = calculateIndexerScore(makeInput({
      ensName: null, url: null, name: 'My Indexer', id: '0x123',
    }));
    expect(breakdown.transparency).toBe(30);
  });
});

// ---------- Query volume dimension ----------

describe('query volume scoring', () => {
  it('scores 100 for 100K+ GRT in fees', () => {
    const { breakdown } = calculateIndexerScore(makeInput({
      queryFeesCollectedGRT: 200_000,
    }));
    expect(breakdown.queryVolume).toBe(100);
  });

  it('scores 90 for 50K GRT', () => {
    const { breakdown } = calculateIndexerScore(makeInput({
      queryFeesCollectedGRT: 50_000,
    }));
    expect(breakdown.queryVolume).toBe(90);
  });

  it('scores 0 for zero fees', () => {
    const { breakdown } = calculateIndexerScore(makeInput({
      queryFeesCollectedGRT: 0,
    }));
    expect(breakdown.queryVolume).toBe(0);
  });

  it('interpolates between anchors', () => {
    const { breakdown } = calculateIndexerScore(makeInput({
      queryFeesCollectedGRT: 5_000,
    }));
    // Between 1K(50) and 10K(70), at 44.4% → ~59
    expect(breakdown.queryVolume).toBeGreaterThan(50);
    expect(breakdown.queryVolume).toBeLessThan(70);
  });
});

// ---------- Delegator cut dimension ----------

describe('delegator cut scoring', () => {
  it('scores 100 for 0% reward cut and 0% query fee cut', () => {
    const { breakdown } = calculateIndexerScore(makeInput({
      rewardCutPPM: 0, queryFeeCutPPM: 0,
    }));
    expect(breakdown.delegatorCut).toBe(100);
  });

  it('scores 85 for 10% reward cut, 0% query fee cut', () => {
    const { breakdown } = calculateIndexerScore(makeInput({
      rewardCutPPM: 100_000, queryFeeCutPPM: 0,
    }));
    expect(breakdown.delegatorCut).toBe(85);
  });

  it('scores 0 for 100% reward cut', () => {
    const { breakdown } = calculateIndexerScore(makeInput({
      rewardCutPPM: 1_000_000, queryFeeCutPPM: 0,
    }));
    expect(breakdown.delegatorCut).toBe(0);
  });

  it('applies query fee cut penalty', () => {
    const withoutFeeCut = calculateIndexerScore(makeInput({
      rewardCutPPM: 100_000, queryFeeCutPPM: 0,
    }));
    const withFeeCut = calculateIndexerScore(makeInput({
      rewardCutPPM: 100_000, queryFeeCutPPM: 1_000_000,
    }));
    // 100% query fee cut = -15 penalty
    expect(withoutFeeCut.breakdown.delegatorCut - withFeeCut.breakdown.delegatorCut).toBe(15);
  });

  it('scores ~58 for 17.5% reward cut + 100% query fee cut (p2p-org case)', () => {
    const { breakdown } = calculateIndexerScore(makeInput({
      rewardCutPPM: 175_000, queryFeeCutPPM: 1_000_000,
    }));
    // 17.5% reward cut ≈ 71, minus 15 for 100% query fee cut ≈ 56
    expect(breakdown.delegatorCut).toBeGreaterThan(50);
    expect(breakdown.delegatorCut).toBeLessThan(65);
  });

  it('never goes below 0', () => {
    const { breakdown } = calculateIndexerScore(makeInput({
      rewardCutPPM: 900_000, queryFeeCutPPM: 1_000_000,
    }));
    expect(breakdown.delegatorCut).toBeGreaterThanOrEqual(0);
  });
});

// ---------- Delegation trend dimension ----------

describe('delegation trend scoring', () => {
  it('scores 100 for strong inflow (>2%)', () => {
    const { breakdown } = calculateIndexerScore(makeInput({
      netFlowGRT: 20_000, delegatedGRT: 500_000,
    }));
    expect(breakdown.delegationTrend).toBe(100);
  });

  it('scores 50 for no delegation history', () => {
    const { breakdown } = calculateIndexerScore(makeInput({
      netFlowGRT: 0, delegatedGRT: 0,
    }));
    expect(breakdown.delegationTrend).toBe(50);
  });

  it('scores 0 for severe outflow (>3%)', () => {
    const { breakdown } = calculateIndexerScore(makeInput({
      netFlowGRT: -20_000, delegatedGRT: 500_000,
    }));
    expect(breakdown.delegationTrend).toBe(0);
  });

  it('scores 60 for zero net flow', () => {
    const { breakdown } = calculateIndexerScore(makeInput({
      netFlowGRT: 0, delegatedGRT: 500_000,
    }));
    expect(breakdown.delegationTrend).toBe(60);
  });
});

// ---------- Composite & grading ----------

describe('composite score', () => {
  it('produces a weighted average within 0-100', () => {
    const { composite } = calculateIndexerScore(makeInput());
    expect(composite).toBeGreaterThanOrEqual(0);
    expect(composite).toBeLessThanOrEqual(100);
  });

  it('grades A for high composite (≥80)', () => {
    const result = calculateIndexerScore(makeInput());
    // With our good defaults, this should be A-grade
    expect(result.composite).toBeGreaterThanOrEqual(80);
    expect(result.grade).toBe('A');
  });

  it('grades F for terrible indexer', () => {
    const result = calculateIndexerScore(makeInput({
      reoStatus: 'ineligible',
      selfStakeGRT: 0,
      lastDelegationParameterUpdate: toUnix(1),
      delegatorParameterCooldown: 0,
      allocationCount: 0,
      delegationUtilization: 100,
      ensName: null,
      url: null,
      name: '0x123',
      id: '0x123',
      netFlowGRT: -50_000,
      delegatedGRT: 500_000,
    }));
    expect(result.composite).toBeLessThan(35);
    expect(result.grade).toBe('F');
  });

  it('composite is rounded integer', () => {
    const { composite } = calculateIndexerScore(makeInput());
    expect(composite).toBe(Math.round(composite));
  });
});
