import { NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { PROTOCOLS } from '@/lib/protocols/config';
import { fetchProtocolSummary } from '@/lib/protocols/fetcher';

export async function GET() {
  try {
    const summaries = await cached('lodestar:protocols:directory', 3600, () =>
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
