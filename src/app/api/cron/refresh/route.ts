import { NextRequest, NextResponse } from 'next/server';
import { db, hasDbAccess } from '@/lib/db';
import { refreshIndexers } from '@/lib/refresh';
import { recordCronRun } from '@/lib/cron-runs';
import { log } from '@/lib/logger';

function isAuthorized(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  return request.headers.get('authorization') === `Bearer ${cronSecret}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = new Date();
  const start = Date.now();
  const sql = hasDbAccess() ? db : null;

  try {
    const result = await refreshIndexers({
      sql,
      writeToRedis: true,
    });

    log.cron.info({ step: 'refresh', count: result.count, durationMs: result.durationMs }, 'Cron refresh complete');

    if (sql) {
      await recordCronRun(sql, {
        step: 'refresh',
        startedAt,
        durationMs: result.durationMs,
        rowsAffected: result.count,
        success: true,
      });
    }

    return NextResponse.json({
      ok: true,
      count: result.count,
      durationMs: result.durationMs,
    });
  } catch (error) {
    const durationMs = Date.now() - start;
    log.cron.error({ err: error, step: 'refresh', durationMs }, 'Cron refresh failed');

    if (sql) {
      await recordCronRun(sql, {
        step: 'refresh',
        startedAt,
        durationMs,
        success: false,
        errorMessage: String(error),
      });
    }

    return NextResponse.json(
      { error: 'Cron refresh failed' },
      { status: 500 }
    );
  }
}
