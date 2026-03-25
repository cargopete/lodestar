import { NextRequest, NextResponse } from 'next/server';
import { db, hasDbAccess } from '@/lib/db';
import { hasSubgraphAccess } from '@/lib/subgraph';
import { ingestDisputes } from '@/lib/ingest/disputes';

export const maxDuration = 60;

function isAuthorized(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return true;
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
    const start = Date.now();
    const result = await ingestDisputes(db);
    const duration = Date.now() - start;
    console.log(`Dispute ingestion: ${result.ingested} disputes in ${duration}ms`);
    return NextResponse.json({ ok: true, ...result, durationMs: duration });
  } catch (error) {
    console.error('Dispute ingestion failed:', error);
    return NextResponse.json(
      { error: 'Dispute ingestion failed', details: String(error) },
      { status: 500 }
    );
  }
}
