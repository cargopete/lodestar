import { NextRequest, NextResponse } from 'next/server';
import { db, hasDbAccess } from '@/lib/db';
import { withCronTracking } from '@/lib/cron-runs';
import { dispatchNestHealthNotifications } from '@/lib/notifications/nest-health';
import { hasNestOrigin } from '@/lib/nest-health';
import { isCronAuthorized } from '@/lib/cron-auth';
import { log } from '@/lib/logger';

export const maxDuration = 60;

/**
 * Watches the nuthatch nests this dashboard is built on.
 *
 * Eighteen crons existed before this one and not one of them watched the box that answers the
 * delegation feed, developer activity, the DIPS panel, the SQL surface and the named-query tier.
 * On-chain checks cannot see it, and `/health` returning "ok" would not either: the failure worth
 * catching is a nest that answers instantly with three-week-old data, where every page still
 * renders and every number is quietly wrong.
 *
 * Fifteen minutes, matching the provider-liveness check, and edge-triggered for the same reason:
 * a permanently dark nest that pushed every quarter hour would train everyone to ignore it.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!hasDbAccess() || !db) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }
  if (!hasNestOrigin()) {
    return NextResponse.json({ ok: true, skipped: 'no nuthatch origin configured' });
  }

  try {
    const result = await withCronTracking(db, 'check-nest-health', async () => {
      const r = await dispatchNestHealthNotifications(db!);
      return { ...r, count: r.transitions.length };
    });
    log.cron.info({ step: 'check-nest-health', ...result }, 'nest health check complete');
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    log.cron.error({ err: error, step: 'check-nest-health' }, 'nest health check failed');
    return NextResponse.json({ error: 'nest health check failed' }, { status: 500 });
  }
}
