import { NextRequest, NextResponse } from 'next/server';
import { db, hasDbAccess } from '@/lib/db';
import { hasNuthatch, nuthatchEnabled } from '@/lib/nuthatch';
import { warmIpfsCache } from '@/lib/subgraph-metadata';
import { log } from '@/lib/logger';

export const maxDuration = 60;

function isAuthorized(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  return request.headers.get('authorization') === `Bearer ${cronSecret}`;
}

/**
 * Fills the IPFS cache `api/subgraph-search` reads (nuthatch#1160, group B): subgraph metadata
 * documents for names, deployment manifests for address search. Bounded per run; the next run picks
 * up what is left. Does nothing until NUTHATCH_SUBGRAPHS is on, because the cache is only read there.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!hasDbAccess() || !db) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }
  if (!nuthatchEnabled('NUTHATCH_SUBGRAPHS') || !hasNuthatch()) {
    return NextResponse.json({ ok: true, skipped: 'NUTHATCH_SUBGRAPHS is off' });
  }
  try {
    const result = await warmIpfsCache(150);
    log.cron.info({ step: 'warm-ipfs', ...result }, 'IPFS cache warmed');
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    log.cron.error({ err: error, step: 'warm-ipfs' }, 'IPFS cache warm failed');
    return NextResponse.json({ error: 'IPFS cache warm failed' }, { status: 500 });
  }
}
