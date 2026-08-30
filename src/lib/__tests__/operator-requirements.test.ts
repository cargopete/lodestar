import { describe, it, expect } from 'vitest';
import {
  days,
  grtWhole,
  interpret,
  PROTOCOL_MAX_THAWING_SECONDS,
  requirementSummary,
  toJson,
} from '../operator-requirements';

const UINT256_MAX = (1n << 256n) - 1n;
const UINT64_MAX = (1n << 64n) - 1n;
const GRT = (n: bigint) => n * 10n ** 18n;
const DAYS = (n: number) => BigInt(n * 86_400);

describe('interpret', () => {
  /** Dispatch, read off Arbitrum One on 2026-08-30. */
  it('reads the real Dispatch ranges', () => {
    const r = interpret(GRT(555n), UINT256_MAX, DAYS(14), UINT64_MAX, 0, 1_000_000);
    expect(grtWhole(r.minTokens)).toBe(555);
    expect(r.maxTokens).toBeNull();
    expect(days(r.minThawingSeconds)).toBe(14);
    expect(r.noMinimum).toBe(false);
  });

  /**
   * A service leaving its own thawing maximum unbounded has not removed the protocol's. An operator
   * reading only the service range would pick a period the protocol refuses, and meet the trap this
   * whole exercise exists to spare them.
   */
  it('clamps an unbounded service maximum to the protocol ceiling', () => {
    const r = interpret(0n, UINT256_MAX, DAYS(14), UINT64_MAX, 0, 1_000_000);
    expect(r.maxThawingSeconds).toBe(PROTOCOL_MAX_THAWING_SECONDS);
    expect(days(r.maxThawingSeconds)).toBe(28);
  });

  it('keeps a service maximum that is stricter than the protocol', () => {
    const r = interpret(0n, UINT256_MAX, DAYS(14), DAYS(21), 0, 1_000_000);
    expect(days(r.maxThawingSeconds)).toBe(21);
  });

  /** Mainline's real shape: no token floor, but a deliberately set 21-day thawing floor. */
  it('does not call a service with a set thawing floor unconfigured', () => {
    const r = interpret(0n, UINT256_MAX, DAYS(21), UINT64_MAX, 0, 1_000_000);
    expect(r.noMinimum).toBe(false);
  });

  /**
   * SDSCE's real shape: both floors zero. That reads more like parameters nobody set than like a
   * deliberate offer, so it is flagged rather than advertised as free. Telling somebody a service
   * costs nothing when the truth is that it is unconfigured is the wrong kind of encouragement.
   */
  it('flags a service whose floors are both zero', () => {
    expect(interpret(0n, UINT256_MAX, 0n, UINT64_MAX, 0, 1_000_000).noMinimum).toBe(true);
  });

  it('keeps a real upper token bound when one is set', () => {
    const r = interpret(GRT(555n), GRT(10_000n), DAYS(14), UINT64_MAX, 0, 1_000_000);
    expect(r.maxTokens).toBe(GRT(10_000n));
  });
});

describe('requirementSummary', () => {
  it('prices Dispatch in a sentence', () => {
    const s = requirementSummary(interpret(GRT(555n), UINT256_MAX, DAYS(14), UINT64_MAX, 0, 1_000_000));
    expect(s).toBe('555 GRT, thawing period 14 to 28 days.');
  });

  it('prices the Subgraph Service in the same sentence, for contrast', () => {
    const s = requirementSummary(
      interpret(GRT(100_000n), UINT256_MAX, DAYS(28), UINT64_MAX, 0, 1_000_000)
    );
    expect(s).toBe('100,000 GRT, thawing period 28 to 28 days.');
  });

  /**
   * The window, not a single recommended number. Our operator write-up says "use 14 days, it is
   * comfortably inside", which is right for Dispatch by accident: 14 days is that service's floor
   * and 13 would be refused. Anyone reasoning downward from "comfortably inside" walks into a
   * revert, so the floor has to be visible.
   */
  it('states a window rather than a recommendation', () => {
    const s = requirementSummary(interpret(0n, UINT256_MAX, DAYS(14), UINT64_MAX, 0, 1_000_000));
    expect(s).toContain('14 to 28 days');
    expect(s).toContain('No minimum provision');
  });

  it('reads a zero floor as up-to rather than as a range starting at nothing', () => {
    const s = requirementSummary(interpret(0n, UINT256_MAX, 0n, UINT64_MAX, 0, 1_000_000));
    expect(s).toContain('up to 28 days');
  });
});

describe('toJson', () => {
  /**
   * The guard for a bug that unit tests alone will not catch: these values are `bigint`, and
   * `NextResponse.json` throws on one. A route carrying the raw struct returns 500 in production
   * while every test that never stringifies it stays green.
   */
  it('produces something an API route can actually serialise', () => {
    const r = interpret(GRT(555n), UINT256_MAX, DAYS(14), UINT64_MAX, 0, 1_000_000);
    expect(() => JSON.stringify(r)).toThrow();
    expect(() => JSON.stringify(toJson(r))).not.toThrow();
    expect(JSON.parse(JSON.stringify(toJson(r)))).toEqual({
      minTokensGrt: 555,
      maxTokensGrt: null,
      minThawingDays: 14,
      maxThawingDays: 28,
      minVerifierCutPpm: 0,
      maxVerifierCutPpm: 1_000_000,
      noMinimum: false,
      summary: '555 GRT, thawing period 14 to 28 days.',
    });
  });
});
