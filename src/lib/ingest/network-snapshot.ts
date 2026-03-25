import type { DbClient } from '../db';
import { subgraphQuery } from '../subgraph';
import { weiToGRT } from '../utils';

interface SubgraphNetworkStats {
  graphNetwork: {
    totalTokensStaked: string;
    totalDelegatedTokens: string;
    totalTokensSignalled: string;
    totalTokensAllocated: string;
    indexerCount: number;
    activeIndexerCount: number;
    delegatorCount: number;
    activeDelegatorCount: number;
    curatorCount: number;
    activeCuratorCount: number;
    subgraphCount: number;
    activeSubgraphCount: number;
    currentEpoch: number;
  };
}

/**
 * Capture a point-in-time network snapshot.
 * Optionally enriched with GRT price and TVL.
 */
export async function writeNetworkSnapshot(
  db: DbClient,
  opts: { grtPriceUsd?: number; networkTvlUsd?: number } = {}
): Promise<void> {
  const result = await subgraphQuery<SubgraphNetworkStats>(`{
    graphNetwork(id: "1") {
      totalTokensStaked
      totalDelegatedTokens
      totalTokensSignalled
      totalTokensAllocated
      indexerCount
      activeIndexerCount
      delegatorCount
      activeDelegatorCount
      curatorCount
      activeCuratorCount
      subgraphCount
      activeSubgraphCount
      currentEpoch
    }
  }`);

  const n = result.graphNetwork;

  const { error } = await db.from('network_snapshots').insert({
    total_staked: weiToGRT(n.totalTokensStaked),
    total_delegated: weiToGRT(n.totalDelegatedTokens),
    total_signalled: weiToGRT(n.totalTokensSignalled),
    total_allocated: weiToGRT(n.totalTokensAllocated),
    indexer_count: n.indexerCount,
    active_indexer_count: n.activeIndexerCount,
    delegator_count: n.delegatorCount,
    active_delegator_count: n.activeDelegatorCount,
    curator_count: n.curatorCount,
    active_curator_count: n.activeCuratorCount,
    subgraph_count: n.subgraphCount,
    active_subgraph_count: n.activeSubgraphCount,
    current_epoch: n.currentEpoch,
    grt_price_usd: opts.grtPriceUsd ?? null,
    network_tvl_usd: opts.networkTvlUsd ?? null,
  });

  if (error) throw new Error(`Network snapshot insert failed: ${error.message}`);
}
