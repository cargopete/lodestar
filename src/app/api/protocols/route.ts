import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { cached } from '@/lib/cache';
import { PROTOCOLS } from '@/lib/protocols/config';
import { fetchProtocolSummary, type ProtocolSummary } from '@/lib/protocols/fetcher';

// Hash the slug list into the cache key so adding, removing, or reordering
// protocols invalidates the cached directory automatically. The `:v2` suffix
// reflects the slug-keyed payload shape; if older `:v1` array-shaped values
// were ever cached they live under a distinct key and won't be deserialized
// as the new Record shape.
const directoryCacheKey = `lodestar:protocols:directory:v2:${createHash('sha1')
  .update(PROTOCOLS.map((p) => p.slug).join(','))
  .digest('hex')
  .slice(0, 8)}`;

export type ProtocolsDirectoryPayload = Record<string, ProtocolSummary | null>;

export async function GET() {
  try {
    const summaries = await cached<ProtocolsDirectoryPayload>(directoryCacheKey, 3600, async () => {
      const entries = await Promise.all(
        PROTOCOLS.map(async (p) => [p.slug, await fetchProtocolSummary(p)] as const),
      );
      return Object.fromEntries(entries);
    });

    return NextResponse.json({ data: summaries }, {
      headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200' },
    });
  } catch (error) {
    console.error('Protocols directory error:', error);
    return NextResponse.json({ error: 'Failed to fetch protocols' }, { status: 500 });
  }
}
