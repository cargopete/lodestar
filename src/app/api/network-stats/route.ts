import { NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { subgraphQuery, hasSubgraphAccess } from '@/lib/subgraph';
import type { NetworkStatsResponse } from '@/lib/queries';
import { fetchGrtSupplyBreakdown } from '@/lib/grt-supply';
import { log } from '@/lib/logger';

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
    const data = await cached('lodestar:network-stats', 300, async () => {
      const [stats, grtSupply] = await Promise.all([
        subgraphQuery<NetworkStatsResponse>(QUERY),
        fetchGrtSupplyBreakdown(),
      ]);
      // grtSupply carries the de-double-counted global GRT supply (L1 + L2 − bridge escrow ≈ 11.5B),
      // the correct denominator for issuance. null if the on-chain reads were unavailable.
      return { ...stats, grtSupply };
    });

    return NextResponse.json({ data }, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch (error) {
    log.api.error({ err: error }, 'Network stats error');
    return NextResponse.json({ error: 'Failed to fetch network stats' }, { status: 500 });
  }
}
