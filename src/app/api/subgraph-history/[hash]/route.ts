import { NextResponse, type NextRequest } from 'next/server';
import { cached } from '@/lib/cache';
import { subgraphQuery, hasSubgraphAccess } from '@/lib/subgraph';
import { weiToGRT } from '@/lib/utils';

interface RawSignalTx {
  timestamp: number;
  type: string; // 'MintSignal' | 'BurnSignal'
  tokens: string;
}

interface RawAllocation {
  allocatedTokens: string;
  createdAt: number;
  closedAt: number | null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ hash: string }> },
) {
  const { hash } = await params;

  if (!hasSubgraphAccess()) {
    return NextResponse.json({ error: 'No API key configured' }, { status: 503 });
  }

  const query = `{
    signalTransactions(
      where: { subgraphDeployment_: { ipfsHash: "${hash}" } }
      orderBy: timestamp
      orderDirection: asc
      first: 1000
    ) {
      timestamp
      type
      tokens
    }
    allocations(
      where: { subgraphDeployment_: { ipfsHash: "${hash}" } }
      orderBy: createdAt
      orderDirection: asc
      first: 1000
    ) {
      allocatedTokens
      createdAt
      closedAt
    }
  }`;

  const cacheKey = `lodestar:subgraph-history-v3:${hash}`;

  try {
    const data = await cached(cacheKey, 3600, async () => {
      const result = await subgraphQuery<{
        signalTransactions: RawSignalTx[];
        allocations: RawAllocation[];
      }>(query);

      const { signalTransactions, allocations } = result;

      if (signalTransactions.length === 0 && allocations.length === 0) {
        return { history: [] };
      }

      const nowTs = Math.floor(Date.now() / 1000);
      const oneYear = 365 * 24 * 3600;
      const earliestTs = Math.min(
        ...signalTransactions.map(t => t.timestamp),
        ...allocations.map(a => a.createdAt),
      );
      const startTs = Math.max(earliestTs, nowTs - oneYear);

      const weekSecs = 7 * 24 * 3600;
      const history: { date: string; signalGrt: number; stakeGrt: number }[] = [];

      for (let ts = startTs; ts <= nowTs; ts += weekSecs) {
        const date = new Date(ts * 1000).toISOString().slice(0, 10);

        // Cumulative signal: sum MintSignal − BurnSignal up to this timestamp
        let signalGrt = 0;
        for (const tx of signalTransactions) {
          if (tx.timestamp > ts) break;
          const grt = weiToGRT(tx.tokens);
          signalGrt += tx.type === 'MintSignal' ? grt : -grt;
        }

        // Active stake: sum allocations open at this timestamp
        let stakeGrt = 0;
        for (const alloc of allocations) {
          if (alloc.createdAt > ts) continue;
          const closed = alloc.closedAt;
          if (!closed || closed > ts) {
            stakeGrt += weiToGRT(alloc.allocatedTokens);
          }
        }

        history.push({ date, signalGrt: Math.max(0, signalGrt), stakeGrt });
      }

      // Trim leading points where activity is negligible (< 1 000 GRT combined)
      const firstMeaningful = history.findIndex(p => p.signalGrt + p.stakeGrt >= 1000);
      return { history: firstMeaningful > 0 ? history.slice(firstMeaningful) : history };
    });

    return NextResponse.json({ data }, {
      headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200' },
    });
  } catch (error) {
    console.error('Subgraph history error:', error);
    return NextResponse.json({ error: 'Failed to fetch subgraph history' }, { status: 500 });
  }
}
