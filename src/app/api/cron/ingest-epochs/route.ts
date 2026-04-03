import { NextRequest, NextResponse } from 'next/server';
import { db, hasDbAccess } from '@/lib/db';
import { hasSubgraphAccess } from '@/lib/subgraph';
import { ingestEpochs } from '@/lib/ingest/epochs';
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
  if (!hasSubgraphAccess()) {
    return NextResponse.json({ error: 'No API key configured' }, { status: 503 });
  }

  try {
    const result = await withCronTracking(db!, 'epochs', () => ingestEpochs(db!));
    log.cron.info({ step: 'epochs', ingested: result.ingested, durationMs: result.durationMs }, 'Epoch ingestion complete');
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    log.cron.error({ err: error, step: 'epochs' }, 'Epoch ingestion failed');
    return NextResponse.json(
      { error: 'Epoch ingestion failed' },
      { status: 500 }
    );
  }
}
