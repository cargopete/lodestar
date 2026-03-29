import type { DbClient } from '../db';
import { getIngestionState, updateIngestionState } from '../db';
import { subgraphQuery } from '../subgraph';
import { weiToGRT } from '../utils';
import { log } from '../logger';

interface SubgraphAllocation {
  id: string;
  indexer: { id: string };
  subgraphDeployment: { id: string; signalledTokens: string };
  allocatedTokens: string;
  createdAtEpoch: number;
  closedAtEpoch: number | null;
  createdAt: number;
  closedAt: number | null;
  poi: string | null;
  indexingRewards: string;
  queryFeesCollected: string;
  status: string;
}

/**
 * Ingest allocations from the network subgraph.
 * Delta mode: fetch allocations closed since last epoch + all currently open.
 * Backfill mode: fetch ALL allocations using id_gt pagination.
 */
export async function ingestAllocations(
  sql: DbClient,
  opts: { backfill?: boolean } = {}
): Promise<{ ingested: number }> {
  if (opts.backfill) {
    return backfillAllocations(sql);
  }
  return deltaIngestAllocations(sql);
}

async function deltaIngestAllocations(sql: DbClient): Promise<{ ingested: number }> {
  const state = await getIngestionState(sql, 'allocations');
  const lastEpoch = state.last_epoch ?? 0;

  let totalIngested = 0;

  // 1. Fetch all currently OPEN allocations (to keep status up to date)
  let lastId = '';
  while (true) {
    const result = await subgraphQuery<{ allocations: SubgraphAllocation[] }>(`{
      allocations(
        first: 1000
        orderBy: id
        orderDirection: asc
        where: { status: Active${lastId ? `, id_gt: "${lastId}"` : ''} }
      ) {
        ${ALLOCATION_FIELDS}
      }
    }`);

    if (result.allocations.length === 0) break;
    await upsertAllocations(sql, result.allocations);
    totalIngested += result.allocations.length;
    lastId = result.allocations[result.allocations.length - 1].id;
    if (result.allocations.length < 1000) break;
  }

  // 2. Fetch allocations closed since our last check
  if (lastEpoch > 0) {
    lastId = '';
    while (true) {
      const result = await subgraphQuery<{ allocations: SubgraphAllocation[] }>(`{
        allocations(
          first: 1000
          orderBy: id
          orderDirection: asc
          where: { status: Closed, closedAtEpoch_gte: ${lastEpoch}${lastId ? `, id_gt: "${lastId}"` : ''} }
        ) {
          ${ALLOCATION_FIELDS}
        }
      }`);

      if (result.allocations.length === 0) break;
      await upsertAllocations(sql, result.allocations);
      totalIngested += result.allocations.length;
      lastId = result.allocations[result.allocations.length - 1].id;
      if (result.allocations.length < 1000) break;
    }
  }

  // Update cursor to current epoch
  const networkResult = await subgraphQuery<{
    graphNetwork: { currentEpoch: number };
  }>(`{ graphNetwork(id: "1") { currentEpoch } }`);

  await updateIngestionState(sql, 'allocations', {
    last_epoch: networkResult.graphNetwork.currentEpoch,
  });

  return { ingested: totalIngested };
}

async function backfillAllocations(sql: DbClient): Promise<{ ingested: number }> {
  let totalIngested = 0;
  let lastId = '';

  while (true) {
    const result = await subgraphQuery<{ allocations: SubgraphAllocation[] }>(`{
      allocations(
        first: 1000
        orderBy: id
        orderDirection: asc
        ${lastId ? `where: { id_gt: "${lastId}" }` : ''}
      ) {
        ${ALLOCATION_FIELDS}
      }
    }`);

    if (result.allocations.length === 0) break;
    await upsertAllocations(sql, result.allocations);
    totalIngested += result.allocations.length;
    lastId = result.allocations[result.allocations.length - 1].id;

    if (totalIngested % 5000 === 0) {
      log.ingest.info({ step: 'allocations', totalIngested }, 'Backfill progress');
    }

    if (result.allocations.length < 1000) break;
  }

  // Set cursor to current epoch
  const networkResult = await subgraphQuery<{
    graphNetwork: { currentEpoch: number };
  }>(`{ graphNetwork(id: "1") { currentEpoch } }`);

  await updateIngestionState(sql, 'allocations', {
    last_epoch: networkResult.graphNetwork.currentEpoch,
  });

  return { ingested: totalIngested };
}

async function upsertAllocations(sql: DbClient, allocations: SubgraphAllocation[]) {
  const rows = allocations.map((a) => ({
    id: a.id,
    indexer_address: a.indexer.id.toLowerCase(),
    deployment_id: a.subgraphDeployment.id,
    allocated_tokens_grt: weiToGRT(a.allocatedTokens),
    created_epoch: a.createdAtEpoch,
    closed_epoch: a.closedAtEpoch,
    created_at: a.createdAt ? new Date(a.createdAt * 1000).toISOString() : null,
    closed_at: a.closedAt ? new Date(a.closedAt * 1000).toISOString() : null,
    signal_at_open: weiToGRT(a.subgraphDeployment.signalledTokens),
    poi: a.poi,
    indexing_rewards_grt: weiToGRT(a.indexingRewards),
    query_fees_grt: weiToGRT(a.queryFeesCollected),
    status: a.status === 'Active' ? 'open' : 'closed',
  }));

  // Batch in chunks to avoid oversized queries
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK);
    await sql`
      INSERT INTO allocations ${sql(batch)}
      ON CONFLICT (id) DO UPDATE SET
        allocated_tokens_grt = EXCLUDED.allocated_tokens_grt,
        closed_epoch = EXCLUDED.closed_epoch,
        closed_at = EXCLUDED.closed_at,
        poi = EXCLUDED.poi,
        indexing_rewards_grt = EXCLUDED.indexing_rewards_grt,
        query_fees_grt = EXCLUDED.query_fees_grt,
        status = EXCLUDED.status
    `;
  }
}

const ALLOCATION_FIELDS = `
  id
  indexer { id }
  subgraphDeployment { id signalledTokens }
  allocatedTokens
  createdAtEpoch
  closedAtEpoch
  createdAt
  closedAt
  poi
  indexingRewards
  queryFeesCollected
  status
`;
