/**
 * The distinctions this file exists to keep apart.
 *
 * `stale` (it stopped running), `failing` (it runs on time and errors), and `retired` (it was
 * decommissioned on purpose) are three different situations with three different responses. The
 * health endpoint used to publish one undifferentiated list of timestamps, which is how a job folded
 * into another one sat there for 28 days looking broken.
 */
import { describe, it, expect } from 'vitest';
import {
  CRON_EXPECTATIONS,
  RETIRED_CRONS,
  assessCrons,
  staleCrons,
  failingCrons,
  type CronRunRow,
} from '../cron-expectations';

const NOW = Date.parse('2026-08-29T18:45:00Z');
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

const row = (step: string, m: number, success = true): CronRunRow => ({
  step,
  started_at: minutesAgo(m),
  duration_ms: 1000,
  success,
});

describe('the declared set', () => {
  it('has no duplicates and no step that is both expected and retired', () => {
    const steps = CRON_EXPECTATIONS.map((e) => e.step);
    expect(new Set(steps).size).toBe(steps.length);
    for (const s of steps) {
      expect(RETIRED_CRONS[s], `${s} is both expected and retired`).toBeUndefined();
    }
  });

  it('gives every step a window well clear of its schedule, so one missed tick is not an alarm', () => {
    for (const e of CRON_EXPECTATIONS) {
      expect(e.staleAfterMinutes, e.step).toBeGreaterThanOrEqual(20);
      expect(e.what.length, `${e.step} needs a description a reader can act on`).toBeGreaterThan(10);
    }
  });
});

describe('assessCrons', () => {
  it('calls a punctual step healthy', () => {
    const [r] = assessCrons([row('refresh', 5)], NOW).filter((s) => s.step === 'refresh');
    expect(r.stale).toBe(false);
    expect(r.ageMinutes).toBe(5);
    expect(r.where).toBe('droplet');
  });

  it('calls a step past its window stale', () => {
    const [r] = assessCrons([row('refresh', 120)], NOW).filter((s) => s.step === 'refresh');
    expect(r.stale).toBe(true);
    expect(r.ageMinutes).toBe(120);
  });

  // "Never ran" and "stopped running" are both reasons to look. Reporting the first as silence
  // would hide a job that was scheduled and never fired once.
  it('treats a declared step with no row at all as stale, not absent', () => {
    const r = assessCrons([], NOW).find((s) => s.step === 'refresh')!;
    expect(r.stale).toBe(true);
    expect(r.lastRun).toBeNull();
    expect(r.ageMinutes).toBeNull();
  });

  // The finding that prompted all of this.
  it('explains a retired step instead of letting it read as broken', () => {
    const r = assessCrons([row('compute-scores', 40_000)], NOW).find(
      (s) => s.step === 'compute-scores'
    )!;
    expect(r.retired).toContain('refresh');
    expect(r.stale).toBe(false);
    expect(staleCrons(assessCrons([row('compute-scores', 40_000)], NOW))).toHaveLength(
      // Every declared step is missing from this input, so all of them are stale — but the retired
      // one is not among them, which is the whole point.
      CRON_EXPECTATIONS.length
    );
  });

  it('surfaces an undeclared step rather than dropping it', () => {
    const r = assessCrons([row('something-new', 3)], NOW).find((s) => s.step === 'something-new')!;
    expect(r.retired).toBe('not declared in CRON_EXPECTATIONS');
  });

  // A job that runs punctually and errors every time is not stale. Conflating the two would hide it.
  it('keeps failing separate from stale', () => {
    const statuses = assessCrons([row('refresh', 2, false)], NOW);
    const refresh = statuses.find((s) => s.step === 'refresh')!;
    expect(refresh.stale).toBe(false);
    expect(refresh.success).toBe(false);
    expect(failingCrons(statuses).map((s) => s.step)).toContain('refresh');
    expect(staleCrons(statuses).map((s) => s.step)).not.toContain('refresh');
  });

  it('reports every declared step even when the table is empty', () => {
    const statuses = assessCrons([], NOW);
    expect(statuses.map((s) => s.step)).toEqual(
      expect.arrayContaining(CRON_EXPECTATIONS.map((e) => e.step))
    );
  });

  /**
   * The state production was actually in when this was written, kept as a regression: everything
   * punctual except one retired step. If a future change makes this report anything stale, either
   * a cadence is wrong or something genuinely broke.
   */
  it('reports the real production shape as healthy, with the retirement explained', () => {
    const real: CronRunRow[] = [
      row('allocations', 44),
      row('check-dips', 5),
      row('check-dips-chain', 35),
      row('check-nest-health', 0),
      row('check-provider-liveness', 0),
      row('compute-scores', 40_000),
      row('delegations', 0),
      row('dispatch-notifications', 5),
      row('disputes', 42),
      row('epochs', 5),
      row('rav', 25),
      row('refresh', 5),
      row('snapshot', 0),
    ];
    const statuses = assessCrons(real, NOW);
    expect(staleCrons(statuses)).toEqual([]);
    expect(failingCrons(statuses)).toEqual([]);
    expect(statuses.find((s) => s.step === 'compute-scores')!.retired).toBeTruthy();
  });
});
