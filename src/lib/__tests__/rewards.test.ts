import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  calculateExchangeRate,
  calculateUnrealizedRewards,
  calculateEstimatedAPR,
  calculateDelegatorAPR,
  calculateDelegationCapacity,
  calculateThawingRemaining,
  deriveDelegationStatus,
  formatThawingTime,
  generateRewardsCSV,
  calculatePoolExchangeRate,
  calculateExchangeRateAPY,
  calculateRollingAPY,
  calculateDelegatorAPRBreakdown,
} from '../rewards';

// ---------- calculateExchangeRate ----------

describe('calculateExchangeRate', () => {
  it('returns ratio of tokens to shares', () => {
    // 2000 GRT tokens, 1000 GRT shares → rate = 2.0
    const rate = calculateExchangeRate(
      '2000000000000000000000',
      '1000000000000000000000',
    );
    expect(rate).toBeCloseTo(2.0);
  });

  it('returns 1 when shares are zero', () => {
    expect(calculateExchangeRate('1000000000000000000000', '0')).toBe(1);
  });

  it('returns 1 for equal tokens and shares', () => {
    const rate = calculateExchangeRate(
      '1000000000000000000000',
      '1000000000000000000000',
    );
    expect(rate).toBeCloseTo(1.0);
  });
});

// ---------- calculateUnrealizedRewards ----------

describe('calculateUnrealizedRewards', () => {
  it('calculates positive unrealized rewards', () => {
    // Staked 1000 GRT, got 1000 shares, now pool is 2000 tokens / 1000 shares
    // Current value = 1000 * 2 = 2000, unrealized = 2000 - 1000 = 1000
    const rewards = calculateUnrealizedRewards(
      '1000000000000000000000',  // 1000 GRT staked
      '1000000000000000000000',  // 1000 shares
      '2000000000000000000000',  // 2000 total tokens in pool
      '1000000000000000000000',  // 1000 total shares
    );
    expect(rewards).toBeCloseTo(1000);
  });

  it('returns 0 when current value equals original stake', () => {
    const rewards = calculateUnrealizedRewards(
      '1000000000000000000000',
      '1000000000000000000000',
      '1000000000000000000000',
      '1000000000000000000000',
    );
    expect(rewards).toBe(0);
  });

  it('returns 0 when current value is less than original (never negative)', () => {
    // Edge case: shouldn't happen normally but guard against negative
    const rewards = calculateUnrealizedRewards(
      '2000000000000000000000',  // staked 2000
      '1000000000000000000000',  // got 1000 shares
      '1000000000000000000000',  // pool now only 1000 tokens
      '1000000000000000000000',
    );
    expect(rewards).toBe(0);
  });
});

// ---------- calculateEstimatedAPR ----------

describe('calculateEstimatedAPR', () => {
  it('calculates APR correctly', () => {
    // 100K annual rewards, 10% cut, 1M delegated, user has 100K
    // Delegation pool: 100K * 0.9 = 90K
    // User share: 90K * (100K/1M) = 9K
    // APR: 9K / 100K * 100 = 9%
    const apr = calculateEstimatedAPR(100_000, 100_000, 1_000_000, 100_000);
    expect(apr).toBeCloseTo(9.0);
  });

  it('returns 0 when user delegation is 0', () => {
    expect(calculateEstimatedAPR(100_000, 100_000, 1_000_000, 0)).toBe(0);
  });

  it('returns 0 when total delegated is 0', () => {
    expect(calculateEstimatedAPR(100_000, 100_000, 0, 100_000)).toBe(0);
  });

  it('handles zero cut (all rewards to delegators)', () => {
    // 100K rewards, 0% cut, 1M delegated, user has 100K
    // APR: (100K * 100K/1M) / 100K * 100 = 10%
    const apr = calculateEstimatedAPR(100_000, 0, 1_000_000, 100_000);
    expect(apr).toBeCloseTo(10.0);
  });

  it('handles maximum cut', () => {
    // 1M PPM = 100% cut → 0 rewards for delegators
    const apr = calculateEstimatedAPR(100_000, 1_000_000, 1_000_000, 100_000);
    expect(apr).toBeCloseTo(0);
  });
});

// ---------- calculateDelegatorAPR ----------

describe('calculateDelegatorAPR', () => {
  const baseAllocations = [
    {
      allocatedTokens: '500000000000000000000000', // 500K
      subgraphDeployment: {
        signalledTokens: '100000000000000000000000', // 100K signal
        stakedTokens: '1000000000000000000000000',  // 1M stake
      },
    },
  ];

  it('calculates APR from allocations', () => {
    const apr = calculateDelegatorAPR(
      baseAllocations,
      100_000, // 10% cut
      1_000_000, // 1M delegated
      10_000_000, // 10M total network signal
      300_000_000, // 300M annual issuance
    );
    expect(apr).toBeGreaterThan(0);
  });

  it('returns 0 with no delegated tokens', () => {
    expect(calculateDelegatorAPR(baseAllocations, 100_000, 0, 10_000_000, 300_000_000)).toBe(0);
  });

  // ---------- calculateDelegatorAPRBreakdown ----------

  it('breakdown: apr equals numerator / active base × 100 (below the 100% cap)', () => {
    // 100M issuance keeps the raw APR (~45%) under the cap so the identity holds.
    const b = calculateDelegatorAPRBreakdown(
      baseAllocations, 100_000, 1_000_000, 10_000_000, 100_000_000,
    );
    expect(b.annualDelegatorRewards).toBeGreaterThan(0);
    expect(b.activeBase).toBe(1_000_000);
    expect(b.apr).toBeLessThan(100);
    expect(b.apr).toBeCloseTo((b.annualDelegatorRewards / b.activeBase) * 100, 5);
  });

  it('breakdown: legacy (1−rawCut) and Horizon ratios agree when NOT over-delegated', () => {
    // delegatedStakeRatio × (1 − effectiveCut) == (1 − rawCut) when uncapped.
    // rawCut 10%; ownStakeRatio 0.2 ⇒ delegatedStakeRatio 0.8;
    // effectiveCut = (0.1 − 0.2)/0.8 is negative, so use a realistic uncapped case:
    // rawCut 0.3, ownStakeRatio 0.1 ⇒ delegatedStakeRatio 0.9, effectiveCut = (0.3−0.1)/0.9 = 0.2222
    const legacy = calculateDelegatorAPRBreakdown(baseAllocations, 300_000, 1_000_000, 10_000_000, 300_000_000);
    const horizon = calculateDelegatorAPRBreakdown(
      baseAllocations, 300_000, 1_000_000, 10_000_000, 300_000_000,
      (0.3 - 0.1) / 0.9, // effectiveCut
      0.9,               // delegatedStakeRatio
    );
    expect(horizon.apr).toBeCloseTo(legacy.apr, 4);
  });

  it('breakdown: over-delegation yields LOWER delegator rewards than naive (1−rawCut)', () => {
    // When over-delegated, effective cut rises above raw cut, so the delegator
    // share shrinks vs the naive (1 − rawCut) approximation.
    const naive = calculateDelegatorAPRBreakdown(baseAllocations, 100_000, 1_000_000, 10_000_000, 300_000_000);
    const overDelegated = calculateDelegatorAPRBreakdown(
      baseAllocations, 100_000, 1_000_000, 10_000_000, 300_000_000,
      0.5,  // effectiveCut well above the 10% raw cut → capped stake earns nothing
      0.95, // delegatedStakeRatio
    );
    expect(overDelegated.annualDelegatorRewards).toBeLessThan(naive.annualDelegatorRewards);
    expect(overDelegated.effectiveCut).toBe(0.5);
    expect(overDelegated.rawCut).toBeCloseTo(0.1, 6);
  });

  it('returns 0 with no allocations', () => {
    expect(calculateDelegatorAPR([], 100_000, 1_000_000, 10_000_000, 300_000_000)).toBe(0);
  });

  it('returns 0 with no network signal', () => {
    expect(calculateDelegatorAPR(baseAllocations, 100_000, 1_000_000, 0, 300_000_000)).toBe(0);
  });

  it('filters out allocations with zero signal or stake', () => {
    const allocations = [
      ...baseAllocations,
      {
        allocatedTokens: '500000000000000000000000',
        subgraphDeployment: {
          signalledTokens: '0',
          stakedTokens: '1000000000000000000000000',
        },
      },
    ];
    const apr = calculateDelegatorAPR(allocations, 100_000, 1_000_000, 10_000_000, 300_000_000);
    // Should only count the first allocation
    const aprSingle = calculateDelegatorAPR(baseAllocations, 100_000, 1_000_000, 10_000_000, 300_000_000);
    expect(apr).toBeCloseTo(aprSingle);
  });

  it('caps outlier signal-to-stake ratios at P95', () => {
    // Create allocations where one has a wildly high signal-to-stake ratio
    const allocations = [];
    for (let i = 0; i < 20; i++) {
      allocations.push({
        allocatedTokens: '100000000000000000000000',
        subgraphDeployment: {
          signalledTokens: '100000000000000000000000',  // 100K signal
          stakedTokens: '1000000000000000000000000',    // 1M stake → ratio 0.1
        },
      });
    }
    // Add one extreme outlier
    allocations.push({
      allocatedTokens: '100000000000000000000000',
      subgraphDeployment: {
        signalledTokens: '10000000000000000000000000', // 10M signal
        stakedTokens: '100000000000000000000000',      // 100K stake → ratio 100
      },
    });

    const aprCapped = calculateDelegatorAPR(allocations, 100_000, 1_000_000, 10_000_000, 300_000_000);

    // Without P95 cap, the outlier would dominate. With cap, it should be reasonable
    expect(aprCapped).toBeGreaterThan(0);
    expect(aprCapped).toBeLessThan(100_000); // Sanity check — not astronomical
  });
});

// ---------- calculatePoolExchangeRate ----------

describe('calculatePoolExchangeRate', () => {
  it('returns rate excluding thawing tokens', () => {
    // 2000 GRT tokens, 200 GRT thawing, 1000 GRT shares → (2000-200)/1000 = 1.8
    const rate = calculatePoolExchangeRate(
      '2000000000000000000000',
      '200000000000000000000',
      '1000000000000000000000',
    );
    expect(rate).toBeCloseTo(1.8);
  });

  it('returns 1 when shares are zero', () => {
    expect(calculatePoolExchangeRate('1000000000000000000000', '0', '0')).toBe(1);
  });

  it('matches basic exchange rate when no thawing', () => {
    const rate = calculatePoolExchangeRate(
      '2000000000000000000000',
      '0',
      '1000000000000000000000',
    );
    expect(rate).toBeCloseTo(2.0);
  });
});

// ---------- calculateExchangeRateAPY ----------

describe('calculateExchangeRateAPY', () => {
  it('calculates APY from rate growth', () => {
    // Rate grew from 1.0 to 1.1 over 30 days
    // yield = 0.1/1.0 = 10% in 30 days
    // APY = ((1.1/1.0)^(365/30) - 1) * 100
    const apy = calculateExchangeRateAPY(1.1, 1.0, 30);
    expect(apy).toBeGreaterThan(100); // >100% annualised from 10% monthly
    expect(apy).toBeCloseTo(218.9, 0); // (1.1^(365/30) - 1) * 100
  });

  it('returns 0 when rate did not grow', () => {
    expect(calculateExchangeRateAPY(1.0, 1.0, 30)).toBe(0);
  });

  it('returns 0 when rate declined (slashing)', () => {
    expect(calculateExchangeRateAPY(0.95, 1.0, 30)).toBe(0);
  });

  it('returns 0 for zero historical rate', () => {
    expect(calculateExchangeRateAPY(1.1, 0, 30)).toBe(0);
  });

  it('returns 0 for zero current rate', () => {
    expect(calculateExchangeRateAPY(0, 1.0, 30)).toBe(0);
  });

  it('returns 0 for zero window', () => {
    expect(calculateExchangeRateAPY(1.1, 1.0, 0)).toBe(0);
  });

  it('produces reasonable APY for typical indexer growth', () => {
    // ~0.8% growth over 90 days → ~3.2% annualised APY
    const apy = calculateExchangeRateAPY(1.008, 1.0, 90);
    expect(apy).toBeGreaterThan(3);
    expect(apy).toBeLessThan(4);
  });
});

// ---------- calculateRollingAPY ----------

describe('calculateRollingAPY', () => {
  const now = Math.floor(Date.now() / 1000);
  const recentAlloc = { delegator_rewards_grt: 1000, closed_at: now - 10 * 86400 }; // 10 days ago
  const oldAlloc = { delegator_rewards_grt: 2000, closed_at: now - 60 * 86400 };   // 60 days ago

  it('returns 0 when no delegated GRT', () => {
    expect(calculateRollingAPY([recentAlloc], 0, 30)).toBe(0);
  });

  it('returns 0 when no allocations', () => {
    expect(calculateRollingAPY([], 100_000, 30)).toBe(0);
  });

  it('returns 0 when delegatedGRT is negative', () => {
    expect(calculateRollingAPY([recentAlloc], -1, 30)).toBe(0);
  });

  it('returns positive APY for recent allocations within window', () => {
    const apy = calculateRollingAPY([recentAlloc], 100_000, 30);
    expect(apy).toBeGreaterThan(0);
  });

  it('returns 0 when all allocations are outside the rolling window', () => {
    // 60 days ago, window = 30 days → outside
    expect(calculateRollingAPY([oldAlloc], 100_000, 30)).toBe(0);
  });

  it('only counts allocations within the window', () => {
    const apy = calculateRollingAPY([recentAlloc, oldAlloc], 100_000, 30);
    // Only recentAlloc counts (oldAlloc is outside 30-day window)
    expect(apy).toBeGreaterThan(0);
    const apyOnlyRecent = calculateRollingAPY([recentAlloc], 100_000, 30);
    expect(apy).toBeCloseTo(apyOnlyRecent, 5);
  });

  it('scales APY to annualised rate', () => {
    // 1000 rewards / 100K delegated / 30 days * 365 days = 12.17%
    const apy = calculateRollingAPY([recentAlloc], 100_000, 30);
    expect(apy).toBeCloseTo((1000 / 100_000) * (365 / 30) * 100, 2);
  });
});

// ---------- calculateDelegationCapacity ----------

describe('calculateDelegationCapacity', () => {
  it('calculates all capacity metrics', () => {
    const result = calculateDelegationCapacity(100_000, 800_000, 16);
    expect(result.maxCapacity).toBe(1_600_000);
    expect(result.usedCapacity).toBe(800_000);
    expect(result.availableCapacity).toBe(800_000);
    expect(result.utilizationPercent).toBe(50);
  });

  it('caps utilisation at 100%', () => {
    const result = calculateDelegationCapacity(100_000, 2_000_000, 16);
    expect(result.utilizationPercent).toBe(100);
    expect(result.availableCapacity).toBe(0);
  });

  it('returns 100% utilisation when self-stake is 0', () => {
    const result = calculateDelegationCapacity(0, 1000, 16);
    expect(result.utilizationPercent).toBe(100);
  });

  it('handles zero delegation', () => {
    const result = calculateDelegationCapacity(100_000, 0, 16);
    expect(result.utilizationPercent).toBe(0);
    expect(result.availableCapacity).toBe(1_600_000);
  });
});

// ---------- calculateThawingRemaining ----------

describe('calculateThawingRemaining', () => {
  const FIXED_NOW = 1711382400; // 2024-03-25T12:00:00Z

  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(FIXED_NOW * 1000); });
  afterEach(() => { vi.useRealTimers(); });

  it('calculates remaining time', () => {
    const lockedUntil = FIXED_NOW + 86400 * 14; // 14 days from now
    const result = calculateThawingRemaining(lockedUntil);
    expect(result.days).toBe(14);
    expect(result.hours).toBe(0);
    expect(result.isComplete).toBe(false);
  });

  it('shows complete when past locked time', () => {
    const lockedUntil = FIXED_NOW - 1000; // already past
    const result = calculateThawingRemaining(lockedUntil);
    expect(result.isComplete).toBe(true);
    expect(result.totalSeconds).toBe(0);
  });

  it('calculates percent complete based on 28-day period', () => {
    // 14 days remaining out of 28 → 50% complete
    const lockedUntil = FIXED_NOW + 86400 * 14;
    const result = calculateThawingRemaining(lockedUntil);
    expect(result.percentComplete).toBeCloseTo(50, 0);
  });

  it('caps percent at 100', () => {
    const lockedUntil = FIXED_NOW - 86400; // past
    const result = calculateThawingRemaining(lockedUntil);
    expect(result.percentComplete).toBeLessThanOrEqual(100);
  });
});

// ---------- deriveDelegationStatus ----------

describe('deriveDelegationStatus', () => {
  const FIXED_NOW = 1711382400; // 2024-03-25T12:00:00Z

  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(FIXED_NOW * 1000); });
  afterEach(() => { vi.useRealTimers(); });

  it('returns "thawing" when tokens are locked and the thaw is still in progress', () => {
    const lockedUntil = FIXED_NOW + 86400 * 7; // 7 days out
    expect(deriveDelegationStatus(100, lockedUntil, true)).toBe('thawing');
  });

  it('returns "withdrawable" when locked tokens have finished thawing', () => {
    const lockedUntil = FIXED_NOW - 10; // already elapsed
    expect(deriveDelegationStatus(100, lockedUntil, false)).toBe('withdrawable');
  });

  it('prioritises thawing/withdrawable over active stake', () => {
    // Partially-undelegated position: still has active stake AND locked tokens.
    const future = FIXED_NOW + 86400;
    expect(deriveDelegationStatus(50, future, true)).toBe('thawing');
    expect(deriveDelegationStatus(50, FIXED_NOW - 1, true)).toBe('withdrawable');
  });

  it('returns "active" when there are no locked tokens and stake is active', () => {
    expect(deriveDelegationStatus(0, 0, true)).toBe('active');
  });

  it('returns "closed" when there are no locked tokens and no active stake', () => {
    expect(deriveDelegationStatus(0, 0, false)).toBe('closed');
  });
});

// ---------- formatThawingTime ----------

describe('formatThawingTime', () => {
  const FIXED_NOW = 1711382400;

  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(FIXED_NOW * 1000); });
  afterEach(() => { vi.useRealTimers(); });

  it('shows ready when complete', () => {
    expect(formatThawingTime(FIXED_NOW - 1000)).toBe('Ready to withdraw');
  });

  it('shows days and hours', () => {
    const lockedUntil = FIXED_NOW + 86400 * 3 + 3600 * 5;
    expect(formatThawingTime(lockedUntil)).toBe('3d 5h remaining');
  });

  it('shows hours and minutes when under a day', () => {
    const lockedUntil = FIXED_NOW + 3600 * 2 + 60 * 30;
    expect(formatThawingTime(lockedUntil)).toBe('2h 30m remaining');
  });

  it('shows only minutes when under an hour', () => {
    const lockedUntil = FIXED_NOW + 60 * 15;
    expect(formatThawingTime(lockedUntil)).toBe('15m remaining');
  });
});

// ---------- generateRewardsCSV ----------

describe('generateRewardsCSV', () => {
  const delegations = [
    {
      indexerName: 'GraphOps',
      indexerAddress: '0x1234',
      stakedTokens: 10_000,
      realizedRewards: 500,
      unrealizedRewards: 200,
      createdAt: 1700000000,
    },
    {
      indexerName: 'Stake Fish',
      indexerAddress: '0x5678',
      stakedTokens: 20_000,
      realizedRewards: 1000,
      unrealizedRewards: 400,
      createdAt: 1700100000,
    },
  ];

  it('generates valid CSV with headers', () => {
    const csv = generateRewardsCSV(delegations, 0.15);
    const lines = csv.split('\n');
    expect(lines[0]).toContain('Indexer Name');
    expect(lines[0]).toContain('Delegated (GRT)');
    expect(lines[0]).toContain('Realized Rewards (USD)');
  });

  it('includes all delegations plus TOTAL row', () => {
    const csv = generateRewardsCSV(delegations, 0.15);
    const lines = csv.split('\n');
    // Header + 2 delegations + 1 total = 4 lines
    expect(lines).toHaveLength(4);
  });

  it('calculates correct totals', () => {
    const csv = generateRewardsCSV(delegations, 0.15);
    const lines = csv.split('\n');
    const totalLine = lines[lines.length - 1];
    expect(totalLine).toContain('TOTAL');
    expect(totalLine).toContain('30000.00'); // 10K + 20K staked
    expect(totalLine).toContain('1500.00');  // 500 + 1000 realized
  });

  it('applies GRT price to USD columns', () => {
    const csv = generateRewardsCSV(delegations, 0.20);
    const lines = csv.split('\n');
    // First delegation: 10000 * 0.20 = 2000.00 USD
    expect(lines[1]).toContain('2000.00');
  });
});
