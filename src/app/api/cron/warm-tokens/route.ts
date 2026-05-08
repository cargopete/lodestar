import { NextRequest, NextResponse } from 'next/server';
import { cacheSetSwr } from '@/lib/cache';
import { fetchTokenDirectory } from '@/lib/tokens/fetcher';
import { TOKENS_CACHE_KEY, TOKENS_CACHE_TTL } from '@/app/api/tokens/route';
import { log } from '@/lib/logger';

export const runtime = 'nodejs';
export const maxDuration = 300;

function isAuthorized(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  return request.headers.get('authorization') === `Bearer ${cronSecret}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const start = Date.now();
  try {
    const data = await fetchTokenDirectory();
    await cacheSetSwr(TOKENS_CACHE_KEY, data, TOKENS_CACHE_TTL);
    const durationMs = Date.now() - start;
    log.cron.info({ step: 'warm-tokens', count: data.length, durationMs }, 'Token directory cache warmed');
    return NextResponse.json({ ok: true, count: data.length, durationMs });
  } catch (error) {
    const durationMs = Date.now() - start;
    log.cron.error({ err: error, step: 'warm-tokens', durationMs }, 'Token directory warmup failed');
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
