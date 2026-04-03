import { NextRequest, NextResponse } from 'next/server';
import { db, hasDbAccess } from '@/lib/db';
import { hasSubgraphAccess } from '@/lib/subgraph';
import { ingestAllocations } from '@/lib/ingest/allocations';
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

  try {
    const result = await withCronTracking(db!, 'allocations', () => ingestAllocations(db!));
    log.cron.info({ step: 'allocations', ingested: result.ingested, durationMs: result.durationMs }, 'Allocation ingestion complete');
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    log.cron.error({ err: error, step: 'allocations' }, 'Allocation ingestion failed');
    return NextResponse.json(
      { error: 'Allocation ingestion failed' },
      { status: 500 }
    );
  }
}
