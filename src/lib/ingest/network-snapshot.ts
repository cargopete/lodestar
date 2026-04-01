import type { DbClient } from '../db';
import { subgraphQuery } from '../subgraph';
import { weiToGRT } from '../utils';

interface SubgraphNetworkStats {
  graphNetwork: {
    totalTokensStaked: string;
    totalDelegatedTokens: string;
    totalTokensSignalled: string;
    totalTokensAllocated: string;
    totalSupply: string;
    indexerCount: number;
    stakedIndexersCount: number;
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
  sql: DbClient,
  opts: { grtPriceUsd?: number; networkTvlUsd?: number } = {}
): Promise<void> {
  const result = await subgraphQuery<SubgraphNetworkStats>(`{
    graphNetwork(id: "1") {
      totalTokensStaked
      totalDelegatedTokens
      totalTokensSignalled
      totalTokensAllocated
      totalSupply
      indexerCount
      stakedIndexersCount
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

  await sql`
    INSERT INTO network_snapshots (
      total_staked, total_delegated, total_signalled, total_allocated, total_supply_grt,
      indexer_count, active_indexer_count,
      delegator_count, active_delegator_count,
      curator_count, active_curator_count,
      subgraph_count, active_subgraph_count,
      current_epoch, grt_price_usd, network_tvl_usd
    ) VALUES (
      ${weiToGRT(n.totalTokensStaked)},
      ${weiToGRT(n.totalDelegatedTokens)},
      ${weiToGRT(n.totalTokensSignalled)},
      ${weiToGRT(n.totalTokensAllocated)},
      ${weiToGRT(n.totalSupply)},
      ${n.indexerCount},
      ${n.stakedIndexersCount},
      ${n.delegatorCount},
      ${n.activeDelegatorCount},
      ${n.curatorCount},
      ${n.activeCuratorCount},
      ${n.subgraphCount},
      ${n.activeSubgraphCount},
      ${n.currentEpoch},
      ${opts.grtPriceUsd ?? null},
      ${opts.networkTvlUsd ?? null}
    )
  `;
}
