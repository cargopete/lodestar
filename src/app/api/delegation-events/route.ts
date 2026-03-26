import { NextRequest, NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { delegationEventsQuery, hasSubgraphAccess } from '@/lib/subgraph';

interface DelegationEvent {
  id: string;
  eventType: string;
  indexer: string;
  delegator: string;
  tokens: string;
  timestamp: string;
  txHash: string;
}

interface DelegationEventsResponse {
  delegationEvents: DelegationEvent[];
}

export async function GET(request: NextRequest) {
  if (!hasSubgraphAccess()) {
    return NextResponse.json({ data: { delegationEvents: [] } });
  }

  const indexer = request.nextUrl.searchParams.get('indexer')?.toLowerCase();
  const first = Math.min(parseInt(request.nextUrl.searchParams.get('first') ?? '50', 10), 100);

  try {
    const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 86400;
    const cacheKey = indexer
      ? `lodestar:delegation-events:${indexer}`
      : 'lodestar:delegation-events:all';

    const whereClause = indexer
      ? `where: { indexer: "${indexer}", timestamp_gt: "${sevenDaysAgo}" }`
      : `where: { timestamp_gt: "${sevenDaysAgo}" }`;

    const data = await cached(cacheKey, 300, () =>
      delegationEventsQuery<DelegationEventsResponse>(`{
        delegationEvents(
          first: ${first},
          orderBy: timestamp,
          orderDirection: desc,
          ${whereClause}
        ) {
          id
          eventType
          indexer
          delegator
          tokens
          timestamp
          txHash
        }
      }`)
    );

    return NextResponse.json({ data }, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch (error) {
    console.error('Delegation events error:', error);
    return NextResponse.json({ data: { delegationEvents: [] } });
  }
}
