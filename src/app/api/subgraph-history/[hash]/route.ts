import { NextResponse, type NextRequest } from 'next/server';
import { cached } from '@/lib/cache';
import { subgraphQuery, hasSubgraphAccess } from '@/lib/subgraph';
import { weiToGRT } from '@/lib/utils';

interface RawDailyData {
  dayStart: number;
  signalledTokens: string;
  stakedTokens: string;
}

interface RawDeployment {
  dailyData: RawDailyData[];
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ hash: string }> },
) {
  const { hash } = await params;

  if (!hasSubgraphAccess()) {
    return NextResponse.json({ error: 'No API key configured' }, { status: 503 });
  }

  const query = `{
    subgraphDeployments(where: { ipfsHash: "${hash}" }, first: 1) {
      dailyData(orderBy: dayStart, orderDirection: asc, first: 365) {
        dayStart
        signalledTokens
        stakedTokens
      }
    }
  }`;

  const cacheKey = `lodestar:subgraph-history:${hash}`;

  try {
    const data = await cached(cacheKey, 3600, async () => {
      const result = await subgraphQuery<{ subgraphDeployments: RawDeployment[] }>(query);
      const deployment = result.subgraphDeployments[0];
      if (!deployment) return { history: [] };

      const history = deployment.dailyData.map((d) => ({
        date: new Date(d.dayStart * 1000).toISOString().slice(0, 10),
        signalGrt: weiToGRT(d.signalledTokens),
        stakeGrt: weiToGRT(d.stakedTokens),
      }));

      return { history };
    });

    return NextResponse.json({ data }, {
      headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200' },
    });
  } catch (error) {
    console.error('Subgraph history error:', error);
    return NextResponse.json({ error: 'Failed to fetch subgraph history' }, { status: 500 });
  }
}
