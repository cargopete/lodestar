import { NextResponse, type NextRequest } from 'next/server';
import { cached } from '@/lib/cache';
import { subgraphQuery, hasSubgraphAccess } from '@/lib/subgraph';
import { log } from '@/lib/logger';

export interface CuratorLeaderboardEntry {
  id: string;
  totalSignalledTokens: string;
  totalUnsignalledTokens: string;
  realizedRewards: string;
  signalCount: number;
  activeSignalCount: number;
}

export async function GET(request: NextRequest) {
  if (!hasSubgraphAccess()) {
    return NextResponse.json({ error: 'No API key configured' }, { status: 503 });
  }

  const skip = Math.max(Number(request.nextUrl.searchParams.get('skip')) || 0, 0);
  const first = Math.min(Number(request.nextUrl.searchParams.get('first')) || 50, 100);

  const query = `{
    curators(
      first: ${first}
      skip: ${skip}
      orderBy: totalSignalledTokens
      orderDirection: desc
      where: { totalSignalledTokens_gt: "0", activeSignalCount_gt: 0 }
    ) {
      id
      totalSignalledTokens
      totalUnsignalledTokens
      realizedRewards
      signalCount
      activeSignalCount
    }
  }`;

  const cacheKey = `lodestar:curators:v1:${first}:${skip}`;

  try {
    const data = await cached(cacheKey, 300, async () => {
      const result = await subgraphQuery<{ curators: CuratorLeaderboardEntry[] }>(query);
      return result.curators;
    });

    return NextResponse.json({ data }, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
    });
  } catch (error) {
    log.api.error({ err: error }, 'Curators leaderboard error');
    return NextResponse.json({ error: 'Failed to fetch curators' }, { status: 500 });
  }
}
