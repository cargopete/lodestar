import { describe, it, expect } from 'vitest';
import {
  usdToGrt,
  grtToUsd,
  reserveRateGrt,
  canAfford,
  debit,
  reconcileRefund,
  TARGET_USD_PER_QUERY,
  RESERVE_BUFFER,
} from '../billing';

describe('usdToGrt / grtToUsd', () => {
  it('converts at the given price', () => {
    expect(usdToGrt(0.026, 0.026)).toBeCloseTo(1, 12);
    expect(grtToUsd(1, 0.026)).toBeCloseTo(0.026, 12);
  });
  it('round-trips', () => {
    expect(grtToUsd(usdToGrt(5, 0.026), 0.026)).toBeCloseTo(5, 9);
  });
  it('rejects a non-positive price', () => {
    expect(() => usdToGrt(1, 0)).toThrow();
    expect(() => usdToGrt(1, -1)).toThrow();
  });
});

describe('reserveRateGrt', () => {
  it('applies the buffer over the at-cost rate', () => {
    const atCost = usdToGrt(TARGET_USD_PER_QUERY, 0.026);
    expect(reserveRateGrt(0.026, 1)).toBeCloseTo(atCost, 18);
    expect(reserveRateGrt(0.026)).toBeCloseTo(atCost * RESERVE_BUFFER, 18);
  });
  it('matches the observed ~0.00073 GRT/query at $0.026', () => {
    // at-cost (buffer 1) should be ~0.00077 GRT, close to the live-key observation
    expect(reserveRateGrt(0.026, 1)).toBeCloseTo(0.00077, 4);
  });
  it('refuses a sub-1 buffer (would be a negative spread / loss)', () => {
    expect(() => reserveRateGrt(0.026, 0.9)).toThrow();
  });
});

describe('canAfford / debit', () => {
  it('affords when balance >= cost', () => {
    expect(canAfford(1, 0.5)).toBe(true);
    expect(canAfford(0.5, 0.5)).toBe(true);
    expect(canAfford(0.4, 0.5)).toBe(false);
  });
  it('rejects negative cost', () => {
    expect(canAfford(1, -0.1)).toBe(false);
    expect(() => debit(1, -0.1)).toThrow();
  });
  it('debits and throws on overdraw', () => {
    expect(debit(1, 0.3)).toBeCloseTo(0.7, 12);
    expect(() => debit(0.2, 0.5)).toThrow(/insufficient/);
  });
});

describe('reconcileRefund', () => {
  it('refunds the buffer when actual cost is below the reserve', () => {
    // reserved 100 queries * 0.001, actual total fees 0.073 over 100 queries
    const refund = reconcileRefund({
      reserveRateGrt: 0.001,
      actualTotalFeesGrt: 0.073,
      totalQueries: 100,
      userQueries: 100,
    });
    expect(refund).toBeCloseTo(0.1 - 0.073, 9); // 0.027
  });

  it('apportions actual fees by the user share', () => {
    // user did 25 of 100 queries; actual total 0.4 GRT → user owes 0.1
    const refund = reconcileRefund({
      reserveRateGrt: 0.001,
      actualTotalFeesGrt: 0.4,
      totalQueries: 100,
      userQueries: 25,
    });
    // reserved 25*0.001 = 0.025, owed 0.1 → would be negative → clamp to 0
    expect(refund).toBe(0);
  });

  it('passes the free tier through: zero actual fees → full refund', () => {
    const refund = reconcileRefund({
      reserveRateGrt: 0.001,
      actualTotalFeesGrt: 0,
      totalQueries: 100,
      userQueries: 40,
    });
    expect(refund).toBeCloseTo(0.04, 9); // all 40*0.001 reserved comes back
  });

  it('never refunds negative; Lodestar absorbs an under-reserve', () => {
    const refund = reconcileRefund({
      reserveRateGrt: 0.0005, // below actual per-query
      actualTotalFeesGrt: 0.1,
      totalQueries: 100,
      userQueries: 100,
    });
    expect(refund).toBe(0);
  });

  it('returns 0 for users with no queries', () => {
    expect(reconcileRefund({ reserveRateGrt: 0.001, actualTotalFeesGrt: 1, totalQueries: 0, userQueries: 0 })).toBe(0);
    expect(reconcileRefund({ reserveRateGrt: 0.001, actualTotalFeesGrt: 1, totalQueries: 100, userQueries: 0 })).toBe(0);
  });
});
