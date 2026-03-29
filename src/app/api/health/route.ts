import { NextRequest, NextResponse } from 'next/server';
import { db, hasDbAccess } from '@/lib/db';
import { redis } from '@/lib/cache';
import { log } from '@/lib/logger';

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
  const cronSecret = process.env.CRON_SECRET;
  const isAuthed = !cronSecret || request.headers.get('authorization') === `Bearer ${cronSecret}`;

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
  try {
    await redis.ping();
    redisStatus = { status: 'up', latency_ms: Date.now() - redisStart };
  } catch (e) {
    redisStatus = { status: 'down', latency_ms: Date.now() - redisStart, error: String(e) };
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
  if (postgres.status === 'up' && db) {
    try {
      const runs = await db`
        SELECT DISTINCT ON (step) step, started_at, duration_ms, success
        FROM cron_runs
        ORDER BY step, started_at DESC
      `;
      for (const r of runs) {
        lastCronRuns[r.step] = {
          last_run: r.started_at,
          duration_ms: r.duration_ms,
          success: r.success,
        };
      }
    } catch {
      // Table might not exist yet — that's fine
    }
  }

  // ── Overall status ──
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
    body.cron_runs = lastCronRuns;
  }

  const httpStatus = status === 'unhealthy' ? 503 : 200;

  log.health.info({ status, latency_ms: Date.now() - start }, 'Health check');

  return NextResponse.json(body, { status: httpStatus });
}
