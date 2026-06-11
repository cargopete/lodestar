import { NextRequest, NextResponse } from 'next/server';
import { db, hasDbAccess } from '@/lib/db';
import { withCronTracking } from '@/lib/cron-runs';
import { dispatchDisputeNotifications } from '@/lib/notifications/dispatch';
import { log } from '@/lib/logger';

export const maxDuration = 60;

function isAuthorized(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  return request.headers.get('authorization') === `Bearer ${cronSecret}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!hasDbAccess() || !db) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  try {
    const result = await withCronTracking(db, 'dispatch-notifications', () =>
      dispatchDisputeNotifications(db!),
    );
    log.cron.info(
      { step: 'dispatch-notifications', disputes: result.disputes, delivered: result.delivered },
      'Notification dispatch complete',
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    log.cron.error({ err: error, step: 'dispatch-notifications' }, 'Notification dispatch failed');
    return NextResponse.json({ error: 'Notification dispatch failed' }, { status: 500 });
  }
}
