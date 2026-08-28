import { NextRequest, NextResponse } from 'next/server';
import { db, hasDbAccess } from '@/lib/db';
import { withCronTracking } from '@/lib/cron-runs';
import { dispatchLivenessNotifications } from '@/lib/notifications/liveness';
import { isCronAuthorized } from '@/lib/cron-auth';
import { log } from '@/lib/logger';

export const maxDuration = 60;

/**
 * Calls every registered Dispatch provider's advertised endpoint and alerts when the registry and
 * reality disagree. Fifteen minutes is fine: the outage this was built for lasted 39 days.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!hasDbAccess() || !db) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  try {
    const result = await withCronTracking(db, 'check-provider-liveness', async () => {
      const r = await dispatchLivenessNotifications(db!);
      return { ...r, count: r.transitions.length };
    });
    log.cron.info({ step: 'check-provider-liveness', ...result }, 'Provider liveness check complete');
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    log.cron.error({ err: error, step: 'check-provider-liveness' }, 'Provider liveness check failed');
    return NextResponse.json({ error: 'Provider liveness check failed' }, { status: 500 });
  }
}
