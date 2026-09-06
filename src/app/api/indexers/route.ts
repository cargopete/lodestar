import { NextRequest, NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import type { Indexer, IndexersResponse } from '@/lib/queries';
import { log } from '@/lib/logger';
import { hasNuthatch, nuthatchSqlReady } from '@/lib/nuthatch';
import { indexersSql, type NestIndexerRow } from '@/lib/nest-queries';

const INDEXERS_BASE_PATH = process.env.NUTHATCH_INDEXERS_BASE_PATH || '/alloc';

/**
 * One nest row in the subgraph's `Indexer` shape, so the pages consuming `/api/indexers` see no
 * change. Two fields are not on chain and are null here: `account.defaultDisplayName` and
 * `account.metadata` are ENS and IPFS respectively, and they arrive with the group B work in
 * nuthatch#1160, not with this route. A cut the contract has never had set is 0 in the contract,
 * so it is 0 here rather than a guess; `delegatorParameterCooldown` is a legacy parameter that
 * Horizon removed, and the subgraph reports it as 0 for every indexer today.
 */
export function indexerFromNest(r: NestIndexerRow): Indexer {
  return {
    id: r.id,
    account: { id: r.id, defaultDisplayName: null, metadata: null },
    stakedTokens: r.staked_tokens,
    lockedTokens: r.locked_tokens,
    delegatedTokens: r.delegated_tokens,
    allocatedTokens: r.allocated_tokens,
    allocationCount: Number(r.allocation_count),
    indexingRewardCut: Number(r.indexing_reward_cut ?? 0),
    queryFeeCut: Number(r.query_fee_cut ?? 0),
    delegatorParameterCooldown: 0,
    lastDelegationParameterUpdate: Number(r.last_delegation_parameter_update ?? r.created_at),
    rewardsEarned: r.rewards_earned,
    delegatorShares: r.delegator_shares,
    url: r.url,
    geoHash: r.geohash,
    createdAt: Number(r.created_at),
  };
}

const VALID_ORDER_BY = new Set([
  'stakedTokens', 'delegatedTokens', 'allocatedTokens',
  'id', 'createdAt', 'queryFeesCollected', 'rewardsEarned',
]);
const VALID_ORDER_DIR = new Set(['asc', 'desc']);

export async function GET(request: NextRequest) {
  const first = Math.min(Math.max(parseInt(request.nextUrl.searchParams.get('first') ?? '100', 10) || 100, 1), 500);
  const skip = Math.max(parseInt(request.nextUrl.searchParams.get('skip') ?? '0', 10) || 0, 0);
  const orderByRaw = request.nextUrl.searchParams.get('orderBy') ?? 'stakedTokens';
  const orderBy = VALID_ORDER_BY.has(orderByRaw) ? orderByRaw : 'stakedTokens';
  const orderDirRaw = request.nextUrl.searchParams.get('orderDirection') ?? 'desc';
  const orderDirection = VALID_ORDER_DIR.has(orderDirRaw) ? orderDirRaw : 'desc';

  // From the nest, always (nuthatch#1160). The gateway path this once fell back to left with the key.
  if (!hasNuthatch()) {
    return NextResponse.json({ error: 'Nuthatch is not configured' }, { status: 503 });
  }
  const nestKey = `lodestar:indexers:${first}:${skip}:${orderBy}:${orderDirection}:nuthatch:v1`;
  try {
    const data = await cached(nestKey, 300, async (): Promise<IndexersResponse> => {
      const r = await nuthatchSqlReady<NestIndexerRow>(
        indexersSql(first, skip, orderBy, orderDirection as 'asc' | 'desc'),
        INDEXERS_BASE_PATH,
      );
      if (!r.ok) throw Object.assign(new Error(r.error), { nest: r });
      return { indexers: r.data.rows.map(indexerFromNest) };
    });
    return NextResponse.json({ data, source: 'nuthatch' }, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
    });
  } catch (error) {
    log.api.error({ err: error }, 'Indexers from the nest failed');
    return NextResponse.json({ error: 'Failed to load indexers from Nuthatch' }, { status: 503 });
  }
}
