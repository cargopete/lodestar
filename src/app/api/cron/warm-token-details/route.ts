import { NextRequest, NextResponse } from 'next/server';
import { cacheSetSwr } from '@/lib/cache';
import { fetchTokenDetail } from '@/lib/tokens/fetcher';
import { TOKEN_SEEDS } from '@/lib/tokens/seed';
import { log } from '@/lib/logger';

export const runtime = 'nodejs';
export const maxDuration = 300;

const SUPPORTED_CHAINS = new Set(['mainnet']);
const DETAIL_TTL = 600;
const detailKey = (chain: string, address: string) =>
  `lodestar:tokens:detail:v0:${chain}:${address.toLowerCase()}`;

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
  const seeds = TOKEN_SEEDS.filter((s) => SUPPORTED_CHAINS.has(s.chain));
  let warmed = 0;
  let failed = 0;

  // 5 concurrent detail fetches — each token fires ~15 upstream calls so
  // concurrency 5 stays well under the Token API rate limit (500/min) while
  // keeping total wall time under the 300s Vercel limit for ~154 seeds.
  let idx = 0;
  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= seeds.length) return;
      const seed = seeds[i];
      try {
        const detail = await fetchTokenDetail(seed.chain, seed.contract);
        if (detail != null) {
          await cacheSetSwr(detailKey(seed.chain, seed.contract), detail, DETAIL_TTL);
          warmed++;
        }
      } catch (err) {
        failed++;
        log.cron.warn({ err, symbol: seed.symbol }, 'warm-token-details: seed failed');
      }
    }
  }
  await Promise.all(Array.from({ length: 5 }, () => worker()));

  const durationMs = Date.now() - start;
  log.cron.info({ step: 'warm-token-details', warmed, failed, durationMs }, 'Token detail cache warmed');
  return NextResponse.json({ ok: true, warmed, failed, durationMs });
}
