/**
 * GET /api/horizon/slashing?limit=50&address=0x...
 *
 * Returns recent slashing events (ProvisionSlashed + DelegationSlashed).
 * Optional address filter narrows to a specific service provider.
 */

import { NextRequest, NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { log } from '@/lib/logger';
import {
  ampQuery,
  hasAmpAccess,
  AmpError,
  HORIZON_STAKING,
  TOPIC0,
  AMP_DATASET,
  topicToAddress,
  hexToBigInt,
  strip0x,
  hexLit,
} from '@/lib/amp';

const toGRT = (hex: string) => Number(hexToBigInt(hex)) / 1e18;

interface SlashEvent {
  type: 'provision' | 'delegation';
  block: number;
  txHash: string;
  serviceProvider: string;
  verifier: string;
  tokensGRT: number;
}

interface RawLog {
  block_num: number;
  tx_hash: string;
  topic0: string;
  topic1: string;
  topic2: string;
  data: string;
}

export async function GET(request: NextRequest) {
  if (!hasAmpAccess()) {
    return NextResponse.json({ error: 'Amp not configured' }, { status: 503 });
  }

  const address = request.nextUrl.searchParams.get('address')?.toLowerCase();
  const limit = Math.min(parseInt(request.nextUrl.searchParams.get('limit') ?? '50', 10), 200);

  if (address && !/^0x[0-9a-f]{40}$/.test(address)) {
    return NextResponse.json({ error: 'Invalid address' }, { status: 400 });
  }

  const addressFilter = address
    ? `AND topic1 = ${hexLit('0'.repeat(24) + address.slice(2))}`
    : '';

  const cacheKey = `lodestar:horizon:slashing:${address ?? 'all'}:${limit}`;

  try {
    const data = await cached(cacheKey, 300, async () => {
      const topic0List = [TOPIC0.ProvisionSlashed, TOPIC0.DelegationSlashed]
        .map((t) => hexLit(t))
        .join(', ');

      const rows = await ampQuery<RawLog>(`
        SELECT
          block_num,
          tx_hash,
          topic0,
          topic1,
          topic2,
          data
        FROM ${AMP_DATASET}.logs
        WHERE address = ${hexLit(HORIZON_STAKING)}
          AND topic0  IN (${topic0List})
          ${addressFilter}
        ORDER BY block_num DESC
        LIMIT ${limit}
      `);

      return rows.map((row): SlashEvent => ({
        type: row.topic0.toLowerCase() === strip0x(TOPIC0.ProvisionSlashed)
          ? 'provision'
          : 'delegation',
        block: row.block_num,
        txHash: row.tx_hash,
        serviceProvider: topicToAddress(row.topic1),
        verifier: topicToAddress(row.topic2),
        tokensGRT: toGRT(row.data.slice(0, 66)),
      }));
    });

    return NextResponse.json({ data }, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
    });
  } catch (error) {
    if (error instanceof AmpError) {
      log.ingest.warn({ err: error }, 'Amp query failed for slashing');
      return NextResponse.json({ error: 'Amp query failed', detail: error.message }, { status: 502 });
    }
    log.ingest.error({ err: error }, 'Slashing events error');
    return NextResponse.json({ error: 'Failed to fetch slashing events' }, { status: 500 });
  }
}
