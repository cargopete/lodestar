import { NextRequest, NextResponse } from 'next/server';
import { db, hasDbAccess } from '@/lib/db';
import { withCronTracking } from '@/lib/cron-runs';
import { dispatchDipsNotifications } from '@/lib/notifications/dips';
import { nuthatchEnabled } from '@/lib/nuthatch';
import { isCronAuthorized } from '@/lib/cron-auth';
import { log } from '@/lib/logger';

export const maxDuration = 60;

/**
 * Watches the DIPS allocation and alerts when it moves.
 *
 * Every Direct Indexer Payments contract is live on Arbitrum One with the indexing-agreement
 * allocation at zero, so the whole thing turns on one governance transaction. Ten minutes is a
 * sensible granularity for an event nobody can predict the hour of.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!hasDbAccess() || !db) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }
  if (!nuthatchEnabled('NUTHATCH_DIPS')) {
    return NextResponse.json({ ok: true, skipped: 'dips-nest not configured' });
  }

  try {
    const result = await withCronTracking(db, 'check-dips', async () => {
      const r = await dispatchDipsNotifications(db!);
      return { ...r, count: r.events.length };
    });
    log.cron.info({ step: 'check-dips', ...result }, 'DIPS check complete');
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    log.cron.error({ err: error, step: 'check-dips' }, 'DIPS check failed');
    return NextResponse.json({ error: 'DIPS check failed' }, { status: 500 });
  }
}
