import { NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { fetchTokenDirectory } from '@/lib/tokens/fetcher';

export const runtime = 'nodejs';

const CACHE_KEY = 'lodestar:tokens:directory:v0';

export async function GET() {
  try {
    const data = await cached(CACHE_KEY, 300, () => fetchTokenDirectory());
    return NextResponse.json(
      { data },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } }
    );
  } catch (error) {
    console.error('[tokens directory]', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
