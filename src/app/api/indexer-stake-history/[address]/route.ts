import { NextResponse, type NextRequest } from 'next/server';
import { cached } from '@/lib/cache';
import { subgraphQuery, hasSubgraphAccess } from '@/lib/subgraph';
import { weiToGRT } from '@/lib/utils';
import { log } from '@/lib/logger';

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
