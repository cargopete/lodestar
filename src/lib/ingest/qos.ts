import type { DbClient } from '../db';
import { getIngestionState, updateIngestionState } from '../db';
import { qosOracleQuery } from '../subgraph';
import { log } from '../logger';

/**
 * Ingest QoS Oracle daily datapoints into qos_daily + deployment_daily.
 *
 * Source: E&N/GraphOps QoS Oracle subgraph (V1).
 *   - allocationDailyDataPoints → per (indexer, deployment, day, gateway): the scoring
 *     primitive. V1 has avg+blocks_behind+proportion_200 (no p90/p99, no stdev at daily grain).
 *   - queryDailyDataPoints → per (deployment, day, gateway): the served-share denominator.
 *
 * dayNumber baseline: days since The Graph mainnet launch (Unix day 18613). Same convention
 * as src/app/api/indexer-qos/[address]/route.ts. subgraphDeployment.id IS the IPFS hash (Qm…)
 * on both entities, so they key consistently.
 *
 * Cursor: ingestion_state['qos'].last_block holds the last fully-ingested dayNumber. Delta runs
 * re-scan a 1-day overlap; upserts make the overlap harmless.
 */

const GRAPH_EPOCH_DAYS = 18613;
const PAGE = 1000;
const DEFAULT_BACKFILL_DAYS = 120;

interface AllocDaily {
  id: string;
  dayNumber: string;
  indexer_wallet: string;
  subgraph_deployment_ipfs_hash: string;
  query_count: string;
  proportion_indexer_200_responses: string;
  avg_indexer_latency_ms: string;
  avg_indexer_blocks_behind: string;
  total_query_fees: string;
  gateway_id: string;
  chain_id: string;
}

interface QueryDaily {
  id: string;
  dayNumber: string;
  subgraphDeployment: { id: string };
  query_count: string;
  gateway_query_success_rate: string;
  gateway_id: string;
  chain_id: string;
}

function dayToDate(dayNumber: number): string {
  return new Date((dayNumber + GRAPH_EPOCH_DAYS) * 86400000).toISOString().slice(0, 10);
}

function currentDayNumber(): number {
  return Math.floor(Date.now() / 86400000) - GRAPH_EPOCH_DAYS;
}

export async function ingestQos(
  sql: DbClient,
  opts: { backfill?: boolean; days?: number } = {},
): Promise<{ ingested: number }> {
  const state = await getIngestionState(sql, 'qos');
  const today = currentDayNumber();
  const sinceDay = opts.backfill
    ? today - (opts.days ?? DEFAULT_BACKFILL_DAYS)
    : Math.max(0, (state.last_block ?? today - 2) - 1); // 1-day overlap

  const allocIngested = await ingestAllocDaily(sql, sinceDay);
  const depIngested = await ingestQueryDaily(sql, sinceDay);

  await updateIngestionState(sql, 'qos', { last_block: today });

  const ingested = allocIngested + depIngested;
  log.ingest.info(
    { step: 'qos', sinceDay, today, allocRows: allocIngested, deploymentRows: depIngested },
    'QoS ingestion complete',
  );
  return { ingested };
}

async function ingestAllocDaily(sql: DbClient, sinceDay: number): Promise<number> {
  let lastId = '';
  let total = 0;

  while (true) {
    const result = await qosOracleQuery<{ allocationDailyDataPoints: AllocDaily[] }>(`{
      allocationDailyDataPoints(
        first: ${PAGE}
        orderBy: id
        orderDirection: asc
        where: { dayNumber_gte: ${sinceDay}${lastId ? `, id_gt: "${lastId}"` : ''} }
      ) {
        id
        dayNumber
        indexer_wallet
        subgraph_deployment_ipfs_hash
        query_count
        proportion_indexer_200_responses
        avg_indexer_latency_ms
        avg_indexer_blocks_behind
        total_query_fees
        gateway_id
        chain_id
      }
    }`);

    const batch = result.allocationDailyDataPoints ?? [];
    if (batch.length === 0) break;

    const rows = batch.map((p) => {
      const day = Number(p.dayNumber);
      const n = Number(p.query_count);
      const prop = Number(p.proportion_indexer_200_responses);
      return {
        indexer_address: p.indexer_wallet.toLowerCase(),
        deployment_id: p.subgraph_deployment_ipfs_hash,
        day_number: day,
        day: dayToDate(day),
        query_count: Math.round(n),
        success_count: prop * n,
        avg_latency_ms: Number(p.avg_indexer_latency_ms),
        stdev_latency_ms: null, // not exposed at daily grain in V1
        blocks_behind: Number(p.avg_indexer_blocks_behind),
        total_query_fees_grt: Number(p.total_query_fees),
        gateway_id: p.gateway_id ?? '',
        chain_id: p.chain_id ?? null,
      };
    });

    await upsertChunked(sql, rows, async (slice) => {
      await sql`
        INSERT INTO qos_daily ${sql(slice)}
        ON CONFLICT (indexer_address, deployment_id, day_number, gateway_id) DO UPDATE SET
          query_count          = EXCLUDED.query_count,
          success_count        = EXCLUDED.success_count,
          avg_latency_ms       = EXCLUDED.avg_latency_ms,
          blocks_behind        = EXCLUDED.blocks_behind,
          total_query_fees_grt = EXCLUDED.total_query_fees_grt,
          chain_id             = EXCLUDED.chain_id
      `;
    });

    total += batch.length;
    lastId = batch[batch.length - 1].id;
    if (batch.length < PAGE) break;
  }

  return total;
}

async function ingestQueryDaily(sql: DbClient, sinceDay: number): Promise<number> {
  let lastId = '';
  let total = 0;

  while (true) {
    const result = await qosOracleQuery<{ queryDailyDataPoints: QueryDaily[] }>(`{
      queryDailyDataPoints(
        first: ${PAGE}
        orderBy: id
        orderDirection: asc
        where: { dayNumber_gte: ${sinceDay}${lastId ? `, id_gt: "${lastId}"` : ''} }
      ) {
        id
        dayNumber
        subgraphDeployment { id }
        query_count
        gateway_query_success_rate
        gateway_id
        chain_id
      }
    }`);

    const batch = result.queryDailyDataPoints ?? [];
    if (batch.length === 0) break;

    // Some QueryDailyDataPoints have a null subgraphDeployment relation — skip those
    // (no deployment to attribute the served-share denominator to).
    const rows = batch
      .filter((p) => p.subgraphDeployment?.id)
      .map((p) => {
        const day = Number(p.dayNumber);
        return {
          deployment_id: p.subgraphDeployment.id,
          day_number: day,
          day: dayToDate(day),
          total_query_count: Math.round(Number(p.query_count)),
          gateway_success_rate: Number(p.gateway_query_success_rate),
          gateway_id: p.gateway_id ?? '',
          chain_id: p.chain_id ?? null,
        };
      });

    await upsertChunked(sql, rows, async (slice) => {
      await sql`
        INSERT INTO deployment_daily ${sql(slice)}
        ON CONFLICT (deployment_id, day_number, gateway_id) DO UPDATE SET
          total_query_count    = EXCLUDED.total_query_count,
          gateway_success_rate = EXCLUDED.gateway_success_rate,
          chain_id             = EXCLUDED.chain_id
      `;
    });

    total += batch.length;
    lastId = batch[batch.length - 1].id;
    if (batch.length < PAGE) break;
  }

  return total;
}

async function upsertChunked<T>(
  _sql: DbClient,
  rows: T[],
  run: (slice: T[]) => Promise<void>,
): Promise<void> {
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await run(rows.slice(i, i + CHUNK));
  }
}
