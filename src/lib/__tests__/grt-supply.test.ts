import { describe, it, expect } from 'vitest';
import { computeGlobalSupply } from '../grt-supply';
import { annualIssuancePercent } from '../network-math';

describe('computeGlobalSupply', () => {
  it('subtracts the bridge escrow to avoid double-counting', () => {
    // Escrowed tokens are counted in L1 totalSupply (held by escrow) AND minted on L2.
    expect(computeGlobalSupply(10, 4, 3)).toBe(11);
  });

  it('matches the observed on-chain figures (~11.5B)', () => {
    // Snapshot 2026-06-11: L1 10.80B, L2 3.636B, escrow 2.904B → ~11.53B.
    const global = computeGlobalSupply(10_800_262_816, 3_636_148_640, 2_904_305_166);
    expect(global).toBeCloseTo(11_532_106_290, 0);
  });

  it('yields the ~2.8% issuance rate Explorer cites — not the L2-only ~8.6%', () => {
    const global = computeGlobalSupply(10_800_262_816, 3_636_148_640, 2_904_305_166);
    const onGlobal = annualIssuancePercent(120.73, global);
    const onL2Only = annualIssuancePercent(120.73, 3_636_148_640);
    expect(onGlobal).toBeCloseTo(2.75, 1);
    expect(onL2Only).toBeGreaterThan(8); // the misleading basis we moved away from
  });
});
