import { NextRequest, NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { db, hasDbAccess } from '@/lib/db';
import { getIndexerRevenue, REVENUE_WINDOWS, type RevenueWindow } from '@/lib/rav';
import { log } from '@/lib/logger';

// GET /api/indexer/[address]/revenue?window=30&byDeployment=1
// Combined query-fee (RAV) + indexing-reward revenue over a rolling window.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params;
  const addr = address.toLowerCase();

  if (!/^0x[0-9a-f]{40}$/.test(addr)) {
    return NextResponse.json({ error: 'Invalid address format' }, { status: 400 });
  }
  if (!hasDbAccess() || !db) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  const windowParam = Number(request.nextUrl.searchParams.get('window') ?? 30);
  const windowDays: RevenueWindow = (REVENUE_WINDOWS as number[]).includes(windowParam)
    ? (windowParam as RevenueWindow)
    : 30;
  const byDeployment = request.nextUrl.searchParams.get('byDeployment') === '1';

  try {
    const cacheKey = `lodestar:indexer:revenue:${addr}:${windowDays}:${byDeployment ? 1 : 0}`;
    const data = await cached(cacheKey, 300, () =>
      getIndexerRevenue(db!, addr, { windowDays, byDeployment }),
    );

    return NextResponse.json({ data }, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
    });
  } catch (error) {
    log.api.error({ err: error }, 'Indexer revenue error');
    return NextResponse.json({ error: 'Failed to fetch revenue' }, { status: 500 });
  }
}
