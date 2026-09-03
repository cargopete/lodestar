import { NextRequest, NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { hasNuthatch, nuthatchSqlReady } from '@/lib/nuthatch';
import { delegationEventsSql } from '@/lib/nest-queries';
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

const ETH_ADDRESS_RE = /^0x[0-9a-f]{40}$/;

export async function GET(request: NextRequest) {
  if (!hasNuthatch()) {
    return NextResponse.json({ error: 'Nuthatch is not configured' }, { status: 503 });
  }

  const indexerRaw = request.nextUrl.searchParams.get('indexer')?.toLowerCase();
  const indexer = indexerRaw && ETH_ADDRESS_RE.test(indexerRaw) ? indexerRaw : null;
  const first = Math.min(Math.max(parseInt(request.nextUrl.searchParams.get('first') ?? '50', 10) || 50, 1), 100);

  try {
    const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 86400;
    const cacheKey = indexer
      ? `lodestar:delegation-events:${indexer}`
      : 'lodestar:delegation-events:all';

    const payload = await cached(`${cacheKey}:nuthatch:v4`, 300, async () => {
      const result = await nuthatchSqlReady<DelegationEvent>(
        delegationEventsSql(indexer, first, sevenDaysAgo),
      );
      if (!result.ok) {
        return { error: result.error, reason: result.reason, status: result.status };
      }
      return {
        data: { delegationEvents: result.data.rows, source: 'nuthatch' as const },
        provenance: result.data.provenance ?? null,
      };
    });

    if ('error' in payload && payload.error) {
      return NextResponse.json(
        { error: payload.error, reason: payload.reason },
        { status: payload.status ?? 503 },
      );
    }

    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch (error) {
    log.api.error({ err: error }, 'Nuthatch delegation events error');
    return NextResponse.json({ error: 'Failed to load delegation events from Nuthatch' }, { status: 503 });
  }
}
