// What each cron step is supposed to do, and how late is too late.
//
// `/api/health` used to report `cron_runs` as a bare list of last-run timestamps: every step that
// ever ran, newest row per step, no judgement. Two things were wrong with that, and the second is
// the one that matters.
//
// **A retired step lingers forever looking broken.** `compute-scores` last ran on 1 August and
// showed up next to jobs that ran minutes ago. It is not broken; it was folded into `refresh` and
// the switch case removed. But a reader — including me, an hour ago — sees a 28-day-old timestamp
// and concludes a job has stopped. A monitoring surface that cries wolf about a decommissioned job
// teaches people to ignore staleness in that table, and the next genuinely stopped cron goes with
// it.
//
// **Nothing computed staleness at all.** The endpoint published `last_run` and left the reader to
// know each job's cadence from memory. That is the same shape as reading a registry and calling it
// liveness: the data is there and the judgement is not, so the failure is silent until somebody
// happens to look and happens to know.
//
// So: declare the cadence, declare what is retired, and let the endpoint say `stale: true` rather
// than making every reader do the arithmetic.

export interface CronExpectation {
  /** The `step` name written to `cron_runs`. */
  step: string;
  /**
   * How long after its last run a step is late, in minutes.
   *
   * Generous on purpose — roughly three times the schedule — because a single missed tick is a
   * blip and an alert that fires on blips is an alert nobody reads. This is for "it stopped", not
   * for "it was slow once".
   */
  staleAfterMinutes: number;
  /** Where it is scheduled, because the answer changes where you go to fix it. */
  where: 'vercel' | 'droplet';
  what: string;
}

/**
 * Steps that used to run and deliberately no longer do.
 *
 * Listed rather than deleted from the table: their rows stay in `cron_runs` as history, and naming
 * them here is what stops that history reading as a fault. Removing the row would lose the record;
 * leaving it unexplained is what caused the confusion.
 */
export const RETIRED_CRONS: Record<string, string> = {
  'compute-scores':
    'folded into `refresh`, which computes the composite score in the same pass. The runner has no such case any more.',
};

export const CRON_EXPECTATIONS: CronExpectation[] = [
  // ── The droplet runner (scripts/cron-runner.ts, system cron) ───────────────
  { step: 'refresh', staleAfterMinutes: 20, where: 'droplet', what: 'the enrichment pipeline, and where indexer scores are computed' },
  { step: 'snapshot', staleAfterMinutes: 20, where: 'droplet', what: 'network snapshot' },
  { step: 'delegations', staleAfterMinutes: 60, where: 'droplet', what: 'delegation events' },
  { step: 'epochs', staleAfterMinutes: 45, where: 'droplet', what: 'epoch ingestion' },
  { step: 'allocations', staleAfterMinutes: 180, where: 'droplet', what: 'allocation deltas' },
  { step: 'disputes', staleAfterMinutes: 1080, where: 'droplet', what: 'disputes, every six hours' },

  // ── Vercel crons (vercel.json) ────────────────────────────────────────────
  { step: 'qos', staleAfterMinutes: 1080, where: 'vercel', what: 'QoS oracle ingestion, every six hours' },
  { step: 'rav', staleAfterMinutes: 180, where: 'vercel', what: 'RAV ingestion' },
  { step: 'check-dips', staleAfterMinutes: 40, where: 'vercel', what: 'watches the DIPS allocation for the governance change that turns it on' },
  { step: 'check-provider-liveness', staleAfterMinutes: 60, where: 'vercel', what: 'registry versus reality for data-service providers' },
  { step: 'check-nest-health', staleAfterMinutes: 60, where: 'vercel', what: 'the nuthatch nests this dashboard stands on' },
  { step: 'dispatch-notifications', staleAfterMinutes: 40, where: 'vercel', what: 'push notifications' },
];

export interface CronStatus {
  step: string;
  lastRun: string | null;
  durationMs: number | null;
  success: boolean | null;
  /** Later than its declared window, or never seen at all. */
  stale: boolean;
  ageMinutes: number | null;
  where?: 'vercel' | 'droplet';
  what?: string;
  /** Present only for a step in `RETIRED_CRONS`, and it explains itself. */
  retired?: string;
}

export interface CronRunRow {
  step: string;
  started_at: string | Date;
  duration_ms: number | null;
  success: boolean;
}

/**
 * Turn raw rows into a verdict.
 *
 * A declared step with no row at all is stale, not absent: "it has never run" and "it stopped" are
 * both reasons to look, and reporting the first as silence would hide a job that was scheduled and
 * never fired once.
 */
export function assessCrons(rows: CronRunRow[], now = Date.now()): CronStatus[] {
  const byStep = new Map(rows.map((r) => [r.step, r]));
  const out: CronStatus[] = [];

  for (const exp of CRON_EXPECTATIONS) {
    const row = byStep.get(exp.step);
    const lastRun = row ? new Date(row.started_at) : null;
    const ageMinutes = lastRun ? Math.round((now - lastRun.getTime()) / 60_000) : null;
    out.push({
      step: exp.step,
      lastRun: lastRun ? lastRun.toISOString() : null,
      durationMs: row?.duration_ms ?? null,
      success: row?.success ?? null,
      // A step whose last run failed is not stale, it is failing — a different thing, reported by
      // `success`. Conflating them would hide a job that runs punctually and errors every time.
      stale: ageMinutes === null || ageMinutes > exp.staleAfterMinutes,
      ageMinutes,
      where: exp.where,
      what: exp.what,
    });
  }

  // Anything in the table that nobody declared. Retired steps explain themselves; a genuinely
  // unknown one is surfaced rather than dropped, because a step writing rows that no expectation
  // covers is either a new job nobody registered here or a stray, and both are worth seeing.
  for (const row of rows) {
    if (CRON_EXPECTATIONS.some((e) => e.step === row.step)) continue;
    const lastRun = new Date(row.started_at);
    out.push({
      step: row.step,
      lastRun: lastRun.toISOString(),
      durationMs: row.duration_ms,
      success: row.success,
      stale: false,
      ageMinutes: Math.round((now - lastRun.getTime()) / 60_000),
      retired: RETIRED_CRONS[row.step] ?? 'not declared in CRON_EXPECTATIONS',
    });
  }

  return out;
}

/** The steps a reader should go and look at. */
export function staleCrons(statuses: CronStatus[]): CronStatus[] {
  return statuses.filter((s) => s.stale && !s.retired);
}

/** The steps that ran on time and failed, which is a different fault entirely. */
export function failingCrons(statuses: CronStatus[]): CronStatus[] {
  return statuses.filter((s) => !s.stale && s.success === false);
}
