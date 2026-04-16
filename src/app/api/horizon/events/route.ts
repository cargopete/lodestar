/**
 * GET /api/horizon/events?address=0x...&type=delegator|provider&limit=200
 *
 * Returns Horizon staking events for an address — either as delegator
 * (TokensDelegated, TokensUndelegated, DelegatedTokensWithdrawn) or as a
 * service provider (HorizonStakeDeposited, ProvisionCreated, etc.)
 *
 * Powered by the local ampd instance indexing _/arbitrum_one on-chain data.
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
} from '@/lib/amp';

// Wei → GRT (18 decimals)
const toGRT = (wei: bigint) => Number(wei) / 1e18;

interface RawLog {
  block_num: number;
  tx_hash: string;
  log_index: number;
  topic0: string;
  topic1: string;
  topic2: string;
  topic3: string | null;
  data: string;
  timestamp?: number;
}

interface DelegationEvent {
  type: 'delegated' | 'undelegated' | 'withdrawn';
  block: number;
  txHash: string;
  serviceProvider: string;
  verifier: string;
  delegator: string;
  tokensGRT: number;
  sharesGRT?: number;
}

interface StakeEvent {
  type: 'deposited' | 'locked' | 'withdrawn' | 'provision_created' | 'provision_slashed';
  block: number;
  txHash: string;
  serviceProvider: string;
  verifier?: string;
  tokensGRT: number;
}

function parseDelegationEvent(row: RawLog): DelegationEvent | null {
  const t0 = strip0x(row.topic0.toLowerCase());

  if (t0 === TOPIC0.TokensDelegated.toLowerCase()) {
    const [tokensBigInt] = parseData(row.data, 2);
    return {
      type: 'delegated',
      block: row.block_num,
      txHash: row.tx_hash,
      serviceProvider: topicToAddress(row.topic1),
      verifier: topicToAddress(row.topic2),
      delegator: topicToAddress(row.topic3 ?? ''),
      tokensGRT: toGRT(tokensBigInt),
    };
  }

  if (t0 === TOPIC0.TokensUndelegated.toLowerCase()) {
    const [tokensBigInt] = parseData(row.data, 2);
    return {
      type: 'undelegated',
      block: row.block_num,
      txHash: row.tx_hash,
      serviceProvider: topicToAddress(row.topic1),
      verifier: topicToAddress(row.topic2),
      delegator: topicToAddress(row.topic3 ?? ''),
      tokensGRT: toGRT(tokensBigInt),
    };
  }

  if (t0 === TOPIC0.DelegatedTokensWithdrawn.toLowerCase()) {
    const [tokensBigInt] = parseData(row.data, 1);
    return {
      type: 'withdrawn',
      block: row.block_num,
      txHash: row.tx_hash,
      serviceProvider: topicToAddress(row.topic1),
      verifier: topicToAddress(row.topic2),
      delegator: topicToAddress(row.topic3 ?? ''),
      tokensGRT: toGRT(tokensBigInt),
    };
  }

  return null;
}

/** Split raw data field into 32-byte chunks and parse as bigints. */
function parseData(data: string, count: number): bigint[] {
  const hex = data.startsWith('0x') ? data.slice(2) : data;
  const result: bigint[] = [];
  for (let i = 0; i < count; i++) {
    const chunk = hex.slice(i * 64, (i + 1) * 64);
    result.push(chunk ? hexToBigInt(chunk) : 0n);
  }
  return result;
}

export async function GET(request: NextRequest) {
  if (!hasAmpAccess()) {
    return NextResponse.json({ error: 'Amp not configured' }, { status: 503 });
  }

  const address = request.nextUrl.searchParams.get('address')?.toLowerCase();
  const type = request.nextUrl.searchParams.get('type') ?? 'delegator';
  const limit = Math.min(parseInt(request.nextUrl.searchParams.get('limit') ?? '200', 10), 500);

  if (!address || !/^0x[0-9a-f]{40}$/.test(address)) {
    return NextResponse.json({ error: 'Invalid address' }, { status: 400 });
  }

  if (type !== 'delegator' && type !== 'provider') {
    return NextResponse.json({ error: 'type must be delegator or provider' }, { status: 400 });
  }

  try {
    const cacheKey = `lodestar:horizon:events:${type}:${address}:${limit}`;

    const data = await cached(cacheKey, 120, async () => {
      if (type === 'delegator') {
        // topic3 = delegator address (padded to 32 bytes)
        const paddedAddress = '0x' + '0'.repeat(24) + address.slice(2);
        const topic0List = [
          TOPIC0.TokensDelegated,
          TOPIC0.TokensUndelegated,
          TOPIC0.DelegatedTokensWithdrawn,
        ]
          .map((t) => `'${strip0x(t.toLowerCase())}'`)
          .join(', ');

        const rows = await ampQuery<RawLog>(`
          SELECT
            block_num,
            tx_hash,
            log_index,
            topic0,
            topic1,
            topic2,
            topic3,
            data
          FROM ${AMP_DATASET}.logs
          WHERE address   = '${strip0x(HORIZON_STAKING)}'
            AND topic0    IN (${topic0List})
            AND topic3    = '${strip0x(paddedAddress)}'
          ORDER BY block_num DESC
          LIMIT ${limit}
        `);

        return rows
          .map(parseDelegationEvent)
          .filter((e): e is DelegationEvent => e !== null);
      }

      // provider — topic1 = serviceProvider
      const paddedAddress = '0x' + '0'.repeat(24) + address.slice(2);
      const topic0List = [
        TOPIC0.HorizonStakeDeposited,
        TOPIC0.HorizonStakeLocked,
        TOPIC0.HorizonStakeWithdrawn,
        TOPIC0.ProvisionCreated,
        TOPIC0.ProvisionSlashed,
      ]
        .map((t) => `'${t.toLowerCase()}'`)
        .join(', ');

      const rows = await ampQuery<RawLog>(`
        SELECT
          block_num,
          tx_hash,
          log_index,
          topic0,
          topic1,
          topic2,
          topic3,
          data
        FROM ${AMP_DATASET}.logs
        WHERE address = '${strip0x(HORIZON_STAKING)}'
          AND topic0  IN (${topic0List})
          AND topic1  = '${strip0x(paddedAddress)}'
        ORDER BY block_num DESC
        LIMIT ${limit}
      `);

      return rows.map((row): StakeEvent => {
        const t0 = strip0x(row.topic0.toLowerCase());
        const [tokens] = parseData(row.data, 1);
        return {
          type:
            t0 === strip0x(TOPIC0.HorizonStakeDeposited.toLowerCase()) ? 'deposited'
            : t0 === strip0x(TOPIC0.HorizonStakeLocked.toLowerCase()) ? 'locked'
            : t0 === strip0x(TOPIC0.HorizonStakeWithdrawn.toLowerCase()) ? 'withdrawn'
            : t0 === strip0x(TOPIC0.ProvisionCreated.toLowerCase()) ? 'provision_created'
            : 'provision_slashed',
          block: row.block_num,
          txHash: row.tx_hash,
          serviceProvider: topicToAddress(row.topic1),
          verifier: row.topic2 ? topicToAddress(row.topic2) : undefined,
          tokensGRT: toGRT(tokens),
        };
      });
    });

    return NextResponse.json({ data }, {
      headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=300' },
    });
  } catch (error) {
    if (error instanceof AmpError) {
      log.ingest.warn({ err: error }, 'Amp query failed for horizon events');
      return NextResponse.json({ error: 'Amp query failed', detail: error.message }, { status: 502 });
    }
    log.ingest.error({ err: error }, 'Horizon events error');
    return NextResponse.json({ error: 'Failed to fetch horizon events' }, { status: 500 });
  }
}
