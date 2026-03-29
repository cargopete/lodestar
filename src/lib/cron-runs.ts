import type { DbClient } from './db';
import { log } from './logger';

interface CronRunResult {
  step: string;
  startedAt: Date;
  durationMs: number;
  rowsAffected?: number;
  success: boolean;
  errorMessage?: string;
}

/**
 * Record a cron run in the cron_runs table.
 * Best-effort — logs a warning if the insert fails but never throws.
 */
export async function recordCronRun(
  sql: DbClient,
  result: CronRunResult
): Promise<void> {
  try {
    await sql`
      INSERT INTO cron_runs (step, started_at, duration_ms, rows_affected, success, error_message)
      VALUES (
        ${result.step},
        ${result.startedAt.toISOString()},
        ${result.durationMs},
        ${result.rowsAffected ?? null},
        ${result.success},
        ${result.errorMessage ?? null}
      )
    `;
  } catch (e) {
    log.cron.warn({ err: e, step: result.step }, 'Failed to record cron run');
  }
}

/**
 * Wrap a cron step function — times it, records the result, returns it.
 */
export async function withCronTracking<T extends { ingested?: number; count?: number }>(
  sql: DbClient,
  step: string,
  fn: () => Promise<T>
): Promise<T & { durationMs: number }> {
  const startedAt = new Date();
  const start = Date.now();

  try {
    const result = await fn();
    const durationMs = Date.now() - start;
    const rowsAffected = result.ingested ?? result.count ?? undefined;

    await recordCronRun(sql, {
      step,
      startedAt,
      durationMs,
      rowsAffected,
      success: true,
    });

    return { ...result, durationMs };
  } catch (e) {
    const durationMs = Date.now() - start;

    await recordCronRun(sql, {
      step,
      startedAt,
      durationMs,
      success: false,
      errorMessage: String(e),
    });

    throw e;
  }
}
