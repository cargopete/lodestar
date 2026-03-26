import { NextResponse } from 'next/server';
import { cacheGet } from '@/lib/cache';
import type { LeaderboardEntry } from '@/lib/scoring';

interface LeaderboardCache {
  periodStart: string;
  periodEnd: string;
  computedAt: number;
  entries: LeaderboardEntry[];
}

export async function GET() {
  const data = await cacheGet<LeaderboardCache>('lodestar:leaderboard:latest');

  if (!data) {
    return NextResponse.json(
      { error: 'Leaderboard data not yet available — scores have not been computed' },
      { status: 503 }
    );
  }

  return NextResponse.json(data, {
    headers: {
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200',
    },
  });
}
