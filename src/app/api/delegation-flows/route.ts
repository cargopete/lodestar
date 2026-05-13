import { NextRequest, NextResponse } from 'next/server';
import { db, hasDbAccess } from '@/lib/db';
import { cached } from '@/lib/cache';
import { delegationEventsQuery, hasSubgraphAccess } from '@/lib/subgraph';
import { log } from '@/lib/logger';

export interface DelegationFlowPoint {
  date: string;
  inflows: number;
  outflows: number;
  net: number;
}

const ALLOWED_DAYS = new Set([30, 60, 90, 180, 360, 365, 730]);

async function fetchFromSubgraph(days: number): Promise<DelegationFlowPoint[]> {
  const cutoff = Math.floor((Date.now() - days * 86400_000) / 1000).toString();

  // Paginate up to 5000 events (5 pages × 1000)
  const MAX_PAGES = 5;
  const allEvents: Array<{ eventType: string; tokens: string; timestamp: string }> = [];
  let cursor = cutoff;

  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await delegationEventsQuery<{
      delegationEvents: Array<{ eventType: string; tokens: string; timestamp: string }>;
    }>(`{
      delegationEvents(
        first: 1000
        orderBy: timestamp
        orderDirection: asc
        where: { timestamp_gt: "${cursor}" }
      ) {
        eventType
        tokens
        timestamp
      }
    }`);

    const events = result.delegationEvents;
    if (events.length === 0) break;
    allEvents.push(...events);
    cursor = events[events.length - 1].timestamp;
    if (events.length < 1000) break;
  }

  // Group by date (UTC)
  const grouped = new Map<string, { inflows: number; outflows: number }>();
  for (const event of allEvents) {
    const date = new Date(parseInt(event.timestamp) * 1000).toISOString().slice(0, 10);
    const existing = grouped.get(date) ?? { inflows: 0, outflows: 0 };
    const grt = parseFloat(event.tokens) / 1e18;
    if (event.eventType === 'delegation') {
      existing.inflows += grt;
    } else if (event.eventType === 'undelegation') {
      existing.outflows += grt;
    }
    grouped.set(date, existing);
  }

  return Array.from(grouped.entries())
    .map(([date, { inflows, outflows }]) => ({ date, inflows, outflows, net: inflows - outflows }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const baseDays = ALLOWED_DAYS.has(Number(params.get('days')))
    ? Number(params.get('days'))
    : 90;
  const compare = params.get('compare') === '1';
  const days = compare ? baseDays * 2 : baseDays;

  const cacheKey = `lodestar:delegation-flows:v3:${days}`;

  try {
    const data = await cached<DelegationFlowPoint[]>(cacheKey, 600, async () => {
      // Try DB first
      if (hasDbAccess() && db) {
        try {
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

          if (rows.length > 0) {
            return rows.map((r) => ({
              date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10),
              inflows: Number(r.inflows),
              outflows: Number(r.outflows),
              net: Number(r.inflows) - Number(r.outflows),
            }));
          }
        } catch {
          // DB unreachable or query failed — fall through to subgraph
        }
      }

      // DB empty, unavailable, or failed — fall back to subgraph
      if (!hasSubgraphAccess()) return [];
      return fetchFromSubgraph(days);
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
    log.api.error({ err: error }, 'Delegation flows error');
    return NextResponse.json({ data: [] });
  }
}
