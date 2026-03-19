import { NextRequest, NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { subgraphQuery, hasSubgraphAccess } from '@/lib/subgraph';
import type { EpochHistoryResponse } from '@/lib/queries';

export async function GET(request: NextRequest) {
  const count = Math.min(
    Number(request.nextUrl.searchParams.get('count') ?? 30),
    100
  );

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
    console.error('Epochs error:', error);
    return NextResponse.json({ error: 'Failed to fetch epochs' }, { status: 500 });
  }
}
