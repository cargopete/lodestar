import { NextRequest, NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { hasSubgraphAccess, horizonPerfQuery } from '@/lib/subgraph';
import type { IndexerTrendsResponse, RewardDailyAgg, QueryFeeDailyAgg } from '@/lib/queries';
import { log } from '@/lib/logger';

/**
 * GET /api/indexer-trends?indexer=0x...&days=30
 *
 * Fetches daily reward and query fee trends from the community
 * Horizon Indexer Performance subgraph. Supplementary data — gracefully
 * degrades to empty arrays if the subgraph is unavailable.
 */
const ETH_ADDRESS_RE = /^0x[0-9a-f]{40}$/;

export async function GET(request: NextRequest) {
  const indexerRaw = request.nextUrl.searchParams.get('indexer')?.toLowerCase();
  const days = Math.min(Math.max(parseInt(request.nextUrl.searchParams.get('days') ?? '30', 10) || 30, 1), 90);

  if (!indexerRaw) {
    return NextResponse.json({ error: 'indexer parameter required' }, { status: 400 });
  }
  if (!ETH_ADDRESS_RE.test(indexerRaw)) {
    return NextResponse.json({ error: 'Invalid indexer address' }, { status: 400 });
  }
  const indexer = indexerRaw;

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
    log.api.error({ err: error }, 'Indexer trends error (non-critical)');
    return NextResponse.json({
      data: { rewards: [], queryFees: [] } as IndexerTrendsResponse,
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    });
  }
}
