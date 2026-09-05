import { NextResponse, type NextRequest } from 'next/server';
import { cached } from '@/lib/cache';
import { subgraphQuery, hasSubgraphAccess } from '@/lib/subgraph';
import { log } from '@/lib/logger';
import { hasNuthatch, nuthatchEnabled, nuthatchSqlReady } from '@/lib/nuthatch';
import { curatorsSql, type NestCuratorRow } from '@/lib/nest-queries';

const CURATORS_BASE_PATH = process.env.NUTHATCH_CURATORS_BASE_PATH || '/alloc';

export interface CuratorLeaderboardEntry {
  id: string;
  totalSignalledTokens: string;
  totalUnsignalledTokens: string;
  realizedRewards: string;
  signalCount: number;
  activeSignalCount: number;
}

export function curatorFromNest(r: NestCuratorRow): CuratorLeaderboardEntry {
  return {
    id: r.id,
    totalSignalledTokens: r.total_signalled_tokens,
    totalUnsignalledTokens: r.total_unsignalled_tokens,
    realizedRewards: r.realized_rewards,
    signalCount: Number(r.signal_count),
    activeSignalCount: Number(r.active_signal_count),
  };
}

export async function GET(request: NextRequest) {
  const skip = Math.max(Number(request.nextUrl.searchParams.get('skip')) || 0, 0);
  const first = Math.min(Number(request.nextUrl.searchParams.get('first')) || 50, 100);

  // Off by default. nuthatch#1160 wants each surface switchable and revertible on its own. On the
  // nest path the gateway key is not consulted at all.
  if (nuthatchEnabled('NUTHATCH_CURATORS')) {
    if (!hasNuthatch()) {
      return NextResponse.json({ error: 'Nuthatch is not configured' }, { status: 503 });
    }
    try {
      const data = await cached(`lodestar:curators:nuthatch:v1:${first}:${skip}`, 300, async () => {
        const r = await nuthatchSqlReady<NestCuratorRow>(curatorsSql(first, skip), CURATORS_BASE_PATH);
        if (!r.ok) throw Object.assign(new Error(r.error), { nest: r });
        return r.data.rows.map(curatorFromNest);
      });
      return NextResponse.json({ data, source: 'nuthatch' }, {
        headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
      });
    } catch (error) {
      log.api.error({ err: error }, 'Curators from the nest failed');
      return NextResponse.json({ error: 'Failed to load curators from Nuthatch' }, { status: 503 });
    }
  }

  if (!hasSubgraphAccess()) {
    return NextResponse.json({ error: 'No API key configured' }, { status: 503 });
  }

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
