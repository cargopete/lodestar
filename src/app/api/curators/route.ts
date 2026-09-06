import { NextResponse, type NextRequest } from 'next/server';
import { cached } from '@/lib/cache';
import { log } from '@/lib/logger';
import { hasNuthatch, nuthatchSqlReady } from '@/lib/nuthatch';
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

  // From the nest, always (nuthatch#1160). The gateway path this once fell back to left with the key.
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
