import { NextRequest, NextResponse } from 'next/server';
import { db, hasDbAccess } from '@/lib/db';
import { ingestDelegationEvents } from '@/lib/ingest/delegations';

export const maxDuration = 120;

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

  try {
    const start = Date.now();
    const result = await ingestDelegationEvents(db);
    const duration = Date.now() - start;
    console.log(`Delegation ingestion: ${result.ingested} events in ${duration}ms`);
    return NextResponse.json({ ok: true, ...result, durationMs: duration });
  } catch (error) {
    console.error('Delegation ingestion failed:', error);
    return NextResponse.json(
      { error: 'Delegation ingestion failed', details: String(error) },
      { status: 500 }
    );
  }
}
