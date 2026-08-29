import { NextRequest, NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { hasNuthatch, nuthatchSql } from '@/lib/nuthatch';
import { log } from '@/lib/logger';

export interface DelegationFlowPoint {
  date: string;
  inflows: number;
  outflows: number;
  net: number;
}

const ALLOWED_DAYS = new Set([30, 60, 90, 180, 360, 365, 730]);
const LEGACY_HISTORY_END_EXCLUSIVE = 1_787_555_748;

interface DailyFlowRow {
  date: string;
  inflows: number | string;
  outflows: number | string;
}

function dailyFlowSql(startTimestamp: number, endTimestamp: number, legacy: boolean): string {
  const events = legacy
    ? `
      SELECT block_timestamp, CAST(tokens_dec AS DOUBLE) / 1e18 AS tokens, 'inflow' AS direction
      FROM staking_legacy__stake_delegated
      UNION ALL
      SELECT block_timestamp, CAST(tokens_dec AS DOUBLE) / 1e18, 'outflow'
      FROM staking_legacy__stake_delegated_locked
      UNION ALL
      SELECT block_timestamp, CAST(tokens_dec AS DOUBLE) / 1e18, 'inflow'
      FROM staking__tokens_delegated
      UNION ALL
      SELECT block_timestamp, CAST(tokens_dec AS DOUBLE) / 1e18, 'outflow'
      FROM staking__tokens_undelegated`
    : `
      SELECT block_timestamp, CAST(tokens_dec AS DOUBLE) / 1e18 AS tokens, 'inflow' AS direction
      FROM staking__tokens_delegated
      UNION ALL
      SELECT block_timestamp, CAST(tokens_dec AS DOUBLE) / 1e18, 'outflow'
      FROM staking__tokens_undelegated`;

  return `
    WITH events AS (${events})
    SELECT
      strftime(to_timestamp(block_timestamp), '%Y-%m-%d') AS date,
      SUM(CASE WHEN direction = 'inflow' THEN tokens ELSE 0 END) AS inflows,
      SUM(CASE WHEN direction = 'outflow' THEN tokens ELSE 0 END) AS outflows
    FROM events
    WHERE block_timestamp >= ${startTimestamp} AND block_timestamp < ${endTimestamp}
    GROUP BY 1
    ORDER BY 1`;
}

function mergeDailyFlows(...sources: DailyFlowRow[][]): DelegationFlowPoint[] {
  const days = new Map<string, { inflows: number; outflows: number }>();
  for (const source of sources) {
    for (const row of source) {
      const total = days.get(row.date) ?? { inflows: 0, outflows: 0 };
      total.inflows += Number(row.inflows);
      total.outflows += Number(row.outflows);
      days.set(row.date, total);
    }
  }

  return Array.from(days, ([date, { inflows, outflows }]) => ({
    date,
    inflows,
    outflows,
    net: inflows - outflows,
  })).sort((a, b) => a.date.localeCompare(b.date));
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const baseDays = ALLOWED_DAYS.has(Number(params.get('days')))
    ? Number(params.get('days'))
    : 90;
  const compare = params.get('compare') === '1';
  const days = compare ? baseDays * 2 : baseDays;

  if (!hasNuthatch()) {
    return NextResponse.json({ error: 'Nuthatch is not configured' }, { status: 503 });
  }

  const cacheKey = `lodestar:delegation-flows:nuthatch:v4:${days}`;

  try {
    const data = await cached<DelegationFlowPoint[]>(cacheKey, 600, async () => {
      const startTimestamp = Math.floor((Date.now() - days * 86400_000) / 1000);
      const [historical, live] = await Promise.all([
        startTimestamp < LEGACY_HISTORY_END_EXCLUSIVE
          ? nuthatchSql<DailyFlowRow>(
              dailyFlowSql(startTimestamp, LEGACY_HISTORY_END_EXCLUSIVE, true),
              '/legacy-flows'
            )
          : Promise.resolve([]),
        nuthatchSql<DailyFlowRow>(
          dailyFlowSql(Math.max(startTimestamp, LEGACY_HISTORY_END_EXCLUSIVE), Number.MAX_SAFE_INTEGER, false)
        ),
      ]);
      return mergeDailyFlows(historical, live);
    });

    return NextResponse.json(
      { data, source: 'nuthatch' },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=1200',
        },
      },
    );
  } catch (error) {
    log.api.error({ err: error }, 'Nuthatch delegation flows error');
    return NextResponse.json({ error: 'Failed to load delegation flows from Nuthatch' }, { status: 503 });
  }
}
