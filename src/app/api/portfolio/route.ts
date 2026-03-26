import { NextRequest, NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { subgraphQuery, hasSubgraphAccess } from '@/lib/subgraph';
import type { DelegatorPortfolioResponse, CuratorPortfolioResponse } from '@/lib/queries';

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get('address')?.toLowerCase();
  const type = request.nextUrl.searchParams.get('type'); // 'delegator' or 'curator'

  if (!address) {
    return NextResponse.json({ error: 'address parameter required' }, { status: 400 });
  }
  if (type !== 'delegator' && type !== 'curator') {
    return NextResponse.json({ error: 'type must be delegator or curator' }, { status: 400 });
  }

  if (!hasSubgraphAccess()) {
    return NextResponse.json({ error: 'No API key configured' }, { status: 503 });
  }

  try {
    if (type === 'delegator') {
      const data = await cached(`lodestar:portfolio:delegator:${address}`, 120, () =>
        subgraphQuery<DelegatorPortfolioResponse>(`{
          delegator(id: "${address}") {
            id
            totalStakedTokens
            totalUnstakedTokens
            totalRealizedRewards
            stakesCount
            activeStakesCount
            stakes(first: 100, orderBy: stakedTokens, orderDirection: desc) {
              id
              stakedTokens
              shareAmount
              lockedTokens
              lockedUntil
              realizedRewards
              unstakedTokens
              createdAt
              lastUndelegatedAt
              indexer {
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
                delegatorShares
                indexingRewardCut
                queryFeeCut
                delegatorParameterCooldown
                allocationCount
                indexingRewardEffectiveCut
              }
            }
          }
        }`)
      );

      return NextResponse.json({ data }, {
        headers: {
          'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=300',
        },
      });
    }

    // Curator
    const data = await cached(`lodestar:portfolio:curator:${address}`, 120, () =>
      subgraphQuery<CuratorPortfolioResponse>(`{
        curator(id: "${address}") {
          id
          totalSignalledTokens
          totalUnsignalledTokens
          totalNameSignalledTokens
          totalNameUnsignalledTokens
          totalWithdrawnTokens
          realizedRewards
          signalCount
          activeSignalCount
          signals(first: 100, orderBy: signalledTokens, orderDirection: desc) {
            id
            signalledTokens
            unsignalledTokens
            signal
            lastSignalChange
            realizedRewards
            subgraphDeployment {
              id
              ipfsHash
              signalledTokens
              queryFeesAmount
              stakedTokens
            }
          }
        }
      }`)
    );

    return NextResponse.json({ data }, {
      headers: {
        'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=300',
      },
    });
  } catch (error) {
    console.error('Portfolio error:', error);
    return NextResponse.json({ error: 'Failed to fetch portfolio' }, { status: 500 });
  }
}
