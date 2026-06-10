/**
 * Indexer revenue aggregation.
 *
 * Two revenue streams, both already in our Postgres:
 *   - Query-fee revenue (RAV redemptions) from `rav_redemptions` (see ingest/rav.ts)
 *   - Indexing rewards from `allocations.indexing_rewards_grt`, realised at allocation
 *     close, attributed to the day the allocation closed.
 *
 * All amounts are GRT (the DB stores GRT, not wei).
 */
import type { DbClient } from './db';

export type RevenueWindow = 7 | 30 | 90 | 365;
export const REVENUE_WINDOWS: RevenueWindow[] = [7, 30, 90, 365];

export interface RevenueDay {
  date: string; // YYYY-MM-DD (UTC)
  rav_grt: number;
  indexing_rewards_grt: number;
  total_grt: number;
}

export interface DeploymentRevenue {
  deployment_id: string | null;
  rav_grt: number;
  indexing_rewards_grt: number;
  total_grt: number;
}

export interface IndexerRevenue {
  indexer: string;
  windowDays: number;
  rav_grt: number;
  indexing_rewards_grt: number;
  total_grt: number;
  daily: RevenueDay[];
  byDeployment?: DeploymentRevenue[];
}

interface DayRow {
  date: string;
  grt: number;
}
interface DeploymentRow {
  deployment_id: string | null;
  grt: number;
}

/**
 * Aggregate an indexer's revenue over a rolling window.
 */
export async function getIndexerRevenue(
  sql: DbClient,
  indexerAddress: string,
  opts: { windowDays: number; byDeployment?: boolean },
): Promise<IndexerRevenue> {
  const indexer = indexerAddress.toLowerCase();
  const { windowDays, byDeployment } = opts;

  const [ravDaily, rewardsDaily] = await Promise.all([
    sql<DayRow[]>`
      SELECT to_char(date_trunc('day', collected_at), 'YYYY-MM-DD') AS date,
             COALESCE(sum(tokens_grt), 0)::float8 AS grt
      FROM rav_redemptions
      WHERE indexer_address = ${indexer}
        AND collected_at >= now() - make_interval(days => ${windowDays})
      GROUP BY 1
      ORDER BY 1
    `,
    sql<DayRow[]>`
      SELECT to_char(date_trunc('day', closed_at), 'YYYY-MM-DD') AS date,
             COALESCE(sum(indexing_rewards_grt), 0)::float8 AS grt
      FROM allocations
      WHERE indexer_address = ${indexer}
        AND closed_at IS NOT NULL
        AND closed_at >= now() - make_interval(days => ${windowDays})
      GROUP BY 1
      ORDER BY 1
    `,
  ]);

  const daily = mergeDaily(ravDaily, rewardsDaily);
  const rav_grt = ravDaily.reduce((s, r) => s + r.grt, 0);
  const indexing_rewards_grt = rewardsDaily.reduce((s, r) => s + r.grt, 0);

  const result: IndexerRevenue = {
    indexer,
    windowDays,
    rav_grt,
    indexing_rewards_grt,
    total_grt: rav_grt + indexing_rewards_grt,
    daily,
  };

  if (byDeployment) {
    const [ravByDep, rewardsByDep] = await Promise.all([
      sql<DeploymentRow[]>`
        SELECT deployment_id, COALESCE(sum(tokens_grt), 0)::float8 AS grt
        FROM rav_redemptions
        WHERE indexer_address = ${indexer}
          AND collected_at >= now() - make_interval(days => ${windowDays})
        GROUP BY deployment_id
      `,
      sql<DeploymentRow[]>`
        SELECT deployment_id, COALESCE(sum(indexing_rewards_grt), 0)::float8 AS grt
        FROM allocations
        WHERE indexer_address = ${indexer}
          AND closed_at IS NOT NULL
          AND closed_at >= now() - make_interval(days => ${windowDays})
        GROUP BY deployment_id
      `,
    ]);
    result.byDeployment = mergeByDeployment(ravByDep, rewardsByDep);
  }

  return result;
}

function mergeDaily(rav: DayRow[], rewards: DayRow[]): RevenueDay[] {
  const map = new Map<string, RevenueDay>();
  for (const r of rav) {
    map.set(r.date, { date: r.date, rav_grt: r.grt, indexing_rewards_grt: 0, total_grt: r.grt });
  }
  for (const r of rewards) {
    const existing = map.get(r.date);
    if (existing) {
      existing.indexing_rewards_grt += r.grt;
      existing.total_grt += r.grt;
    } else {
      map.set(r.date, { date: r.date, rav_grt: 0, indexing_rewards_grt: r.grt, total_grt: r.grt });
    }
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function mergeByDeployment(rav: DeploymentRow[], rewards: DeploymentRow[]): DeploymentRevenue[] {
  const map = new Map<string, DeploymentRevenue>();
  const key = (id: string | null) => id ?? '__unattributed__';
  for (const r of rav) {
    map.set(key(r.deployment_id), {
      deployment_id: r.deployment_id,
      rav_grt: r.grt,
      indexing_rewards_grt: 0,
      total_grt: r.grt,
    });
  }
  for (const r of rewards) {
    const k = key(r.deployment_id);
    const existing = map.get(k);
    if (existing) {
      existing.indexing_rewards_grt += r.grt;
      existing.total_grt += r.grt;
    } else {
      map.set(k, {
        deployment_id: r.deployment_id,
        rav_grt: 0,
        indexing_rewards_grt: r.grt,
        total_grt: r.grt,
      });
    }
  }
  return [...map.values()].sort((a, b) => b.total_grt - a.total_grt);
}
