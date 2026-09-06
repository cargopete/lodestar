import { NextRequest, NextResponse } from 'next/server';
import { db, hasDbAccess } from '@/lib/db';
import { withCronTracking } from '@/lib/cron-runs';
import { dispatchDipsChainNotifications } from '@/lib/notifications/dips-chain';
import { hasNuthatch } from '@/lib/nuthatch';
import { isCronAuthorized } from '@/lib/cron-auth';
import { log } from '@/lib/logger';

export const maxDuration = 60;

/**
 * Checks the DIPS nest against the chain it indexes.
 *
 * `check-dips` watches for the allocation moving. This watches for the nest being wrong about it.
 * They are different failures: `/ready` catches a nest that has stopped, and nothing catches a nest
 * that is running happily and merely missed a log. That one renders as a plausible number on the
 * dashboard, which is the worst way for it to present.
 *
 * Hourly. The allocation changes by governance transaction, not continuously, so a divergence that
 * matters will still be an hour old at worst, and the alert is edge-triggered so a standing one
 * does not become wallpaper.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!hasDbAccess() || !db) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }
  if (!hasNuthatch()) {
    return NextResponse.json({ ok: true, skipped: 'dips-nest not configured' });
  }

  try {
    const result = await withCronTracking(db, 'check-dips-chain', async () => {
      const r = await dispatchDipsChainNotifications(db!);
      return { ...r, count: r.divergences.length };
    });
    log.cron.info({ step: 'check-dips-chain', ...result }, 'DIPS chain cross-check complete');
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    log.cron.error({ err: error, step: 'check-dips-chain' }, 'DIPS chain cross-check failed');
    return NextResponse.json({ error: 'DIPS chain cross-check failed' }, { status: 500 });
  }
}
