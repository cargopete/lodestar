/**
 * Tests for chain liveness — the absolute (wall-clock) staleness signal that
 * survives when a chain halts and every relative signal reports perfect health.
 *
 * The cases that matter are the two real ones: Moonbeam halting outright, and a
 * Celo indexer reporting 99.98% synced against a head frozen 85 hours earlier.
 */
import { describe, it, expect } from 'vitest';
import {
  advanceChainHead,
  classifyLiveness,
  formatStallDuration,
  livenessMessage,
  STALL_AFTER_MS,
  HALT_AFTER_MS,
  OBSERVATION_MAX_AGE_MS,
  type ChainHeadRecord,
} from '@/lib/chain-liveness';

const T0 = 1_770_000_000_000; // fixed epoch, no wall clock in tests
const MIN = 60_000;
const HOUR = 60 * MIN;

describe('advanceChainHead', () => {
  it('seeds a record on first observation', () => {
    expect(advanceChainHead(null, 100, T0)).toEqual({
      head: 100,
      headFirstSeenAt: T0,
      lastCheckedAt: T0,
    });
  });

  it('restarts the stall clock when the head advances', () => {
    const prev: ChainHeadRecord = { head: 100, headFirstSeenAt: T0, lastCheckedAt: T0 + HOUR };
    expect(advanceChainHead(prev, 101, T0 + 2 * HOUR)).toEqual({
      head: 101,
      headFirstSeenAt: T0 + 2 * HOUR,
      lastCheckedAt: T0 + 2 * HOUR,
    });
  });

  it('preserves headFirstSeenAt when the head repeats — this is what accumulates stall', () => {
    const prev: ChainHeadRecord = { head: 100, headFirstSeenAt: T0, lastCheckedAt: T0 };
    const next = advanceChainHead(prev, 100, T0 + 3 * HOUR);
    expect(next.headFirstSeenAt).toBe(T0);
    expect(next.lastCheckedAt).toBe(T0 + 3 * HOUR);
    expect(next.head).toBe(100);
  });

  it('never moves the head backwards for a lagging indexer', () => {
    const prev: ChainHeadRecord = { head: 500, headFirstSeenAt: T0, lastCheckedAt: T0 };
    const next = advanceChainHead(prev, 400, T0 + HOUR);
    expect(next.head).toBe(500);
    expect(next.headFirstSeenAt).toBe(T0);
  });

  it('ignores unusable readings rather than recording a check', () => {
    const prev: ChainHeadRecord = { head: 500, headFirstSeenAt: T0, lastCheckedAt: T0 };
    for (const bad of [0, -1, NaN, Infinity]) {
      expect(advanceChainHead(prev, bad, T0 + HOUR)).toEqual(prev);
    }
  });

  it('does not crash with no prior record and an unusable reading', () => {
    expect(advanceChainHead(null, NaN, T0).head).toBe(0);
  });
});

describe('classifyLiveness', () => {
  const rec = (headFirstSeenAt: number, lastCheckedAt: number, head = 100): ChainHeadRecord => ({
    head,
    headFirstSeenAt,
    lastCheckedAt,
  });

  it('is unknown with no record', () => {
    expect(classifyLiveness(null, T0).liveness).toBe('unknown');
    expect(classifyLiveness(undefined, T0).liveness).toBe('unknown');
  });

  it('is unknown for a zero head', () => {
    expect(classifyLiveness(rec(T0, T0, 0), T0).liveness).toBe('unknown');
  });

  it('is live when the head moved within the window', () => {
    // Sampled 10 min ago, head first seen 10 min ago: it advanced last run.
    const v = classifyLiveness(rec(T0 - 10 * MIN, T0 - 10 * MIN), T0);
    expect(v.liveness).toBe('live');
    expect(v.stalledForMs).toBe(0);
  });

  it('tolerates the 30-minute sampling interval without crying stalled', () => {
    // Worst case for a healthy chain: head last advanced one full interval ago.
    const v = classifyLiveness(rec(T0 - 30 * MIN, T0), T0);
    expect(v.liveness).toBe('live');
  });

  it('is stalled once the observed gap crosses the threshold', () => {
    const v = classifyLiveness(rec(T0 - STALL_AFTER_MS, T0), T0);
    expect(v.liveness).toBe('stalled');
    expect(v.stalledForMs).toBe(STALL_AFTER_MS);
  });

  it('is halted once the observed gap crosses the halt threshold', () => {
    const v = classifyLiveness(rec(T0 - HALT_AFTER_MS, T0), T0);
    expect(v.liveness).toBe('halted');
  });

  it('catches the Celo case: 85 hours frozen', () => {
    const v = classifyLiveness(rec(T0 - 85 * HOUR, T0), T0);
    expect(v.liveness).toBe('halted');
    expect(formatStallDuration(v.stalledForMs)).toBe('3d 13h');
  });

  it('catches the Moonbeam case: 22 hours frozen', () => {
    const v = classifyLiveness(rec(T0 - 22 * HOUR, T0), T0);
    expect(v.liveness).toBe('halted');
  });

  it('measures stall over the OBSERVED window, not against now', () => {
    // Head froze 10h ago but we only watched for 1h before our sampling lapsed.
    // We may only assert the hour we actually saw.
    const v = classifyLiveness(rec(T0 - 10 * HOUR, T0 - 9 * HOUR), T0 - 9 * HOUR + MIN);
    expect(v.stalledForMs).toBe(HOUR);
  });

  it('refuses to call a chain stalled when WE stopped looking', () => {
    // A frozen head, but our newest reading is older than the observation window.
    const v = classifyLiveness(rec(T0 - 10 * HOUR, T0 - 3 * HOUR), T0);
    expect(v.liveness).toBe('unknown');
    expect(v.observationAgeMs).toBe(3 * HOUR);
  });

  it('still reports the last known head when the verdict is unknown', () => {
    const v = classifyLiveness(rec(T0 - 10 * HOUR, T0 - 3 * HOUR, 4242), T0);
    expect(v.liveness).toBe('unknown');
    expect(v.head).toBe(4242);
  });

  it('is live right up to the edge of the observation window', () => {
    const v = classifyLiveness(rec(T0 - OBSERVATION_MAX_AGE_MS, T0 - OBSERVATION_MAX_AGE_MS), T0);
    expect(v.liveness).not.toBe('unknown');
  });

  it('honours threshold overrides', () => {
    const v = classifyLiveness(rec(T0 - 5 * MIN, T0), T0, { stallAfterMs: MIN, haltAfterMs: 2 * MIN });
    expect(v.liveness).toBe('halted');
  });

  it('never reports a negative duration if timestamps arrive out of order', () => {
    const v = classifyLiveness(rec(T0, T0 - HOUR), T0);
    expect(v.stalledForMs).toBe(0);
    expect(v.observationAgeMs).toBeGreaterThanOrEqual(0);
  });
});

describe('formatStallDuration', () => {
  it.each([
    [0, '0m'],
    [45 * MIN, '45m'],
    [90 * MIN, '1h'],
    [22 * HOUR, '22h'],
    [47 * HOUR, '47h'],
    [48 * HOUR, '2d 0h'],
    [85 * HOUR, '3d 13h'],
  ])('formats %ims as %s', (ms, expected) => {
    expect(formatStallDuration(ms)).toBe(expected);
  });
});

describe('livenessMessage', () => {
  it('says nothing for a live chain', () => {
    expect(livenessMessage(classifyLiveness({ head: 1, headFirstSeenAt: T0, lastCheckedAt: T0 }, T0), 'mainnet')).toBeNull();
  });

  it('tells a halted-chain user their subgraph is frozen rather than broken', () => {
    const v = classifyLiveness({ head: 1_234_567, headFirstSeenAt: T0 - 22 * HOUR, lastCheckedAt: T0 }, T0);
    const msg = livenessMessage(v, 'moonbeam')!;
    expect(msg).toContain('frozen');
    expect(msg).toContain('not broken');
    expect(msg).toContain('Historical queries remain correct');
  });

  it('does not claim to know whether the chain or the indexers stopped', () => {
    const v = classifyLiveness({ head: 100, headFirstSeenAt: T0 - 2 * HOUR, lastCheckedAt: T0 }, T0);
    const msg = livenessMessage(v, 'celo')!;
    expect(msg).toContain('Either the chain has stopped or every indexer');
  });
});
