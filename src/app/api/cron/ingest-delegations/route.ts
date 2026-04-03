import { NextRequest, NextResponse } from 'next/server';
import { db, hasDbAccess } from '@/lib/db';
import { ingestDelegationEvents } from '@/lib/ingest/delegations';
import { withCronTracking } from '@/lib/cron-runs';
import { log } from '@/lib/logger';

export const maxDuration = 120;

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
    const result = await withCronTracking(db!, 'delegations', () => ingestDelegationEvents(db!));
    log.cron.info({ step: 'delegations', ingested: result.ingested, durationMs: result.durationMs }, 'Delegation ingestion complete');
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    log.cron.error({ err: error, step: 'delegations' }, 'Delegation ingestion failed');
    return NextResponse.json(
      { error: 'Delegation ingestion failed' },
      { status: 500 }
    );
  }
}
