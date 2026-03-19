import { NextRequest, NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { subgraphQuery, hasSubgraphAccess } from '@/lib/subgraph';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params;
  const addr = address.toLowerCase();

  if (!hasSubgraphAccess()) {
    return NextResponse.json({ error: 'No API key configured' }, { status: 503 });
  }

  try {
    const data = await cached(`lodestar:indexer:${addr}`, 300, () =>
      subgraphQuery(`{
        indexer(id: "${addr}") {
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
          tokenCapacity
          allocationCount
          indexingRewardCut
          queryFeeCut
          rewardsEarned
          delegatorShares
          url
          geoHash
          createdAt
          delegatorParameterCooldown
          lastDelegationParameterUpdate
          allocations(first: 100, where: { status: Active }) {
            id
            allocatedTokens
            createdAtEpoch
            subgraphDeployment {
              id
              signalledTokens
              stakedTokens
            }
          }
          delegators(first: 100) {
            id
            stakedTokens
            shareAmount
            delegator {
              id
            }
          }
        }
      }`)
    );

    return NextResponse.json({ data }, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch (error) {
    console.error('Indexer detail error:', error);
    return NextResponse.json({ error: 'Failed to fetch indexer' }, { status: 500 });
  }
}
