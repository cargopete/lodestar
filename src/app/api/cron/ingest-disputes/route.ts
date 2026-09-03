import { NextRequest, NextResponse } from 'next/server';
import { db, hasDbAccess } from '@/lib/db';
import { hasSubgraphAccess } from '@/lib/subgraph';
import { nuthatchEnabled } from '@/lib/nuthatch';
import { ingestDisputes } from '@/lib/ingest/disputes';
import { withCronTracking } from '@/lib/cron-runs';
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
  // The key gates only the path that uses it. With `NUTHATCH_DISPUTES` on, the ingest reads a nest and
  // never the gateway, so refusing to start without the key would keep the key load-bearing for a
  // surface that no longer needs it (lodestar#49, nuthatch#1078).
  if (!nuthatchEnabled('NUTHATCH_DISPUTES') && !hasSubgraphAccess()) {
    return NextResponse.json({ error: 'No API key configured' }, { status: 503 });
  }

  try {
    const result = await withCronTracking(db!, 'disputes', () => ingestDisputes(db!));
    log.cron.info({ step: 'disputes', ingested: result.ingested, durationMs: result.durationMs }, 'Dispute ingestion complete');
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    log.cron.error({ err: error, step: 'disputes' }, 'Dispute ingestion failed');
    return NextResponse.json(
      { error: 'Dispute ingestion failed' },
      { status: 500 }
    );
  }
}
