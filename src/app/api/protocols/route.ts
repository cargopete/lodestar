import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { cached } from '@/lib/cache';
import { PROTOCOLS } from '@/lib/protocols/config';
import { fetchProtocolSummary } from '@/lib/protocols/fetcher';

// Hash the slug list into the cache key so adding, removing, or reordering
// protocols invalidates the cached directory automatically. Otherwise the
// cached array gets re-served by index against a different PROTOCOLS shape.
const directoryCacheKey = `lodestar:protocols:directory:${createHash('sha1')
  .update(PROTOCOLS.map((p) => p.slug).join(','))
  .digest('hex')
  .slice(0, 8)}`;

export async function GET() {
  try {
    const summaries = await cached(directoryCacheKey, 3600, () =>
      Promise.all(PROTOCOLS.map((p) => fetchProtocolSummary(p)))
    );

    return NextResponse.json({ data: summaries }, {
      headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200' },
    });
  } catch (error) {
    console.error('Protocols directory error:', error);
    return NextResponse.json({ error: 'Failed to fetch protocols' }, { status: 500 });
  }
}
