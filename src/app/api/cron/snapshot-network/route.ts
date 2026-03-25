import { NextRequest, NextResponse } from 'next/server';
import { db, hasDbAccess } from '@/lib/db';
import { hasSubgraphAccess } from '@/lib/subgraph';
import { writeNetworkSnapshot } from '@/lib/ingest/network-snapshot';

export const maxDuration = 30;

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

    // Try to grab GRT price for snapshot enrichment
    let grtPriceUsd: number | undefined;
    try {
      const priceRes = await fetch(`${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/api/price`);
      if (priceRes.ok) {
        const priceData = await priceRes.json();
        grtPriceUsd = priceData.price;
      }
    } catch {
      // Price fetch is best-effort
    }

    await writeNetworkSnapshot(db, { grtPriceUsd });
    const duration = Date.now() - start;
    console.log(`Network snapshot captured in ${duration}ms`);
    return NextResponse.json({ ok: true, durationMs: duration });
  } catch (error) {
    console.error('Network snapshot failed:', error);
    return NextResponse.json(
      { error: 'Network snapshot failed', details: String(error) },
      { status: 500 }
    );
  }
}
