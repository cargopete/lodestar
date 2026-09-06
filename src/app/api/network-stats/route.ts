import { NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import type { NetworkStatsResponse } from '@/lib/queries';
import { fetchGrtSupplyBreakdown } from '@/lib/grt-supply';
import { log } from '@/lib/logger';
import { hasNuthatch, nuthatchSqlReady } from '@/lib/nuthatch';
import { networkSql, networkParamsSql, type NestNetworkRow, type NestNetworkParamsRow } from '@/lib/nest-queries';
import type { GraphNetwork } from '@/lib/queries';

const NETWORK_BASE_PATH = process.env.NUTHATCH_NETWORK_BASE_PATH || '/alloc';

/**
 * The `graphNetwork` singleton from the two nest rows, in the subgraph's shape (nuthatch#1160).
 * Three legacy parameters are not on the Horizon proxy and are stated rather than guessed:
 * `delegationTaxPercentage` is 0 because Horizon has no delegation tax; `maxAllocationEpochs` and
 * `thawingPeriod` are null because neither exists as a network-wide parameter any more (thawing is
 * per provision, and `max_thawing_period_seconds` is the protocol ceiling, not the legacy blocks
 * figure the subgraph froze). `protocolFeePercentage` is GraphPayments' cut in PPM, as the subgraph's
 * was.
 */
export function graphNetworkFromNest(n: NestNetworkRow, p: NestNetworkParamsRow): GraphNetwork {
  return {
    totalTokensStaked: n.total_tokens_staked,
    totalDelegatedTokens: n.total_delegated_tokens,
    totalTokensSignalled: n.total_tokens_signalled,
    totalTokensAllocated: n.total_tokens_allocated,
    totalIndexingRewards: n.total_indexing_rewards,
    totalQueryFees: n.total_query_fees,
    currentEpoch: Number(n.current_epoch),
    epochLength: Number(p.epoch_length ?? 0),
    lastLengthUpdateEpoch: Number(p.last_length_update_epoch ?? 0),
    lastLengthUpdateBlock: Number(p.last_length_update_block ?? 0),
    indexerCount: Number(n.indexer_count),
    stakedIndexersCount: Number(n.staked_indexers_count),
    delegatorCount: Number(n.delegator_count),
    activeDelegatorCount: Number(n.active_delegator_count),
    curatorCount: Number(n.curator_count),
    activeCuratorCount: Number(n.active_curator_count),
    subgraphCount: Number(n.subgraph_count),
    activeSubgraphCount: Number(n.active_subgraph_count),
    delegationRatio: Number(p.delegation_ratio ?? 0),
    protocolFeePercentage: Number(p.protocol_payment_cut ?? 0),
    delegationTaxPercentage: 0,
    maxAllocationEpochs: null,
    thawingPeriod: null,
    totalSupply: n.total_supply ?? undefined,
    networkGRTIssuancePerBlock: n.issuance_per_block ?? undefined,
  };
}

/** Both rows, or a thrown error naming the one that failed; the `as_of` is the aggregates' block. */
export async function networkFromNest(): Promise<{ graphNetwork: GraphNetwork; params: NestNetworkParamsRow; raw: NestNetworkRow; asOf: number | null }> {
  const [n, p] = await Promise.all([
    nuthatchSqlReady<NestNetworkRow>(networkSql(), NETWORK_BASE_PATH),
    nuthatchSqlReady<NestNetworkParamsRow>(networkParamsSql(), NETWORK_BASE_PATH),
  ]);
  if (!n.ok) throw Object.assign(new Error(`lodestar_network: ${n.error}`), { nest: n });
  if (!p.ok) throw Object.assign(new Error(`lodestar_network_params: ${p.error}`), { nest: p });
  const row = n.data.rows[0]; const params = p.data.rows[0];
  if (!row || !params) throw new Error('lodestar_network or lodestar_network_params returned no row');
  return { graphNetwork: graphNetworkFromNest(row, params), params, raw: row, asOf: n.data.provenance?.as_of ?? null };
}

export async function GET() {
  // From the nest, always (nuthatch#1160). The gateway path this once fell back to left with the key.
  if (!hasNuthatch()) {
    return NextResponse.json({ error: 'Nuthatch is not configured' }, { status: 503 });
  }
  try {
    const data = await cached('lodestar:network-stats:nuthatch:v1', 300, async (): Promise<NetworkStatsResponse> => {
      const [net, grtSupply] = await Promise.all([networkFromNest(), fetchGrtSupplyBreakdown()]);
      return { graphNetwork: net.graphNetwork, _meta: { block: { number: net.asOf ?? 0 } }, grtSupply };
    });
    return NextResponse.json({ data, source: 'nuthatch' }, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
    });
  } catch (error) {
    log.api.error({ err: error }, 'Network stats from the nest failed');
    return NextResponse.json({ error: 'Failed to load network stats from Nuthatch' }, { status: 503 });
  }
}
