import { NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { subgraphQuery, hasSubgraphAccess } from '@/lib/subgraph';
import { log } from '@/lib/logger';

interface SubgraphRow {
  id: string;
  createdAt: number;
}

interface WeekBucket {
  /** Monday of the ISO week, YYYY-MM-DD */
  weekStart: string;
  /** Subgraphs published that week */
  count: number;
  /** Running total of subgraphs published from the window start through this week */
  cumulative: number;
  /** True for the current, still-in-progress week (incomplete — don't read its count as a trend) */
  partial: boolean;
}

export interface DeveloperActivityResponse {
  /** Weekly published-subgraph counts, oldest → newest */
  weeks: WeekBucket[];
  /** Months of history covered */
  windowMonths: number;
  /** Total subgraphs published within the window */
  totalInWindow: number;
  /** Published in the most recent COMPLETE week (the partial current week is excluded) */
  lastWeekCount: number;
  /** Week-over-week change (%) between the last two complete weeks, null when the prior week is empty */
  weekOverWeekPct: number | null;
}

/** Monday (UTC) of the ISO week containing the given unix-seconds timestamp. */
function weekStartUTC(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const day = d.getUTCDay(); // 0 = Sun … 6 = Sat
  const diffToMonday = (day + 6) % 7; // Sun → 6, Mon → 0
  d.setUTCDate(d.getUTCDate() - diffToMonday);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

/**
 * Developer-activity timeseries: subgraphs published per week over the last
 * `windowMonths`, derived purely from the network subgraph's `Subgraph.createdAt`
 * (no ingest / DB). A subgraph entity is created on publish, so its createdAt is a
 * faithful proxy for "a developer shipped something new".
 */
export async function GET() {
  if (!hasSubgraphAccess()) {
    return NextResponse.json({ error: 'No API key configured' }, { status: 503 });
  }

  const windowMonths = 12;
  // v2: payload gained the `partial` flag + complete-week-only headline figures.
  const cacheKey = `lodestar:developer-activity:v2:${windowMonths}m`;

  try {
    const data = await cached<DeveloperActivityResponse>(cacheKey, 3600, async () => {
      const cutoff = Math.floor(Date.now() / 1000) - windowMonths * 30 * 86400;

      // Paginate by id (stable cursor) over all subgraphs published since the cutoff.
      const rows: SubgraphRow[] = [];
      let lastId = '';
      while (true) {
        const result = await subgraphQuery<{ subgraphs: SubgraphRow[] }>(`{
          subgraphs(
            first: 1000
            orderBy: id
            orderDirection: asc
            where: {
              createdAt_gte: ${cutoff}
              ${lastId ? `id_gt: "${lastId}"` : ''}
            }
          ) {
            id
            createdAt
          }
        }`);

        if (result.subgraphs.length === 0) break;
        rows.push(...result.subgraphs);
        lastId = result.subgraphs[result.subgraphs.length - 1].id;
        if (result.subgraphs.length < 1000) break;
      }

      // Tally into weekly buckets.
      const counts = new Map<string, number>();
      for (const row of rows) {
        const wk = weekStartUTC(row.createdAt);
        counts.set(wk, (counts.get(wk) ?? 0) + 1);
      }

      // Emit a contiguous run of weeks (filling empty ones with 0) so the chart
      // doesn't lie about gaps.
      const currentWeekStart = weekStartUTC(Math.floor(Date.now() / 1000));
      const weeks: WeekBucket[] = [];
      const sortedKeys = [...counts.keys()].sort();
      if (sortedKeys.length > 0) {
        const first = new Date(`${sortedKeys[0]}T00:00:00Z`);
        const last = new Date(`${sortedKeys[sortedKeys.length - 1]}T00:00:00Z`);
        let cumulative = 0;
        for (let d = first; d <= last; d.setUTCDate(d.getUTCDate() + 7)) {
          const key = d.toISOString().slice(0, 10);
          const count = counts.get(key) ?? 0;
          cumulative += count;
          weeks.push({ weekStart: key, count, cumulative, partial: key === currentWeekStart });
        }
      }

      const totalInWindow = rows.length;
      // Headline + WoW use only COMPLETE weeks — the current week is partial and would
      // otherwise read as a crash mid-week.
      const completeWeeks = weeks.filter((w) => !w.partial);
      const lastWeekCount = completeWeeks.length > 0 ? completeWeeks[completeWeeks.length - 1].count : 0;
      const prevWeekCount = completeWeeks.length > 1 ? completeWeeks[completeWeeks.length - 2].count : 0;
      const weekOverWeekPct =
        prevWeekCount > 0 ? ((lastWeekCount - prevWeekCount) / prevWeekCount) * 100 : null;

      return { weeks, windowMonths, totalInWindow, lastWeekCount, weekOverWeekPct };
    });

    return NextResponse.json(
      { data },
      { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200' } }
    );
  } catch (error) {
    log.api.error({ err: error }, 'Developer activity error');
    return NextResponse.json({ error: 'Failed to load developer activity' }, { status: 500 });
  }
}
