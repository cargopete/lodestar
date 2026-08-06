import { NextResponse } from 'next/server';
import { cacheGet } from '@/lib/cache';
import type { EnrichedIndexer } from '@/lib/enriched';

export async function GET() {
  const data = await cacheGet<EnrichedIndexer[]>('lodestar:indexers-enriched');

  if (!data) {
    return NextResponse.json(
      { error: 'Enriched data not yet available; cron has not run' },
      { status: 503 }
    );
  }

  const BLOCKED = '0xb43b2cccceada5292732a8c58ae134adefce09bb';
  const filtered = data.filter(i => i.id.toLowerCase() !== BLOCKED);
  return NextResponse.json({ indexers: filtered, computedAt: filtered[0]?.computedAt ?? 0 }, {
    headers: {
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
    },
  });
}
