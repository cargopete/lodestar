import { NextRequest, NextResponse } from 'next/server';
import { db, hasDbAccess } from '@/lib/db';
import { hasSubgraphAccess } from '@/lib/subgraph';
import { nuthatchEnabled } from '@/lib/nuthatch';
import { writeNetworkSnapshot } from '@/lib/ingest/network-snapshot';
import { withCronTracking } from '@/lib/cron-runs';
import { log } from '@/lib/logger';

export const maxDuration = 30;

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
  // The key gates the gateway path only; on the nest path (nuthatch#1160) it is not consulted.
  if (!nuthatchEnabled('NUTHATCH_NETWORK') && !hasSubgraphAccess()) {
    return NextResponse.json({ error: 'No API key configured' }, { status: 503 });
  }

  try {
    // Try to grab GRT price for snapshot enrichment
    let grtPriceUsd: number | undefined;
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
    if (siteUrl) {
      try {
        const priceRes = await fetch(`${siteUrl}/api/price`, { signal: AbortSignal.timeout(5000) });
        if (priceRes.ok) {
          const priceData = await priceRes.json();
          grtPriceUsd = typeof priceData.price === 'number' ? priceData.price : undefined;
        }
      } catch {
        // Price fetch is best-effort
      }
    }

    const result = await withCronTracking(db!, 'snapshot', async () => {
      await writeNetworkSnapshot(db!, { grtPriceUsd });
      return { ingested: 1 };
    });

    log.cron.info({ step: 'snapshot', durationMs: result.durationMs }, 'Network snapshot captured');
    return NextResponse.json({ ok: true, durationMs: result.durationMs });
  } catch (error) {
    log.cron.error({ err: error, step: 'snapshot' }, 'Network snapshot failed');
    return NextResponse.json(
      { error: 'Network snapshot failed' },
      { status: 500 }
    );
  }
}
