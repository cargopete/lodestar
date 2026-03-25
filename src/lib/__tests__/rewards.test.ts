import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  calculateExchangeRate,
  calculateUnrealizedRewards,
  calculateEstimatedAPR,
  calculateDelegatorAPR,
  calculateDelegationCapacity,
  calculateThawingRemaining,
  formatThawingTime,
  generateRewardsCSV,
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
