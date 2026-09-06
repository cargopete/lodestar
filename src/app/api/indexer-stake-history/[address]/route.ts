import { NextResponse, type NextRequest } from 'next/server';
import { cached } from '@/lib/cache';
import { weiToGRT } from '@/lib/utils';
import { log } from '@/lib/logger';
import { hasNuthatch, nuthatchSqlReady } from '@/lib/nuthatch';
import { indexerStakeHistorySql, type NestStakeHistoryRow } from '@/lib/nest-queries';

const INDEXERS_BASE_PATH = process.env.NUTHATCH_INDEXERS_BASE_PATH || '/alloc';

const ETH_ADDRESS_RE = /^0x[0-9a-f]{40}$/i;
const WEEKS = 26;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address: rawAddress } = await params;
  const address = rawAddress.toLowerCase();

  if (!ETH_ADDRESS_RE.test(address)) {
    return NextResponse.json({ error: 'Invalid address' }, { status: 400 });
  }
  // From the nest, always (nuthatch#1160). The gateway path this once fell back to left with the key.
  if (!hasNuthatch()) {
    return NextResponse.json({ error: 'Nuthatch is not configured' }, { status: 503 });
  }
  try {
    const data = await cached(`lodestar:indexer-stake-history:${address}:nuthatch:v1`, 6 * 3600, async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const points = Array.from({ length: WEEKS + 1 }, (_, j) => WEEKS - j).map((i) => ({
        cutoff: nowSec - i * 7 * 86400,
        date: new Date((nowSec - i * 7 * 86400) * 1000).toISOString().slice(0, 10),
      }));
      const r = await nuthatchSqlReady<NestStakeHistoryRow>(indexerStakeHistorySql(address, points.map((p) => p.cutoff)), INDEXERS_BASE_PATH);
      if (!r.ok) throw Object.assign(new Error(r.error), { nest: r });
      const byCutoff = new Map(r.data.rows.map((row) => [Number(row.cutoff), row]));
      const history = points
        .map(({ cutoff, date }) => {
          const row = byCutoff.get(cutoff);
          if (!row) return null;
          return { date, selfStakeGrt: weiToGRT(row.staked_tokens), delegatedGrt: weiToGRT(row.delegated_tokens) };
        })
        .filter((p): p is { date: string; selfStakeGrt: number; delegatedGrt: number } => p !== null);
      return { history };
    });
    return NextResponse.json({ data, source: 'nuthatch' }, {
      headers: { 'Cache-Control': 'public, s-maxage=21600, stale-while-revalidate=43200' },
    });
  } catch (error) {
    log.api.error({ err: error }, 'Indexer stake history from the nest failed');
    return NextResponse.json({ error: 'Failed to load stake history from Nuthatch' }, { status: 503 });
  }
}
