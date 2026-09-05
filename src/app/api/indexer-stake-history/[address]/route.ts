import { NextResponse, type NextRequest } from 'next/server';
import { cached } from '@/lib/cache';
import { subgraphQuery, hasSubgraphAccess } from '@/lib/subgraph';
import { weiToGRT } from '@/lib/utils';
import { log } from '@/lib/logger';
import { hasNuthatch, nuthatchEnabled, nuthatchSqlReady } from '@/lib/nuthatch';
import { indexerStakeHistorySql, type NestStakeHistoryRow } from '@/lib/nest-queries';

const INDEXERS_BASE_PATH = process.env.NUTHATCH_INDEXERS_BASE_PATH || '/alloc';

const ETH_ADDRESS_RE = /^0x[0-9a-f]{40}$/i;
// Arbitrum avg block time ~0.25s → 4 blocks/sec
const BLOCKS_PER_WEEK = Math.floor(7 * 86400 * 4);
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
  // Off by default (nuthatch#1160), the indexers flag. The gateway path pinned 27 blocks by an
  // Arbitrum block-rate estimate; the nest path sums the ledger up to 27 real Unix times, so the
  // dates are exact rather than estimated, and the key is not consulted.
  if (nuthatchEnabled('NUTHATCH_INDEXERS')) {
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

  if (!hasSubgraphAccess()) {
    return NextResponse.json({ error: 'No API key configured' }, { status: 503 });
  }

  const cacheKey = `lodestar:indexer-stake-history:${address}`;

  try {
    const data = await cached(cacheKey, 6 * 3600, async () => {
      const metaResult = await subgraphQuery<{ _meta: { block: { number: number } } }>(
        `{ _meta { block { number } } }`
      );
      const currentBlock = metaResult._meta.block.number;
      const now = Date.now();

      const aliases: string[] = [];
      const weekMeta: Array<{ alias: string; date: string }> = [];

      for (let i = WEEKS; i >= 0; i--) {
        const blockNum = currentBlock - i * BLOCKS_PER_WEEK;
        if (blockNum < 1) continue;
        const alias = `w${i}`;
        const date = new Date(now - i * 7 * 86400 * 1000).toISOString().slice(0, 10);
        aliases.push(
          `${alias}: indexer(id: "${address}", block: {number: ${blockNum}}) { stakedTokens delegatedTokens }`
        );
        weekMeta.push({ alias, date });
      }

      const result = await subgraphQuery<
        Record<string, { stakedTokens: string; delegatedTokens: string } | null>
      >(`{ ${aliases.join('\n')} }`);

      const history = weekMeta
        .map(({ alias, date }) => {
          const snap = result[alias];
          if (!snap) return null;
          return {
            date,
            selfStakeGrt: weiToGRT(snap.stakedTokens),
            delegatedGrt: weiToGRT(snap.delegatedTokens),
          };
        })
        .filter((p): p is { date: string; selfStakeGrt: number; delegatedGrt: number } => p !== null);

      return { history };
    });

    return NextResponse.json({ data }, {
      headers: { 'Cache-Control': 'public, s-maxage=21600, stale-while-revalidate=43200' },
    });
  } catch (error) {
    log.api.error({ err: error }, 'Indexer stake history error');
    return NextResponse.json({ error: 'Failed to fetch stake history' }, { status: 500 });
  }
}
