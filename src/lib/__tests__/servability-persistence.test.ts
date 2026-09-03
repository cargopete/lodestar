/**
 * RFC-006 D5 persistence (lodestar#59). Every case here is one from the issue's test list, and the
 * function is pure, so each is a table of rounds in and a rendered state out.
 */
import { describe, it, expect } from 'vitest';
import { applyPersistence, deadRoundsThreshold, type RoundSummary } from '../servability-persistence';
import type { GatewayVerdict } from '../gateway-probe';

let t = 1_700_000_000;
const round = (servingOperators: number, gatewayVerdict: GatewayVerdict | null = 'bad-indexers'): RoundSummary => ({
  probedAt: new Date((t += 60) * 1000).toISOString(),
  servingOperators,
  servingIndexers: servingOperators,
  gatewayVerdict,
});
const dead = (gw: GatewayVerdict | null = 'bad-indexers') => round(0, gw);
const alive = () => round(2, 'served');

describe('applyPersistence', () => {
  it('1. one dead round is rechecking, not dead', () => {
    const r = applyPersistence([dead()], 3);
    expect(r.state).toBe('rechecking');
    expect(r.effectivelyDead).toBe(false);
    expect(r.deadStreak).toBe(1);
  });

  it('2. three consecutive dead rounds are dead', () => {
    const r = applyPersistence([dead(), dead(), dead()], 3);
    expect(r.state).toBe('dead');
    expect(r.effectivelyDead).toBe(true);
    expect(r.deadStreak).toBe(3);
  });

  it('3. an alive round in the middle breaks the streak', () => {
    const r = applyPersistence([dead(), dead(), alive(), dead()], 3);
    expect(r.state).toBe('rechecking');
    expect(r.deadStreak).toBe(1);
  });

  it('4. recovery is instant: dead, dead, dead, alive is ok', () => {
    const r = applyPersistence([dead(), dead(), dead(), alive()], 3);
    expect(r.state).toBe('ok');
    expect(r.effectivelyDead).toBe(false);
    expect(r.deadStreak).toBe(0);
  });

  it('5. a gateway-served round resets the streak even when direct probes were dead', () => {
    const r = applyPersistence([dead('bad-indexers'), dead('served'), dead('bad-indexers')], 3);
    expect(r.state).toBe('rechecking');
    expect(r.deadStreak).toBe(1);
  });

  it('6. an empty history, or a first-ever dead round, is never dead', () => {
    expect(applyPersistence([], 3).state).toBe('ok');
    expect(applyPersistence([], 3).probedAt).toBeNull();
    expect(applyPersistence([dead()], 2).state).toBe('rechecking');
    // Even a caller asking for K=1 cannot render a first round dead: K floors at 2.
    expect(applyPersistence([dead()], 1).state).toBe('rechecking');
    expect(applyPersistence([dead()], 1).k).toBe(2);
  });

  it('7. exactly K−1 dead rounds is rechecking; exactly K is dead', () => {
    expect(applyPersistence([dead(), dead()], 3).state).toBe('rechecking');
    expect(applyPersistence([dead(), dead(), dead()], 3).state).toBe('dead');
    expect(applyPersistence([dead(), dead(), dead(), dead()], 5).state).toBe('rechecking');
    expect(applyPersistence([dead(), dead(), dead(), dead(), dead()], 5).state).toBe('dead');
  });

  it('8. same-round gateway served with zero serving operators is conflicting, never dead', () => {
    const r = applyPersistence([dead(), dead(), dead('served')], 3);
    expect(r.state).toBe('conflicting');
    expect(r.effectivelyDead).toBe(false);
    expect(r.deadStreak).toBe(0);
  });

  it('9. a gateway that agrees (bad-indexers) does not fire the guard; persistence proceeds', () => {
    expect(applyPersistence([dead('bad-indexers')], 3).state).toBe('rechecking');
    expect(applyPersistence([dead('bad-indexers'), dead('bad-indexers'), dead('bad-indexers')], 3).state).toBe('dead');
    // No gateway probe at all (no key) is not agreement either way; persistence alone decides.
    expect(applyPersistence([dead(null), dead(null), dead(null)], 3).state).toBe('dead');
  });

  it('carries the newest round\'s probedAt so the banner can say how old the verdict is', () => {
    const h = [dead(), dead(), dead()];
    expect(applyPersistence(h, 3).probedAt).toBe(h[2].probedAt);
  });
});

describe('deadRoundsThreshold', () => {
  it('reads SERVABILITY_DEAD_ROUNDS, defaults to 3, and refuses anything below 2', () => {
    expect(deadRoundsThreshold(undefined)).toBe(3);
    expect(deadRoundsThreshold('5')).toBe(5);
    expect(deadRoundsThreshold('1')).toBe(3);
    expect(deadRoundsThreshold('0')).toBe(3);
    expect(deadRoundsThreshold('nonsense')).toBe(3);
  });
});
