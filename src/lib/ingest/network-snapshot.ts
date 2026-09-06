import type { DbClient } from '../db';
import { networkFromNest } from '@/app/api/network-stats/route';
import { weiToGRT } from '../utils';

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
  // Off `lodestar_network`, through the shaping `api/network-stats` already does, so the snapshot and
  // the page cannot disagree (nuthatch#1160). The gateway path this once fell back to left with the key.
  const { graphNetwork: n } = await networkFromNest();


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
      ${weiToGRT(n.totalSupply ?? '0')},
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
