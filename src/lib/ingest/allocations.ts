import type { DbClient } from '../db';
import { getIngestionState, updateIngestionState } from '../db';
import { subgraphQuery } from '../subgraph';
import { weiToGRT } from '../utils';

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
  db: DbClient,
  opts: { backfill?: boolean } = {}
): Promise<{ ingested: number }> {
  if (opts.backfill) {
    return backfillAllocations(db);
  }
  return deltaIngestAllocations(db);
}

async function deltaIngestAllocations(db: DbClient): Promise<{ ingested: number }> {
  const state = await getIngestionState(db, 'allocations');
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
    await upsertAllocations(db, result.allocations);
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
      await upsertAllocations(db, result.allocations);
      totalIngested += result.allocations.length;
      lastId = result.allocations[result.allocations.length - 1].id;
      if (result.allocations.length < 1000) break;
    }
  }

  // Update cursor to current epoch
  const networkResult = await subgraphQuery<{
    graphNetwork: { currentEpoch: number };
  }>(`{ graphNetwork(id: "1") { currentEpoch } }`);

  await updateIngestionState(db, 'allocations', {
    last_epoch: networkResult.graphNetwork.currentEpoch,
  });

  return { ingested: totalIngested };
}

async function backfillAllocations(db: DbClient): Promise<{ ingested: number }> {
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
    await upsertAllocations(db, result.allocations);
    totalIngested += result.allocations.length;
    lastId = result.allocations[result.allocations.length - 1].id;

    if (totalIngested % 5000 === 0) {
      console.log(`  Allocations backfill: ${totalIngested} so far...`);
    }

    if (result.allocations.length < 1000) break;
  }

  // Set cursor to current epoch
  const networkResult = await subgraphQuery<{
    graphNetwork: { currentEpoch: number };
  }>(`{ graphNetwork(id: "1") { currentEpoch } }`);

  await updateIngestionState(db, 'allocations', {
    last_epoch: networkResult.graphNetwork.currentEpoch,
  });

  return { ingested: totalIngested };
}

async function upsertAllocations(db: DbClient, allocations: SubgraphAllocation[]) {
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

  const { error } = await db.from('allocations').upsert(rows, { onConflict: 'id' });
  if (error) throw new Error(`Allocation upsert failed: ${error.message}`);
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
