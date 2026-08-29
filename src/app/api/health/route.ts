import { NextRequest, NextResponse } from 'next/server';
import { db, hasDbAccess } from '@/lib/db';
import { getRedisClient, hasRedis } from '@/lib/cache';
import { log } from '@/lib/logger';
import {
  assessCrons,
  failingCrons,
  staleCrons,
  type CronRunRow,
  type CronStatus,
} from '@/lib/cron-expectations';
import { isCronAuthorized } from '@/lib/cron-auth';

// Staleness thresholds in minutes per ingestion type
const FRESHNESS_THRESHOLDS: Record<string, number> = {
  epochs: 120,         // ~2 hours
  allocations: 360,    // ~6 hours
  delegation_events: 360,
  disputes: 1440,      // ~24 hours (infrequent)
};

interface ComponentStatus {
  status: 'up' | 'down';
  latency_ms: number;
  error?: string;
}

interface IngestionStatus {
  last_updated: string | null;
  age_minutes: number | null;
  healthy: boolean;
}

export async function GET(request: NextRequest) {
  const start = Date.now();

  // Verbose mode requires auth
  const verbose = request.nextUrl.searchParams.get('verbose') === 'true';
  const isAuthed = isCronAuthorized(request);

  // ── Postgres probe ──
  let postgres: ComponentStatus;
  if (!hasDbAccess() || !db) {
    postgres = { status: 'down', latency_ms: 0, error: 'DATABASE_URL not configured' };
  } else {
    const pgStart = Date.now();
    try {
      await db`SELECT 1`;
      postgres = { status: 'up', latency_ms: Date.now() - pgStart };
    } catch (e) {
      postgres = { status: 'down', latency_ms: Date.now() - pgStart, error: String(e) };
    }
  }

  // ── Redis probe ──
  let redisStatus: ComponentStatus;
  const redisStart = Date.now();
  if (!hasRedis()) {
    redisStatus = { status: 'down', latency_ms: 0, error: 'Redis not configured' };
  } else {
    try {
      await (await getRedisClient()).ping();
      redisStatus = { status: 'up', latency_ms: Date.now() - redisStart };
    } catch (e) {
      redisStatus = { status: 'down', latency_ms: Date.now() - redisStart, error: String(e) };
    }
  }

  // ── Ingestion freshness ──
  const ingestion: Record<string, IngestionStatus> = {};
  if (postgres.status === 'up' && db) {
    try {
      const rows = await db`SELECT key, updated_at FROM ingestion_state`;
      const now = Date.now();

      for (const row of rows) {
        const updatedAt = row.updated_at ? new Date(row.updated_at).getTime() : null;
        const ageMinutes = updatedAt ? Math.round((now - updatedAt) / 60000) : null;
        const threshold = FRESHNESS_THRESHOLDS[row.key] ?? 360;
        const healthy = ageMinutes !== null ? ageMinutes <= threshold : false;

        ingestion[row.key] = {
          last_updated: row.updated_at ?? null,
          age_minutes: ageMinutes,
          healthy,
        };
      }
    } catch (e) {
      log.health.warn({ err: e }, 'Failed to query ingestion state');
    }
  }

  // ── Last cron run (if table exists) ──
  const lastCronRuns: Record<string, { last_run: string; duration_ms: number; success: boolean }> = {};
  let cronStatuses: CronStatus[] = [];
  if (postgres.status === 'up' && db) {
    try {
      const runs = await db<CronRunRow[]>`
        SELECT DISTINCT ON (step) step, started_at, duration_ms, success
        FROM cron_runs
        ORDER BY step, started_at DESC
      `;
      for (const r of runs) {
        lastCronRuns[r.step] = {
          last_run: r.started_at as unknown as string,
          duration_ms: r.duration_ms as number,
          success: r.success,
        };
      }
      cronStatuses = assessCrons(runs);
    } catch {
      // Table might not exist yet — that's fine
    }
  }

  // ── Overall status ──
  //
  // A stale cron does NOT degrade this, and that is a deliberate restraint rather than an
  // oversight. `status` is what an uptime monitor pages on; folding a new condition into it would
  // change the meaning of an existing contract from the inside, and the first anyone would learn of
  // it is an alert at three in the morning about a job that has been quiet for a week. The staleness
  // is published in `crons` below, where a reader or a monitor can opt into it deliberately. Worth
  // revisiting once the cadences below have been observed to be right rather than merely plausible.
  const allIngestionHealthy = Object.values(ingestion).every((i) => i.healthy);
  const status =
    postgres.status === 'down' ? 'unhealthy' :
    redisStatus.status === 'down' || !allIngestionHealthy ? 'degraded' :
    'healthy';

  const body: Record<string, unknown> = {
    status,
    timestamp: new Date().toISOString(),
    latency_ms: Date.now() - start,
    components: {
      postgres: verbose && isAuthed ? postgres : { status: postgres.status, latency_ms: postgres.latency_ms },
      redis: verbose && isAuthed ? redisStatus : { status: redisStatus.status, latency_ms: redisStatus.latency_ms },
    },
    ingestion,
  };

  if (Object.keys(lastCronRuns).length > 0) {
    // Kept in its original shape: something out there may already read it, and quietly changing a
    // health endpoint's contract is how a monitor starts reporting green about a field that moved.
    body.cron_runs = lastCronRuns;
  }
  if (cronStatuses.length > 0) {
    const stale = staleCrons(cronStatuses);
    const failing = failingCrons(cronStatuses);
    // The judgement the old surface left to whoever happened to be reading, and to whether they
    // remembered each job's cadence.
    body.crons = {
      tracked: cronStatuses.length,
      stale: stale.map((s) => ({ step: s.step, age_minutes: s.ageMinutes, what: s.what, where: s.where })),
      failing: failing.map((s) => ({ step: s.step, what: s.what, where: s.where })),
      // Named rather than hidden, so a decommissioned job stops reading as a broken one.
      retired: cronStatuses.filter((s) => s.retired).map((s) => ({ step: s.step, why: s.retired })),
      detail: cronStatuses,
    };
  }

  const httpStatus = status === 'unhealthy' ? 503 : 200;

  log.health.info({ status, latency_ms: Date.now() - start }, 'Health check');

  return NextResponse.json(body, { status: httpStatus });
}
