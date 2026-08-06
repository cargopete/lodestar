import { NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { subgraphQuery, hasSubgraphAccess } from '@/lib/subgraph';
import { nuthatchEnabled, nuthatchSql } from '@/lib/nuthatch';
import { log } from '@/lib/logger';

// This handler takes no request argument, so Next would otherwise statically cache it at build time
// and never re-run it — freezing the data source (and defeating the `NUTHATCH_*` flags). The app-level
// `cached()` below is the real cache; the route itself must run each request.
export const dynamic = 'force-dynamic';

interface SubgraphRow {
  id: string;
  createdAt: number;
}

/** All subgraphs published since `cutoff`, from the network subgraph (paginated by id cursor). */
async function fetchSubgraphRows(cutoff: number): Promise<SubgraphRow[]> {
  const rows: SubgraphRow[] = [];
  let lastId = '';
  while (true) {
    const result = await subgraphQuery<{ subgraphs: SubgraphRow[] }>(`{
      subgraphs(
        first: 1000
        orderBy: id
        orderDirection: asc
        where: { createdAt_gte: ${cutoff} ${lastId ? `id_gt: "${lastId}"` : ''} }
      ) { id createdAt }
    }`);
    if (result.subgraphs.length === 0) break;
    rows.push(...result.subgraphs);
    lastId = result.subgraphs[result.subgraphs.length - 1].id;
    if (result.subgraphs.length < 1000) break;
  }
  return rows;
}

/**
 * The same set, from our own nuthatch nest (RFC-0011 pilot): each GNS `SubgraphPublished` event is a
 * new subgraph, so `block_timestamp` is its `createdAt`. This counts natively-published L2 subgraphs;
 * it can run ~1% below the network subgraph's entity count (which folds in a few L1-origin/legacy
 * subgraphs), but the weekly trend is identical — a documented divergence within tolerance (RFC-0011
 * §2). See graph-gns-nest on the Helsinki box.
 */
async function fetchNuthatchRows(cutoff: number): Promise<SubgraphRow[]> {
  const rows = await nuthatchSql<{ createdAt: number }>(
    `SELECT block_timestamp AS "createdAt" FROM "gns__subgraph_published" ` +
      `WHERE block_timestamp >= ${cutoff} ORDER BY block_timestamp`,
    '/gns' // the graph-gns-nest, reverse-proxied under /gns on the shared nuthatch host
  );
  return rows.map((r) => ({ id: '', createdAt: Number(r.createdAt) }));
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
  /** Which backend served this payload (RFC-0011 pilot). Absent on cached pre-migration payloads. */
  source?: 'nuthatch' | 'subgraph';
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
  // v3: payload gained a `source` field (nuthatch vs subgraph) — new key so we don't serve a v2
  // entry cached before the nuthatch migration (which has no source and the old subgraph totals).
  const cacheKey = `lodestar:developer-activity:v3:${windowMonths}m`;

  try {
    const data = await cached<DeveloperActivityResponse>(cacheKey, 3600, async () => {
      const cutoff = Math.floor(Date.now() / 1000) - windowMonths * 30 * 86400;

      // RFC-0011 pilot: when the flag is on, source the published-subgraph rows from our own nuthatch
      // nest instead of the network subgraph. Identical bucketing runs below either way, so only the
      // data origin changes. Falls back to the subgraph on any error.
      let source: 'nuthatch' | 'subgraph' = 'subgraph';
      let rows: SubgraphRow[];
      if (nuthatchEnabled('NUTHATCH_DEVELOPER_ACTIVITY')) {
        try {
          rows = await fetchNuthatchRows(cutoff);
          source = 'nuthatch';
        } catch (err) {
          log.api.error({ err }, 'nuthatch developer-activity failed, falling back to subgraph');
          rows = await fetchSubgraphRows(cutoff);
        }
      } else {
        rows = await fetchSubgraphRows(cutoff);
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

      return { weeks, windowMonths, totalInWindow, lastWeekCount, weekOverWeekPct, source };
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
