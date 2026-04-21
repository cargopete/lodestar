import { NextRequest, NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { delegationEventsQuery, hasSubgraphAccess } from '@/lib/subgraph';
import { log } from '@/lib/logger';

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

const ETH_ADDRESS_RE = /^0x[0-9a-f]{40}$/;

export async function GET(request: NextRequest) {
  if (!hasSubgraphAccess()) {
    return NextResponse.json({ data: { delegationEvents: [] } });
  }

  const indexerRaw = request.nextUrl.searchParams.get('indexer')?.toLowerCase();
  const indexer = indexerRaw && ETH_ADDRESS_RE.test(indexerRaw) ? indexerRaw : null;
  const first = Math.min(Math.max(parseInt(request.nextUrl.searchParams.get('first') ?? '50', 10) || 50, 1), 100);

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
    log.api.error({ err: error }, 'Delegation events error');
    return NextResponse.json({ data: { delegationEvents: [] } });
  }
}
