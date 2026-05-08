import { NextRequest, NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { subgraphQuery, hasSubgraphAccess } from '@/lib/subgraph';
import { log } from '@/lib/logger';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params;
  const addr = address.toLowerCase();

  if (!/^0x[0-9a-f]{40}$/.test(addr)) {
    return NextResponse.json({ error: 'Invalid address format' }, { status: 400 });
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

      return {
        indexer: {
          ...result.indexer,
          allocations: allAllocations,
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
