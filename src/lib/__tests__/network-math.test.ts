import { describe, it, expect } from 'vitest';
import { epochStatus, annualIssuancePercent, L1_BLOCKS_PER_YEAR } from '../network-math';

describe('epochStatus', () => {
  it('labels the current epoch Active (and anything ahead, defensively)', () => {
    expect(epochStatus(1274, 1274)).toBe('Active');
    expect(epochStatus(1275, 1274)).toBe('Active');
  });
  it('labels the progression of recently-closed epochs', () => {
    expect(epochStatus(1273, 1274)).toBe('Settling');
    expect(epochStatus(1272, 1274)).toBe('Distributing');
  });
  it('labels older epochs Finalized', () => {
    expect(epochStatus(1271, 1274)).toBe('Finalized');
    expect(epochStatus(1, 1274)).toBe('Finalized');
  });
});

describe('annualIssuancePercent', () => {
  it('annualises issuance-per-block over supply', () => {
    // 120.73 GRT/block over ~2.6M blocks/yr ÷ 3.647B supply ≈ 8.6%
    const pct = annualIssuancePercent(120.73, 3_647_392_487);
    expect(pct).toBeGreaterThan(8);
    expect(pct).toBeLessThan(9);
  });
  it('scales linearly with the per-block rate', () => {
    const a = annualIssuancePercent(100, 1_000_000_000);
    const b = annualIssuancePercent(200, 1_000_000_000);
    expect(b).toBeCloseTo(a * 2, 9);
  });
  it('returns 0 for non-positive supply or negative issuance', () => {
    expect(annualIssuancePercent(100, 0)).toBe(0);
    expect(annualIssuancePercent(-1, 1_000)).toBe(0);
  });
  it('honours a custom blocks-per-year', () => {
    expect(annualIssuancePercent(1, 100, 100)).toBeCloseTo(100, 9); // 1*100/100 = 1.0 → 100%
  });
  it('uses a sane L1 blocks/year constant (~2.6M)', () => {
    expect(L1_BLOCKS_PER_YEAR).toBeGreaterThan(2_500_000);
    expect(L1_BLOCKS_PER_YEAR).toBeLessThan(2_700_000);
  });
});
