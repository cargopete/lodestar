import { NextRequest, NextResponse } from 'next/server';
import { db, hasDbAccess } from '@/lib/db';
import { hasSubgraphAccess } from '@/lib/subgraph';
import { ingestRav } from '@/lib/ingest/rav';
import { withCronTracking } from '@/lib/cron-runs';
import { log } from '@/lib/logger';

export const maxDuration = 300;

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
  if (!hasSubgraphAccess()) {
    return NextResponse.json({ error: 'No API key configured' }, { status: 503 });
  }

  // ?backfill=1 does a full historical pull (resumable via the rav cursor).
  const backfill = request.nextUrl.searchParams.get('backfill') === '1';

  try {
    const result = await withCronTracking(db!, 'rav', () => ingestRav(db!, { backfill }));
    log.cron.info(
      { step: 'rav', ingested: result.ingested, durationMs: result.durationMs, backfill },
      'RAV ingestion complete',
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    log.cron.error({ err: error, step: 'rav' }, 'RAV ingestion failed');
    return NextResponse.json({ error: 'RAV ingestion failed' }, { status: 500 });
  }
}
