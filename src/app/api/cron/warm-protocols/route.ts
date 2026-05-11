import { NextRequest, NextResponse } from 'next/server';
import { cacheSetSwr } from '@/lib/cache';
import { PROTOCOLS } from '@/lib/protocols/config';
import { fetchProtocolSummary } from '@/lib/protocols/fetcher';
import { PROTOCOLS_CACHE_KEY, PROTOCOLS_CACHE_TTL, type ProtocolsDirectoryPayload } from '@/app/api/protocols/route';
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
    const entries = await Promise.all(
      PROTOCOLS.map(async (p) => [p.slug, await fetchProtocolSummary(p)] as const),
    );
    const data: ProtocolsDirectoryPayload = Object.fromEntries(entries);
    await cacheSetSwr(PROTOCOLS_CACHE_KEY, data, PROTOCOLS_CACHE_TTL);
    const durationMs = Date.now() - start;
    log.cron.info({ step: 'warm-protocols', count: PROTOCOLS.length, durationMs }, 'Protocols directory cache warmed');
    return NextResponse.json({ ok: true, count: PROTOCOLS.length, durationMs });
  } catch (error) {
    const durationMs = Date.now() - start;
    log.cron.error({ err: error, step: 'warm-protocols', durationMs }, 'Protocols directory warmup failed');
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
