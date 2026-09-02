/**
 * The DIPS nest against the chain it indexes.
 *
 * Every comparison is exact BigInt wei. That is the point of the check: a nest that missed one log
 * is off by a whole allocation, and a tolerance wide enough to be "safe" would be wide enough to
 * hide it. The interesting cases are the ones that look like nothing — a target the nest has never
 * heard of, sitting at zero, is a missing log rather than an empty allocation.
 */
import { describe, it, expect } from 'vitest';
import {
  compareAllocations,
  ISSUANCE_ALLOCATOR,
  type ChainState,
  type NestAllocationRow,
} from '../dips-chain';

const GRT = 10n ** 18n;
const wei = (grt: number) => (BigInt(Math.round(grt * 1000)) * GRT) / 1000n;

const REWARDS_MANAGER = '0x971b9d3d0ae3eca029cab5ea1fb0f72c85e6a525';
const INNOVATION = '0x2ff06ba8086f37ba656a5b75405bf985f738b16e';
const DEFAULT_ALLOCATION = '0x28cd50e9e02856908f4c1966ab035b1f6c4dde1e';

/** Arbitrum One as read from the allocator on 2026-09-02. */
const CHAIN: ChainState = {
  issuancePerBlock: wei(120.73),
  targets: [
    { target: DEFAULT_ALLOCATION, total: 0n, allocatorMinting: 0n, selfMinting: 0n },
    {
      target: REWARDS_MANAGER,
      total: wei(96.584),
      allocatorMinting: 0n,
      selfMinting: wei(96.584),
    },
    {
      target: INNOVATION,
      total: wei(24.146),
      allocatorMinting: wei(24.146),
      selfMinting: 0n,
    },
  ],
};

/** The nest agreeing with the above. */
const NEST: NestAllocationRow[] = [
  { target: DEFAULT_ALLOCATION, self_minting_rate_dec: '0', allocator_minting_rate_dec: '0' },
  {
    target: REWARDS_MANAGER,
    self_minting_rate_dec: wei(96.584).toString(),
    allocator_minting_rate_dec: '0',
  },
  {
    target: INNOVATION,
    self_minting_rate_dec: '0',
    allocator_minting_rate_dec: wei(24.146).toString(),
  },
];

describe('compareAllocations', () => {
  it('finds nothing wrong when the nest matches the chain', () => {
    expect(compareAllocations(CHAIN, NEST)).toEqual([]);
  });

  it('adds the two minting fields rather than reading either alone', () => {
    // The same 24.146 split across both columns is still 24.146. Reading one field would call
    // this a mismatch, which is the bug that shipped in the panel.
    const split: NestAllocationRow[] = [
      ...NEST.slice(0, 2),
      {
        target: INNOVATION,
        self_minting_rate_dec: wei(12).toString(),
        allocator_minting_rate_dec: wei(12.146).toString(),
      },
    ];
    expect(compareAllocations(CHAIN, split)).toEqual([]);
  });

  it('flags a target the chain lists and the nest has never recorded', () => {
    const d = compareAllocations(CHAIN, NEST.filter((r) => r.target !== INNOVATION));
    expect(d).toHaveLength(1);
    expect(d[0].kind).toBe('missing_from_nest');
    expect(d[0].target).toBe(INNOVATION);
    expect(d[0].detail).toContain('24.146');
  });

  it('flags a missing target even when its allocation is zero', () => {
    // A zero allocation the nest has never seen is a missed log, not an empty allocation. This is
    // the case that looks like nothing and is the whole reason for the check.
    const d = compareAllocations(CHAIN, NEST.filter((r) => r.target !== DEFAULT_ALLOCATION));
    expect(d).toHaveLength(1);
    expect(d[0].kind).toBe('missing_from_nest');
    expect(d[0].target).toBe(DEFAULT_ALLOCATION);
  });

  it('flags a rate the two sides disagree on', () => {
    const stale: NestAllocationRow[] = [
      ...NEST.slice(0, 2),
      {
        target: INNOVATION,
        self_minting_rate_dec: '0',
        allocator_minting_rate_dec: wei(20).toString(),
      },
    ];
    const d = compareAllocations(CHAIN, stale);
    expect(d).toHaveLength(1);
    expect(d[0].kind).toBe('rate_mismatch');
    expect(d[0].chain).toBe(wei(24.146).toString());
    expect(d[0].nest).toBe(wei(20).toString());
    expect(d[0].detail).toContain('allocator says 24.146');
  });

  it('catches a one-wei difference', () => {
    const off: NestAllocationRow[] = [
      ...NEST.slice(0, 2),
      {
        target: INNOVATION,
        self_minting_rate_dec: '0',
        allocator_minting_rate_dec: (wei(24.146) - 1n).toString(),
      },
    ];
    expect(compareAllocations(CHAIN, off)[0].kind).toBe('rate_mismatch');
  });

  it('flags a target the nest carries and the allocator does not list', () => {
    const extra = [
      ...NEST,
      {
        target: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        self_minting_rate_dec: wei(5).toString(),
        allocator_minting_rate_dec: '0',
      },
    ];
    const d = compareAllocations(CHAIN, extra);
    expect(d).toHaveLength(1);
    expect(d[0].kind).toBe('unknown_to_chain');
    expect(d[0].detail).toContain('does not');
  });

  it("flags the allocator's own targets failing to sum to its issuance per block", () => {
    const broken: ChainState = { ...CHAIN, issuancePerBlock: wei(200) };
    const d = compareAllocations(broken, NEST);
    expect(d).toHaveLength(1);
    expect(d[0].kind).toBe('chain_sum_mismatch');
    expect(d[0].target).toBe(ISSUANCE_ALLOCATOR);
    expect(d[0].detail).toContain('120.730');
    expect(d[0].detail).toContain('200.000');
  });

  it('matches addresses without caring about checksum casing', () => {
    const shouty = NEST.map((r) => ({ ...r, target: r.target.toUpperCase().replace('0X', '0x') }));
    expect(compareAllocations(CHAIN, shouty)).toEqual([]);
  });

  it('reads a null rate column as zero rather than crashing on it', () => {
    const nulls: NestAllocationRow[] = [
      { target: DEFAULT_ALLOCATION, self_minting_rate_dec: null, allocator_minting_rate_dec: null },
      ...NEST.slice(1),
    ];
    expect(compareAllocations(CHAIN, nulls)).toEqual([]);
  });

  it('reports every divergence rather than stopping at the first', () => {
    const d = compareAllocations(CHAIN, [NEST[0]]);
    expect(d.map((x) => x.kind)).toEqual(['missing_from_nest', 'missing_from_nest']);
  });
});
