import { NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { subgraphQuery, hasSubgraphAccess } from '@/lib/subgraph';
import type { NetworkStatsResponse } from '@/lib/queries';

const QUERY = `{
  graphNetwork(id: "1") {
    totalTokensStaked
    totalDelegatedTokens
    totalTokensSignalled
    totalTokensAllocated
    totalIndexingRewards
    totalQueryFees
    currentEpoch
    epochLength
    lastLengthUpdateEpoch
    lastLengthUpdateBlock
    indexerCount
    stakedIndexersCount
    delegatorCount
    activeDelegatorCount
    curatorCount
    activeCuratorCount
    subgraphCount
    activeSubgraphCount
    delegationRatio
    protocolFeePercentage
    delegationTaxPercentage
    maxAllocationEpochs
    thawingPeriod
    totalSupply
    networkGRTIssuancePerBlock
  }
  _meta {
    block {
      number
    }
  }
}`;

export async function GET() {
  if (!hasSubgraphAccess()) {
    return NextResponse.json({ error: 'No API key configured' }, { status: 503 });
  }

  try {
    const data = await cached('lodestar:network-stats', 300, () =>
      subgraphQuery<NetworkStatsResponse>(QUERY)
    );

    return NextResponse.json({ data }, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch (error) {
    console.error('Network stats error:', error);
    return NextResponse.json({ error: 'Failed to fetch network stats' }, { status: 500 });
  }
}
