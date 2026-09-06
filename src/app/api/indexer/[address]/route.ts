import { NextRequest, NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { log } from '@/lib/logger';
import { hasNuthatch, nuthatchSqlReady } from '@/lib/nuthatch';
import {
  indexerDetailSql, indexerOperatorsSql, indexerDelegatorsSql, indexerActiveAllocationsSql,
  indexerClosedAllocationsSql, delegationRatioSql,
  type NestIndexerDetailRow, type NestDelegatorRow, type NestActiveAllocationRow, type NestClosedAllocationRow,
} from '@/lib/nest-queries';
import { bytes32ToIpfsHash } from '@/lib/studio/ipfs';
import { derivedIndexerMetrics } from '@/lib/nest-indexers';
export { derivedIndexerMetrics };

const INDEXERS_BASE_PATH = process.env.NUTHATCH_INDEXERS_BASE_PATH || '/alloc';

/** Everything the page reads, in the subgraph's shape, from six nest queries (nuthatch#1160). */
export async function indexerFromNest(addr: string): Promise<{ indexer: Record<string, unknown> | null }> {
  const q = <T,>(sql: string) => nuthatchSqlReady<T>(sql, INDEXERS_BASE_PATH);
  const [me, ops, dels, active, closed, ratio] = await Promise.all([
    q<NestIndexerDetailRow>(indexerDetailSql(addr)),
    q<{ operator: string }>(indexerOperatorsSql(addr)),
    q<NestDelegatorRow>(indexerDelegatorsSql(addr, 100)),
    q<NestActiveAllocationRow>(indexerActiveAllocationsSql(addr)),
    q<NestClosedAllocationRow>(indexerClosedAllocationsSql(addr, 50)),
    q<{ delegation_ratio: number | string | null }>(delegationRatioSql()),
  ]);
  for (const [name, r] of [['indexer', me], ['operators', ops], ['delegators', dels], ['active allocations', active], ['closed allocations', closed], ['delegation ratio', ratio]] as const) {
    if (!r.ok) throw Object.assign(new Error(`${name}: ${r.error}`), { nest: r });
  }
  if (!me.ok || !ops.ok || !dels.ok || !active.ok || !closed.ok || !ratio.ok) throw new Error('unreachable');
  const r = me.data.rows[0];
  if (!r) return { indexer: null };
  const delegationRatio = Number(ratio.data.rows[0]?.delegation_ratio ?? 16);
  const deployment = (id: string) => {
    try { return { id, ipfsHash: bytes32ToIpfsHash(id) }; } catch { return { id, ipfsHash: id }; }
  };
  return {
    indexer: {
      id: r.id,
      // `defaultDisplayName`, `metadata.displayName/description/website` are ENS and IPFS: null here
      // until the group B work; the operators are on chain and are real.
      account: { id: r.id, defaultDisplayName: null, operators: ops.data.rows.map((o) => ({ id: o.operator })), metadata: null },
      stakedTokens: r.staked_tokens,
      lockedTokens: r.locked_tokens,
      delegatedTokens: r.delegated_tokens,
      delegatedThawingTokens: r.delegated_thawing_tokens,
      allocatedTokens: r.allocated_tokens,
      allocationCount: Number(r.allocation_count),
      indexingRewardCut: Number(r.indexing_reward_cut ?? 0),
      queryFeeCut: Number(r.query_fee_cut ?? 0),
      rewardsEarned: r.rewards_earned,
      queryFeesCollected: r.query_fees_collected,
      delegatorShares: r.delegator_shares,
      delegatorParameterCooldown: 0,
      lastDelegationParameterUpdate: Number(r.last_delegation_parameter_update ?? r.created_at),
      url: r.url,
      geoHash: r.geohash,
      createdAt: Number(r.created_at),
      provisionedTokens: r.provisioned_tokens,
      ...derivedIndexerMetrics(r, delegationRatio),
      delegators: dels.data.rows.map((d) => ({ id: d.id, stakedTokens: d.staked_tokens, shareAmount: d.share_amount, delegator: { id: d.delegator } })),
      allocations: active.data.rows.map((a) => ({
        id: a.id, allocatedTokens: a.allocated_tokens, createdAtEpoch: Number(a.created_at_epoch),
        subgraphDeployment: { ...deployment(a.subgraph_deployment), signalledTokens: a.signalled_tokens, stakedTokens: a.deployment_staked_tokens ?? '0', versions: [] },
      })),
      closedAllocations: closed.data.rows.map((c) => ({
        id: c.id, allocatedTokens: c.allocated_tokens, createdAtEpoch: Number(c.created_at_epoch),
        closedAtEpoch: c.closed_at_epoch === null ? null : Number(c.closed_at_epoch), closedAt: c.closed_at,
        indexingRewards: c.indexing_rewards, queryFeesCollected: c.query_fees_collected, poi: c.poi, forceClosed: Boolean(c.force_closed),
        subgraphDeployment: { ...deployment(c.subgraph_deployment), versions: [] },
      })),
    },
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params;
  const addr = address.toLowerCase();

  if (!/^0x[0-9a-f]{40}$/.test(addr)) {
    return NextResponse.json({ error: 'Invalid address format' }, { status: 400 });
  }

  if (addr === '0xb43b2cccceada5292732a8c58ae134adefce09bb') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // From the nest, always (nuthatch#1160). The gateway path this once fell back to left with the key.
  if (!hasNuthatch()) {
    return NextResponse.json({ error: 'Nuthatch is not configured' }, { status: 503 });
  }
  try {
    const data = await cached(`lodestar:indexer:${addr}:nuthatch:v1`, 300, () => indexerFromNest(addr));
    return NextResponse.json({ data, source: 'nuthatch' }, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
    });
  } catch (error) {
    log.api.error({ err: error }, 'Indexer detail from the nest failed');
    return NextResponse.json({ error: 'Failed to load indexer from Nuthatch' }, { status: 503 });
  }
}
