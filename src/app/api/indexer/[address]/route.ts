import { NextRequest, NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { subgraphQuery, hasSubgraphAccess } from '@/lib/subgraph';
import { log } from '@/lib/logger';
import { hasNuthatch, nuthatchEnabled, nuthatchSqlReady } from '@/lib/nuthatch';
import {
  indexerDetailSql, indexerOperatorsSql, indexerDelegatorsSql, indexerActiveAllocationsSql,
  indexerClosedAllocationsSql, delegationRatioSql,
  type NestIndexerDetailRow, type NestDelegatorRow, type NestActiveAllocationRow, type NestClosedAllocationRow,
} from '@/lib/nest-queries';
import { bytes32ToIpfsHash } from '@/lib/studio/ipfs';

const INDEXERS_BASE_PATH = process.env.NUTHATCH_INDEXERS_BASE_PATH || '/alloc';

/**
 * The subgraph's derived indexer metrics, ported from its `helpers.ts` (`calculateOwnStakeRatio`,
 * `calculateDelegatedStakeRatio`, `calculateIndexingRewardEffectiveCut`,
 * `calculateOverdelegationDilution`, `calculateIndexerRewardOwnGenerationRatio`) so the page's
 * numbers mean what they meant, and `tokenCapacity`, which the contracts define as own stake plus
 * delegation up to the ratio. Ratios as decimal strings like the subgraph's BigDecimals.
 */
export function derivedIndexerMetrics(r: NestIndexerDetailRow, delegationRatio: number) {
  const staked = Number(r.staked_tokens) / 1e18;
  const locked = Number(r.locked_tokens) / 1e18;
  const delegated = Number(r.delegated_tokens) / 1e18;
  const usableOwn = staked - locked;
  const maxUsable = usableOwn + usableOwn * delegationRatio;
  const totalUsable = Math.min(maxUsable, usableOwn + delegated);
  const ownStakeRatio = totalUsable === 0 ? 0 : usableOwn / totalUsable;
  const delegatedStakeRatio = ownStakeRatio === 0 ? 0 : 1 - ownStakeRatio;
  const cut = Number(r.indexing_reward_cut ?? 0);
  const delegatorCut = (1_000_000 - cut) / 1_000_000;
  const indexingRewardEffectiveCut = delegatedStakeRatio === 0 ? 0 : 1 - delegatorCut / delegatedStakeRatio;
  const maxDelegated = staked * delegationRatio;
  const dilutionDenom = Math.max(maxDelegated, delegated);
  const overDelegationDilution = dilutionDenom === 0 ? 0 : 1 - maxDelegated / dilutionDenom;
  const indexerRewardsOwnGenerationRatio = ownStakeRatio === 0 ? 0 : cut / 1_000_000 / ownStakeRatio;
  const stakedWei = BigInt(r.staked_tokens); const delegatedWei = BigInt(r.delegated_tokens);
  const maxDelegatedWei = stakedWei * BigInt(delegationRatio);
  const capacity = stakedWei + (delegatedWei < maxDelegatedWei ? delegatedWei : maxDelegatedWei);
  return {
    tokenCapacity: capacity.toString(),
    ownStakeRatio: String(ownStakeRatio),
    delegatedStakeRatio: String(delegatedStakeRatio),
    indexingRewardEffectiveCut: String(indexingRewardEffectiveCut),
    overDelegationDilution: String(overDelegationDilution),
    indexerRewardsOwnGenerationRatio: String(indexerRewardsOwnGenerationRatio),
  };
}

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

  // Off by default (nuthatch#1160), the same flag as /api/indexers. On the nest path the gateway
  // key is not consulted at all.
  if (nuthatchEnabled('NUTHATCH_INDEXERS')) {
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

  if (!hasSubgraphAccess()) {
    return NextResponse.json({ error: 'No API key configured' }, { status: 503 });
  }

  try {
    const data = await cached(`lodestar:indexer:${addr}`, 300, async () => {
      // Fetch indexer details
      const result = await subgraphQuery<{ indexer: Record<string, unknown> | null }>(`{
        indexer(id: "${addr}") {
          id
          account {
            id
            defaultDisplayName
            operators { id }
            metadata {
              displayName
              description
              website
            }
          }
          stakedTokens
          lockedTokens
          delegatedTokens
          delegatedThawingTokens
          allocatedTokens
          tokenCapacity
          allocationCount
          indexingRewardCut
          queryFeeCut
          rewardsEarned
          queryFeesCollected
          delegatorShares
          delegatorParameterCooldown
          lastDelegationParameterUpdate
          url
          geoHash
          createdAt
          indexingRewardEffectiveCut
          overDelegationDilution
          ownStakeRatio
          delegatedStakeRatio
          indexerRewardsOwnGenerationRatio
          provisionedTokens
          delegators(first: 100, orderBy: stakedTokens, orderDirection: desc) {
            id
            stakedTokens
            shareAmount
            delegator {
              id
            }
          }
        }
      }`);

      if (!result.indexer) return { indexer: null };

      // Paginate through ALL active allocations (subgraph caps at 1000 per query)
      interface Allocation {
        id: string;
        allocatedTokens: string;
        createdAtEpoch: number;
        subgraphDeployment: {
          id: string;
          ipfsHash: string;
          signalledTokens: string;
          stakedTokens: string;
          versions: Array<{ subgraph: { metadata: { displayName: string } | null } | null }>;
        };
      }
      let allAllocations: Allocation[] = [];
      let lastId = '';
      while (true) {
        const allocResult = await subgraphQuery<{ allocations: Allocation[] }>(`{
          allocations(
            first: 1000,
            where: { indexer: "${addr}", status: Active${lastId ? `, id_gt: "${lastId}"` : ''} }
            orderBy: id
            orderDirection: asc
          ) {
            id
            allocatedTokens
            createdAtEpoch
            subgraphDeployment {
              id
              ipfsHash
              signalledTokens
              stakedTokens
              versions(first: 1, orderBy: createdAt, orderDirection: desc) {
                subgraph { metadata { displayName } }
              }
            }
          }
        }`);
        const batch = allocResult.allocations ?? [];
        allAllocations = allAllocations.concat(batch);
        if (batch.length < 1000) break;
        lastId = batch[batch.length - 1].id;
      }

      // Fetch the most recent closed allocations (history can be huge — cap at 50).
      interface ClosedAllocation {
        id: string;
        allocatedTokens: string;
        createdAtEpoch: number;
        closedAtEpoch: number | null;
        closedAt: number | null;
        indexingRewards: string;
        queryFeesCollected: string;
        poi: string | null;
        forceClosed: boolean;
        subgraphDeployment: {
          id: string;
          ipfsHash: string;
          versions: Array<{ subgraph: { metadata: { displayName: string } | null } | null }>;
        };
      }
      const closedResult = await subgraphQuery<{ allocations: ClosedAllocation[] }>(`{
        allocations(
          first: 50,
          where: { indexer: "${addr}", status: Closed }
          orderBy: closedAt
          orderDirection: desc
        ) {
          id
          allocatedTokens
          createdAtEpoch
          closedAtEpoch
          closedAt
          indexingRewards
          queryFeesCollected
          poi
          forceClosed
          subgraphDeployment {
            id
            ipfsHash
            versions(first: 1, orderBy: createdAt, orderDirection: desc) {
              subgraph { metadata { displayName } }
            }
          }
        }
      }`);

      return {
        indexer: {
          ...result.indexer,
          allocations: allAllocations,
          closedAllocations: closedResult.allocations ?? [],
        },
      };
    });

    return NextResponse.json({ data }, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch (error) {
    log.api.error({ err: error }, 'Indexer detail error');
    return NextResponse.json({ error: 'Failed to fetch indexer' }, { status: 500 });
  }
}
