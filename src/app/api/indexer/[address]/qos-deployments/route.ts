import { NextRequest, NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { db, hasDbAccess } from '@/lib/db';
import { log } from '@/lib/logger';
import { aggregateIndexerMetrics, type QosDailyRow } from '@/lib/qos-aggregate';
import { computeQualityDetail } from '@/lib/qos-score';

/**
 * GET /api/indexer/[address]/qos-deployments
 *
 * The working behind an indexer's QoS score: every deployment in the window, what it was
 * measured at, and how much of the composite it accounts for.
 *
 * Exists because on 2026-08-15 an operator saw an F on a panel of four bars, could not tell
 * which deployment caused it, and had to ask. The answer was a single subgraph carrying 78% of
 * his traffic with a deterministic mapping fault — visible in one query against `qos_daily`,
 * and in nothing we published.
 *
 * Cohort context is loaded alongside: the same deployments as served by every OTHER indexer,
 * because "you are failing here" and "this subgraph is failing for everyone" look identical
 * from one indexer's rows and mean opposite things.
 */

const GRAPH_EPOCH_DAYS = 18613;
const WINDOW_DAYS = 30;

export async function GET(
  _request: NextRequest,
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

  try {
    const data = await cached(`lodestar:indexer:qos-deployments:${addr}`, 1800, async () => {
      const todayDayNumber = Math.floor(Date.now() / 86400000) - GRAPH_EPOCH_DAYS;
      const sinceDay = todayDayNumber - WINDOW_DAYS;

      // Every indexer's rows for the deployments THIS indexer served — the cohort figures are
      // meaningless without the peers, and scoping by deployment keeps it off a full scan.
      const rows = await db!<QosDailyRow[]>`
        SELECT indexer_address, deployment_id, day_number,
               query_count::float8   AS query_count,
               success_count::float8 AS success_count,
               avg_latency_ms::float8 AS avg_latency_ms,
               blocks_behind::float8  AS blocks_behind,
               chain_id
        FROM qos_daily
        WHERE day_number >= ${sinceDay}
          AND deployment_id IN (
            SELECT DISTINCT deployment_id FROM qos_daily
            WHERE indexer_address = ${addr} AND day_number >= ${sinceDay}
          )
      `;
      if (rows.length === 0) return { window_days: WINDOW_DAYS, deployments: [], total: null };

      const metrics = aggregateIndexerMetrics(rows, [], { todayDayNumber }).get(addr) ?? [];
      const { result, deployments } = computeQualityDetail(metrics);

      return {
        window_days: WINDOW_DAYS,
        total: {
          q_score: result.qScore,
          reliability: result.reliability,
          lat_util: result.latUtil,
          fresh_util: result.freshUtil,
          coverage: result.coverage,
          credible_deployments: result.credibleDeployments,
          unmeasured_deployments: result.unmeasuredDeployments,
        },
        // Heaviest drag first: weight × how far short of a perfect deployment it fell. That
        // ordering answers the only question an operator has, which is what to fix first.
        deployments: [...deployments]
          .sort((x, y) => y.weight * (1 - (y.q ?? 1)) - x.weight * (1 - (x.q ?? 1)))
          .map((d) => ({
            deployment_id: d.deployment,
            queries: d.n,
            weight: d.weight,
            reliability: d.reliability,
            reliability_used: d.reliabilityUsed,
            cohort_best_reliability: d.cohortBestReliability,
            lat_util: d.latUtil,
            fresh_util: d.freshUtil,
            time_behind_sec: d.timeBehindSec,
            time_behind_own_sec: d.timeBehindOwnSec,
            served_share: d.servedShare,
            q: d.q,
            measured: d.measured,
            /** How much of the composite this deployment is holding down (0..1). */
            drag: d.weight * (1 - (d.q ?? 1)),
          })),
      };
    });

    return NextResponse.json({ data }, {
      headers: { 'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=3600' },
    });
  } catch (error) {
    log.api.error({ err: error }, 'Indexer QoS deployments error');
    return NextResponse.json({ error: 'Failed to fetch QoS deployment breakdown' }, { status: 500 });
  }
}
