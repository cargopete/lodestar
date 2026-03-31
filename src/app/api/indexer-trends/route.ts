import { NextRequest, NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { hasSubgraphAccess, horizonPerfQuery } from '@/lib/subgraph';
import type { IndexerTrendsResponse, RewardDailyAgg, QueryFeeDailyAgg } from '@/lib/queries';

/**
 * GET /api/indexer-trends?indexer=0x...&days=30
 *
 * Fetches daily reward and query fee trends from the community
 * Horizon Indexer Performance subgraph. Supplementary data — gracefully
 * degrades to empty arrays if the subgraph is unavailable.
 */
export async function GET(request: NextRequest) {
  const indexer = request.nextUrl.searchParams.get('indexer')?.toLowerCase();
  const days = Math.min(Number(request.nextUrl.searchParams.get('days') ?? 30), 90);

  if (!indexer) {
    return NextResponse.json({ error: 'indexer parameter required' }, { status: 400 });
  }

  if (!hasSubgraphAccess()) {
    return NextResponse.json({ error: 'No API key configured' }, { status: 503 });
  }

  const cacheKey = `lodestar:indexer-trends:${indexer}:${days}`;

  try {
    const data = await cached<IndexerTrendsResponse>(cacheKey, 600, async () => {
      // Query both reward and fee aggregations in one request
      const query = `{
        rewardDailyAggs(
          interval: day
          first: ${days}
          where: { indexer: "${indexer}" }
          orderBy: timestamp
          orderDirection: desc
        ) {
          timestamp
          indexer
          totalRewards
          totalIndexerRewards
          totalDelegationRewards
          rewardCount
        }
        queryFeeDailyAggs(
          interval: day
          first: ${days}
          where: { indexer: "${indexer}" }
          orderBy: timestamp
          orderDirection: desc
        ) {
          timestamp
          indexer
          totalCollected
          totalCurators
          feeCount
        }
      }`;

      const result = await horizonPerfQuery<{
        rewardDailyAggs: RewardDailyAgg[];
        queryFeeDailyAggs: QueryFeeDailyAgg[];
      }>(query);

      return {
        rewards: result.rewardDailyAggs ?? [],
        queryFees: result.queryFeeDailyAggs ?? [],
      };
    });

    return NextResponse.json({ data }, {
      headers: {
        'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=1200',
      },
    });
  } catch (error) {
    // Supplementary source — degrade gracefully
    console.error('Indexer trends error (non-critical):', error);
    return NextResponse.json({
      data: { rewards: [], queryFees: [] } as IndexerTrendsResponse,
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    });
  }
}
