import { NextRequest, NextResponse } from 'next/server';
import { db, hasDbAccess } from '@/lib/db';
import { hasSubgraphAccess } from '@/lib/subgraph';
import { ingestQos } from '@/lib/ingest/qos';
import { computeAndStoreQosScores } from '@/lib/qos-aggregate';
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

  const backfill = request.nextUrl.searchParams.get('backfill') === '1';
  const daysParam = request.nextUrl.searchParams.get('days');
  const days = daysParam ? Number(daysParam) : undefined;

  try {
    const result = await withCronTracking(db!, 'qos', async () => {
      const ingest = await ingestQos(db!, { backfill, days });
      // Recompute per-indexer quality scores from the refreshed window.
      const scored = await computeAndStoreQosScores(db!);
      return { ...ingest, scored: scored.scored };
    });
    log.cron.info(
      { step: 'qos', ingested: result.ingested, scored: result.scored, durationMs: result.durationMs, backfill },
      'QoS ingestion + scoring complete',
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    log.cron.error({ err: error, step: 'qos' }, 'QoS ingestion failed');
    return NextResponse.json({ error: 'QoS ingestion failed' }, { status: 500 });
  }
}
