import { NextRequest, NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { subgraphQuery, hasSubgraphAccess } from '@/lib/subgraph';
import type { IndexersResponse } from '@/lib/queries';

export async function GET(request: NextRequest) {
  const first = Math.min(Number(request.nextUrl.searchParams.get('first') ?? 100), 500);
  const skip = Number(request.nextUrl.searchParams.get('skip') ?? 0);
  const orderBy = request.nextUrl.searchParams.get('orderBy') ?? 'stakedTokens';
  const orderDirection = request.nextUrl.searchParams.get('orderDirection') ?? 'desc';

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
          where: { stakedTokens_gt: "0" }
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
    console.error('Indexers error:', error);
    return NextResponse.json({ error: 'Failed to fetch indexers' }, { status: 500 });
  }
}
