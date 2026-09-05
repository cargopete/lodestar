import { NextRequest, NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { subgraphQuery, hasSubgraphAccess } from '@/lib/subgraph';
import type { Epoch, EpochHistoryResponse } from '@/lib/queries';
import { log } from '@/lib/logger';
import { hasNuthatch, nuthatchEnabled, nuthatchSqlReady } from '@/lib/nuthatch';
import { epochsSql, epochTotalQueryFees, type NestEpochRow } from '@/lib/nest-queries';

const EPOCHS_BASE_PATH = process.env.NUTHATCH_EPOCHS_BASE_PATH || '/alloc';

/** One `lodestar_epochs` row in the subgraph's `Epoch` shape; wei stays a decimal string. */
export function epochFromNest(r: NestEpochRow): Epoch {
  return {
    id: String(r.id),
    startBlock: Number(r.start_block),
    endBlock: Number(r.end_block),
    signalledTokens: r.signalled_tokens,
    stakeDeposited: r.stake_deposited,
    totalQueryFees: epochTotalQueryFees(r),
    totalRewards: r.total_rewards,
    totalIndexerRewards: r.total_indexer_rewards,
    totalDelegatorRewards: r.total_delegator_rewards,
  };
}

export async function GET(request: NextRequest) {
  const count = Math.min(
    Number(request.nextUrl.searchParams.get('count') ?? 30),
    400
  );

  // Off by default (nuthatch#1160). On the nest path the gateway key is not consulted at all.
  if (nuthatchEnabled('NUTHATCH_EPOCHS')) {
    if (!hasNuthatch()) {
      return NextResponse.json({ error: 'Nuthatch is not configured' }, { status: 503 });
    }
    try {
      const data = await cached(`lodestar:epochs:nuthatch:v1:${count}`, 600, async (): Promise<EpochHistoryResponse> => {
        const r = await nuthatchSqlReady<NestEpochRow>(epochsSql(count), EPOCHS_BASE_PATH);
        if (!r.ok) throw Object.assign(new Error(r.error), { nest: r });
        return { epoches: r.data.rows.map(epochFromNest) };
      });
      return NextResponse.json({ data, source: 'nuthatch' }, {
        headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=1200' },
      });
    } catch (error) {
      log.api.error({ err: error }, 'Epochs from the nest failed');
      return NextResponse.json({ error: 'Failed to load epochs from Nuthatch' }, { status: 503 });
    }
  }

  if (!hasSubgraphAccess()) {
    return NextResponse.json({ error: 'No API key configured' }, { status: 503 });
  }

  try {
    const data = await cached(`lodestar:epochs:${count}`, 600, () =>
      subgraphQuery<EpochHistoryResponse>(`{
        epoches(first: ${count}, orderBy: startBlock, orderDirection: desc) {
          id
          startBlock
          endBlock
          signalledTokens
          stakeDeposited
          totalQueryFees
          totalRewards
          totalIndexerRewards
          totalDelegatorRewards
        }
      }`)
    );

    return NextResponse.json({ data }, {
      headers: {
        'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=1200',
      },
    });
  } catch (error) {
    log.api.error({ err: error }, 'Epochs error');
    return NextResponse.json({ error: 'Failed to fetch epochs' }, { status: 500 });
  }
}
