import { describe, it, expect } from 'vitest';
import {
  weiToGRT,
  isGreedyCut,
  formatGRT,
  formatGRTFull,
  ppmToPercent,
  formatPPM,
  formatPercent,
  formatUSD,
  shortenAddress,
  resolveIndexerName,
  calculateEpochProgress,
  calculateCapacityUsed,
  calculateAvailableCapacity,
  formatRelativeTime,
  formatNumber,
} from '../utils';

// ---------- weiToGRT ----------

describe('weiToGRT', () => {
  it('converts string wei to GRT', () => {
    expect(weiToGRT('1000000000000000000')).toBe(1);
    expect(weiToGRT('5000000000000000000000')).toBe(5000);
  });

  it('converts bigint wei to GRT', () => {
    expect(weiToGRT(BigInt('1000000000000000000'))).toBe(1);
    expect(weiToGRT(BigInt('100000000000000000000000'))).toBeCloseTo(100000);
  });

  it('handles zero', () => {
    expect(weiToGRT('0')).toBe(0);
    expect(weiToGRT(BigInt(0))).toBe(0);
  });

  it('truncates decimal strings from subgraph', () => {
    expect(weiToGRT('1000000000000000000.5')).toBe(1);
    expect(weiToGRT('5000000000000000000000.999')).toBe(5000);
  });

  it('handles small amounts', () => {
    const result = weiToGRT('1000000000000');
    expect(result).toBeCloseTo(0.000001, 6);
  });
});

// ---------- isGreedyCut ----------

describe('isGreedyCut', () => {
  it('returns true for 100% cut (1,000,000 PPM)', () => {
    expect(isGreedyCut(1_000_000)).toBe(true);
  });

  it('returns true for above 100%', () => {
    expect(isGreedyCut(1_000_001)).toBe(true);
  });

  it('returns false for 99.9999% cut', () => {
    expect(isGreedyCut(999_999)).toBe(false);
  });

  it('returns false for 0', () => {
    expect(isGreedyCut(0)).toBe(false);
  });

  it('returns false for typical 10% cut', () => {
    expect(isGreedyCut(100_000)).toBe(false);
  });
});

// ---------- formatGRT ----------

describe('formatGRT', () => {
  it('formats billions', () => {
    expect(formatGRT(1_500_000_000)).toBe('1.50B');
    expect(formatGRT(10_000_000_000)).toBe('10.00B');
  });

  it('formats millions', () => {
    expect(formatGRT(1_500_000)).toBe('1.50M');
    expect(formatGRT(999_999_999)).toBe('1000.00M');
  });

  it('formats thousands', () => {
    expect(formatGRT(1_500)).toBe('1.50K');
    expect(formatGRT(999_999)).toBe('1000.00K');
  });

  it('formats small numbers', () => {
    expect(formatGRT(500)).toBe('500.00');
    expect(formatGRT(0.5)).toBe('0.50');
  });

  it('respects custom decimals', () => {
    expect(formatGRT(1_500_000, 0)).toBe('2M');
    expect(formatGRT(1_500_000, 1)).toBe('1.5M');
    expect(formatGRT(1_500_000, 3)).toBe('1.500M');
  });
});

// ---------- formatGRTFull ----------

describe('formatGRTFull', () => {
  it('formats with commas and 2 decimal places', () => {
    expect(formatGRTFull(1234567.89)).toBe('1,234,567.89');
    expect(formatGRTFull(0)).toBe('0.00');
    expect(formatGRTFull(999.999)).toBe('1,000.00');
  });
});

// ---------- ppmToPercent ----------

describe('ppmToPercent', () => {
  it('converts PPM to percentage', () => {
    expect(ppmToPercent(10000)).toBe(1);
    expect(ppmToPercent(100000)).toBe(10);
    expect(ppmToPercent(1000000)).toBe(100);
    expect(ppmToPercent(0)).toBe(0);
    expect(ppmToPercent(50000)).toBe(5);
  });
});

// ---------- formatPPM ----------

describe('formatPPM', () => {
  it('formats PPM as percentage string', () => {
    expect(formatPPM(100000)).toBe('10.00%');
    expect(formatPPM(50000)).toBe('5.00%');
    expect(formatPPM(0)).toBe('0.00%');
    expect(formatPPM(1000000)).toBe('100.00%');
  });
});

// ---------- formatPercent ----------

describe('formatPercent', () => {
  it('formats percentage with default decimals', () => {
    expect(formatPercent(50)).toBe('50.00%');
    expect(formatPercent(99.9)).toBe('99.90%');
  });

  it('respects custom decimals', () => {
    expect(formatPercent(50, 0)).toBe('50%');
    expect(formatPercent(33.333, 1)).toBe('33.3%');
  });
});

// ---------- formatUSD ----------

describe('formatUSD', () => {
  it('formats billions', () => {
    expect(formatUSD(1_500_000_000)).toBe('$ 1.50B');
  });

  it('formats millions', () => {
    expect(formatUSD(1_500_000)).toBe('$ 1.50M');
  });

  it('formats thousands', () => {
    expect(formatUSD(1_500)).toBe('$ 1.50K');
  });

  it('formats small amounts with currency', () => {
    expect(formatUSD(42.5)).toBe('$42.50');
    expect(formatUSD(0)).toBe('$0.00');
  });

  it('uses full precision when high decimals requested', () => {
    expect(formatUSD(1_500_000, 4)).toBe('$1,500,000.0000');
  });
});

// ---------- shortenAddress ----------

describe('shortenAddress', () => {
  it('shortens ethereum address', () => {
    expect(shortenAddress('0x1234567890abcdef1234567890abcdef12345678'))
      .toBe('0x1234...5678');
  });

  it('supports custom char count', () => {
    expect(shortenAddress('0x1234567890abcdef1234567890abcdef12345678', 6))
      .toBe('0x123456...345678');
  });

  it('handles empty string', () => {
    expect(shortenAddress('')).toBe('');
  });
});

// ---------- resolveIndexerName ----------

describe('resolveIndexerName', () => {
  const addr = '0x1234567890abcdef1234567890abcdef12345678';

  it('prefers defaultDisplayName', () => {
    const account = {
      defaultDisplayName: 'GraphOps',
      metadata: { displayName: 'Other Name' },
    };
    expect(resolveIndexerName(account, addr)).toBe('GraphOps');
  });

  it('falls back to metadata displayName', () => {
    const account = {
      defaultDisplayName: null,
      metadata: { displayName: 'Stake Fish' },
    };
    expect(resolveIndexerName(account, addr)).toBe('Stake Fish');
  });

  it('extracts name from description bio pattern', () => {
    const account = {
      metadata: { description: 'GraphOps is a blockchain infrastructure company' },
    };
    expect(resolveIndexerName(account, addr)).toBe('GraphOps');
  });

  it('uses short description directly', () => {
    const account = {
      metadata: { description: 'The Graph Council' },
    };
    expect(resolveIndexerName(account, addr)).toBe('The Graph Council');
  });

  it('truncates long descriptions', () => {
    const account = {
      metadata: { description: 'A very long name that exceeds the thirty character maximum limit for display' },
    };
    const result = resolveIndexerName(account, addr);
    expect(result.length).toBeLessThanOrEqual(30);
  });

  it('falls back to shortened address', () => {
    expect(resolveIndexerName(null, addr)).toBe('0x1234...5678');
    expect(resolveIndexerName(undefined, addr)).toBe('0x1234...5678');
    expect(resolveIndexerName({ metadata: null }, addr)).toBe('0x1234...5678');
  });
});

// ---------- calculateEpochProgress ----------

describe('calculateEpochProgress', () => {
  it('calculates progress correctly', () => {
    expect(calculateEpochProgress(1500, 1000, 1000)).toBe(50);
    expect(calculateEpochProgress(1000, 1000, 1000)).toBe(0);
    expect(calculateEpochProgress(2000, 1000, 1000)).toBe(100);
  });

  it('caps at 100%', () => {
    expect(calculateEpochProgress(3000, 1000, 1000)).toBe(100);
  });
});

// ---------- calculateCapacityUsed ----------

describe('calculateCapacityUsed', () => {
  it('calculates capacity percentage', () => {
    // selfStake=100K, delegated=800K, ratio=16 → max=1.6M → 50%
    expect(calculateCapacityUsed(100_000, 800_000, 16)).toBe(50);
  });

  it('returns 100 when self-stake is zero', () => {
    expect(calculateCapacityUsed(0, 1000, 16)).toBe(100);
  });

  it('caps at 100%', () => {
    expect(calculateCapacityUsed(100_000, 2_000_000, 16)).toBe(100);
  });
});

// ---------- calculateAvailableCapacity ----------

describe('calculateAvailableCapacity', () => {
  it('calculates available capacity', () => {
    // selfStake=100K, delegated=800K, ratio=16 → max=1.6M → available=800K
    expect(calculateAvailableCapacity(100_000, 800_000, 16)).toBe(800_000);
  });

  it('returns 0 when over-delegated', () => {
    expect(calculateAvailableCapacity(100_000, 2_000_000, 16)).toBe(0);
  });

  it('returns full capacity when no delegation', () => {
    expect(calculateAvailableCapacity(100_000, 0, 16)).toBe(1_600_000);
  });
});

// ---------- formatRelativeTime ----------

describe('formatRelativeTime', () => {
  it('shows "Just now" for recent timestamps', () => {
    const now = Date.now() / 1000;
    expect(formatRelativeTime(now - 30)).toBe('Just now');
  });

  it('shows minutes ago', () => {
    const now = Date.now() / 1000;
    expect(formatRelativeTime(now - 300)).toBe('5m ago');
  });

  it('shows hours ago', () => {
    const now = Date.now() / 1000;
    expect(formatRelativeTime(now - 7200)).toBe('2h ago');
  });

  it('shows days ago', () => {
    const now = Date.now() / 1000;
    expect(formatRelativeTime(now - 172800)).toBe('2d ago');
  });

  it('shows date for old timestamps', () => {
    // More than 7 days ago — falls through to toLocaleDateString
    const result = formatRelativeTime(1000000);
    expect(result).toMatch(/\d/); // contains digits (a date)
  });
});

// ---------- formatNumber ----------

describe('formatNumber', () => {
  it('formats with commas', () => {
    expect(formatNumber(1234567)).toBe('1,234,567');
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(999)).toBe('999');
    expect(formatNumber(1000)).toBe('1,000');
  });
});
