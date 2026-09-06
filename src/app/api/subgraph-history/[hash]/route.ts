import { NextResponse, type NextRequest } from 'next/server';
import { cached } from '@/lib/cache';
import { weiToGRT } from '@/lib/utils';
import { log } from '@/lib/logger';
import { hasNuthatch, nuthatchSqlReady } from '@/lib/nuthatch';
import { deploymentSignalTransactionsSql, deploymentAllocationsHistorySql, type NestSignalTxRow, type NestAllocationHistoryRow } from '@/lib/nest-queries';
import { ipfsHashToBytes32 } from '@/lib/studio/ipfs';

const ALLOC_BASE_PATH = process.env.NUTHATCH_ALLOCATIONS_BASE_PATH || '/alloc';

/** The two series the history is folded from, in the gateway's shapes, from graph-allocations-nest (nuthatch#1160). */
async function seriesFromNest(hash: string): Promise<{ signalTransactions: RawSignalTx[]; allocations: RawAllocation[] }> {
  const id = ipfsHashToBytes32(hash).toLowerCase();
  const [tx, al] = await Promise.all([
    nuthatchSqlReady<NestSignalTxRow>(deploymentSignalTransactionsSql(id, 1000), ALLOC_BASE_PATH),
    nuthatchSqlReady<NestAllocationHistoryRow>(deploymentAllocationsHistorySql(id, 1000), ALLOC_BASE_PATH),
  ]);
  if (!tx.ok) throw Object.assign(new Error(tx.error), { nest: tx });
  if (!al.ok) throw Object.assign(new Error(al.error), { nest: al });
  return {
    signalTransactions: tx.data.rows.map((t) => ({ timestamp: Number(t.timestamp), type: t.type, tokens: t.tokens })),
    allocations: al.data.rows.map((a) => ({ allocatedTokens: a.allocated_tokens, createdAt: Number(a.created_at), closedAt: a.closed_at === null ? null : Number(a.closed_at) })),
  };
}

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

const IPFS_HASH_RE = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ hash: string }> },
) {
  const { hash } = await params;

  if (!IPFS_HASH_RE.test(hash)) {
    return NextResponse.json({ error: 'Invalid deployment hash' }, { status: 400 });
  }

  // From the nest (nuthatch#1160); the gateway path this once fell back to left with the key.
  if (!hasNuthatch()) {
    return NextResponse.json({ error: 'Nuthatch is not configured' }, { status: 503 });
  }

  const cacheKey = `lodestar:subgraph-history-v4:${hash}:nuthatch`;

  try {
    const data = await cached(cacheKey, 3600, async () => {
      const result = await seriesFromNest(hash);

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

      // Trim leading flat section: drop points below 2% of peak combined value
      const peak = Math.max(...history.map(p => p.signalGrt + p.stakeGrt));
      const threshold = peak * 0.02;
      const firstMeaningful = history.findIndex(p => p.signalGrt + p.stakeGrt >= threshold);
      return { history: firstMeaningful > 0 ? history.slice(firstMeaningful) : history };
    });

    return NextResponse.json({ data }, {
      headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200' },
    });
  } catch (error) {
    log.api.error({ err: error }, 'Subgraph history error');
    return NextResponse.json({ error: 'Failed to fetch subgraph history' }, { status: 500 });
  }
}
