import { NextRequest, NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { subgraphQuery, hasSubgraphAccess } from '@/lib/subgraph';
import type { IndexersResponse } from '@/lib/queries';
import { log } from '@/lib/logger';

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

  if (!hasSubgraphAccess()) {
    return NextResponse.json({ error: 'No API key configured' }, { status: 503 });
  }

  const cacheKey = `lodestar:indexers:${first}:${skip}:${orderBy}:${orderDirection}`;

  try {
    const data = await cached(cacheKey, 300, () =>
      subgraphQuery<IndexersResponse>(`{
        indexers(
          first: ${first}
          skip: ${skip}
          orderBy: ${orderBy}
          orderDirection: ${orderDirection}
          where: { stakedTokens_gt: "0", id_not: "0xb43b2cccceada5292732a8c58ae134adefce09bb" }
        ) {
          id
          account {
            id
            defaultDisplayName
            metadata {
              displayName
              description
            }
          }
          stakedTokens
          lockedTokens
          delegatedTokens
          allocatedTokens
          allocationCount
          indexingRewardCut
          queryFeeCut
          delegatorParameterCooldown
          lastDelegationParameterUpdate
          rewardsEarned
          delegatorShares
          url
          geoHash
          createdAt
        }
      }`)
    );

    return NextResponse.json({ data }, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch (error) {
    log.api.error({ err: error }, 'Indexers error');
    return NextResponse.json({ error: 'Failed to fetch indexers' }, { status: 500 });
  }
}
