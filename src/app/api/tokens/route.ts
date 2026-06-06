import { NextResponse } from 'next/server';
import { cachedSwr } from '@/lib/cache';
import { fetchTokenDirectory } from '@/lib/tokens/fetcher';

export const runtime = 'nodejs';
export const maxDuration = 300;

export const TOKENS_CACHE_KEY = 'lodestar:tokens:directory:v1';
// 60-min soft TTL (SWR keeps a 4× hard window). Matched to the hourly
// warm-tokens cron so the cron is the sole refresher: the entry stays fresh
// for the full hour between runs, so on-demand visits never trigger an extra
// background fan-out in the gaps.
export const TOKENS_CACHE_TTL = 3600;

export async function GET() {
  try {
    const data = await cachedSwr(TOKENS_CACHE_KEY, TOKENS_CACHE_TTL, () => fetchTokenDirectory());
    return NextResponse.json(
      { data },
      { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=600' } }
    );
  } catch (error) {
    console.error('[tokens directory]', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
