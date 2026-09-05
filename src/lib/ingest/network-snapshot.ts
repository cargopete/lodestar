import type { DbClient } from '../db';
import { subgraphQuery } from '../subgraph';
import { hasNuthatch, nuthatchEnabled } from '../nuthatch';
import { networkFromNest } from '@/app/api/network-stats/route';
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
  // Behind NUTHATCH_NETWORK (nuthatch#1160): the same figures off `lodestar_network`, through the
  // shaping `api/network-stats` already does, so the snapshot and the page cannot disagree.
  const result = nuthatchEnabled('NUTHATCH_NETWORK') && hasNuthatch()
    ? await (async (): Promise<SubgraphNetworkStats> => {
        const { graphNetwork: g } = await networkFromNest();
        return { graphNetwork: {
          totalTokensStaked: g.totalTokensStaked, totalDelegatedTokens: g.totalDelegatedTokens, totalTokensSignalled: g.totalTokensSignalled,
          totalTokensAllocated: g.totalTokensAllocated, totalSupply: g.totalSupply ?? '0', indexerCount: g.indexerCount, stakedIndexersCount: g.stakedIndexersCount,
          delegatorCount: g.delegatorCount, activeDelegatorCount: g.activeDelegatorCount, curatorCount: g.curatorCount, activeCuratorCount: g.activeCuratorCount,
          subgraphCount: g.subgraphCount, activeSubgraphCount: g.activeSubgraphCount, currentEpoch: g.currentEpoch,
        } };
      })()
    : await subgraphQuery<SubgraphNetworkStats>(`{
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
