import { describe, it, expect } from 'vitest';
import {
  resolveCostModel,
  DEFAULT_CHAIN_COSTS,
  DEFAULT_BASE_OVERHEAD_USD,
} from '../infra-cost';

describe('resolveCostModel', () => {
  it('sums default per-chain costs plus base overhead', () => {
    const m = resolveCostModel({ chains: ['arbitrum', 'mainnet'] });
    const expected =
      DEFAULT_BASE_OVERHEAD_USD +
      DEFAULT_CHAIN_COSTS.arbitrum.monthlyUsd +
      DEFAULT_CHAIN_COSTS.mainnet.monthlyUsd;
    expect(m.totalMonthlyUsd).toBe(expected);
    expect(m.lines).toHaveLength(2);
    expect(m.lines.every((l) => !l.isOverride)).toBe(true);
  });

  it('applies per-chain overrides and flags them', () => {
    const m = resolveCostModel({ chains: ['arbitrum'], overrides: { arbitrum: 1800 } });
    const line = m.lines.find((l) => l.key === 'arbitrum')!;
    expect(line.monthlyUsd).toBe(1800);
    expect(line.isOverride).toBe(true);
    expect(m.totalMonthlyUsd).toBe(DEFAULT_BASE_OVERHEAD_USD + 1800);
  });

  it('includes an unknown chain only when an override supplies its cost', () => {
    const skipped = resolveCostModel({ chains: ['nonsense-chain'] });
    expect(skipped.lines).toHaveLength(0);
    expect(skipped.totalMonthlyUsd).toBe(DEFAULT_BASE_OVERHEAD_USD);

    const included = resolveCostModel({
      chains: ['nonsense-chain'],
      overrides: { 'nonsense-chain': 250 },
    });
    expect(included.lines).toHaveLength(1);
    expect(included.lines[0]).toMatchObject({ key: 'nonsense-chain', monthlyUsd: 250, isOverride: true });
    expect(included.totalMonthlyUsd).toBe(DEFAULT_BASE_OVERHEAD_USD + 250);
  });

  it('honours a base overhead override', () => {
    const m = resolveCostModel({ chains: [], baseOverheadUsd: 0 });
    expect(m.baseOverheadUsd).toBe(0);
    expect(m.totalMonthlyUsd).toBe(0);
  });

  it('an empty selection costs only the base overhead', () => {
    const m = resolveCostModel({ chains: [] });
    expect(m.totalMonthlyUsd).toBe(DEFAULT_BASE_OVERHEAD_USD);
  });
});
