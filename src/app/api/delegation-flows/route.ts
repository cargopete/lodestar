import { NextRequest, NextResponse } from 'next/server';
import { db, hasDbAccess } from '@/lib/db';
import { cached } from '@/lib/cache';

export interface DelegationFlowPoint {
  date: string;
  inflows: number;
  outflows: number;
  net: number;
}

const ALLOWED_DAYS = new Set([30, 90, 180, 365]);

export async function GET(request: NextRequest) {
  if (!hasDbAccess() || !db) {
    return NextResponse.json({ data: [] });
  }

  const params = request.nextUrl.searchParams;
  const days = ALLOWED_DAYS.has(Number(params.get('days')))
    ? Number(params.get('days'))
    : 90;

  const cacheKey = `lodestar:delegation-flows:${days}`;

  try {
    const data = await cached<DelegationFlowPoint[]>(cacheKey, 600, async () => {
      const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
      const rows = await db!`
        SELECT
          DATE(timestamp) AS date,
          COALESCE(SUM(CASE
            WHEN event_type = 'delegation' THEN tokens_grt
            ELSE 0
          END), 0) AS inflows,
          COALESCE(SUM(CASE
            WHEN event_type = 'undelegation' THEN tokens_grt
            ELSE 0
          END), 0) AS outflows
        FROM delegation_events
        WHERE timestamp >= ${cutoff}
          AND timestamp IS NOT NULL
        GROUP BY DATE(timestamp)
        ORDER BY DATE(timestamp) ASC
      `;

      return rows.map((r) => ({
        date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10),
        inflows: Number(r.inflows),
        outflows: Number(r.outflows),
        net: Number(r.inflows) - Number(r.outflows),
      }));
    });

    return NextResponse.json(
      { data },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=1200',
        },
      },
    );
  } catch (error) {
    console.error('Delegation flows error:', error);
    return NextResponse.json({ data: [] });
  }
}
