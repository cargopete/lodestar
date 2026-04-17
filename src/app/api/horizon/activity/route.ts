/**
 * GET /api/horizon/activity?limit=100
 *
 * Returns the most recent Horizon staking events across all participants —
 * no address filter. Used for the live activity feed.
 */

import { NextRequest, NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { log } from '@/lib/logger';

export const maxDuration = 300;
import {
  ampQuery,
  hasAmpAccess,
  AmpError,
  HORIZON_STAKING,
  TOPIC0,
  AMP_DATASET,
  topicToAddress,
  hexToBigInt,
  hexLit,
  strip0x,
} from '@/lib/amp';

const toGRT = (hex: string) => {
  const clean = hex.startsWith('0x') ? hex : '0x' + hex;
  return Number(hexToBigInt(clean)) / 1e18;
};

export interface ActivityEvent {
  id: string;
  type:
    | 'delegated'
    | 'undelegated'
    | 'withdrawn'
    | 'delegation_slash'
    | 'stake_deposit'
    | 'stake_lock'
    | 'stake_withdraw'
    | 'provision'
    | 'provision_slash';
  block: number;
  txHash: string;
  serviceProvider: string;
  verifier?: string;
  delegator?: string;
  tokensGRT: number;
}

interface RawLog {
  block_num: number;
  tx_hash: string;
  log_index: number;
  topic0: string;
  topic1: string;
  topic2: string | null;
  topic3: string | null;
  data: string;
}

const ALL_TOPICS = [
  TOPIC0.TokensDelegated,
  TOPIC0.TokensUndelegated,
  TOPIC0.DelegatedTokensWithdrawn,
  TOPIC0.DelegationSlashed,
  TOPIC0.HorizonStakeDeposited,
  TOPIC0.HorizonStakeLocked,
  TOPIC0.HorizonStakeWithdrawn,
  TOPIC0.ProvisionCreated,
  TOPIC0.ProvisionSlashed,
];

function decodeTokens(data: string, chunkIndex = 0): number {
  const hex = data.startsWith('0x') ? data.slice(2) : data;
  const chunk = hex.slice(chunkIndex * 64, (chunkIndex + 1) * 64);
  return chunk ? toGRT(chunk) : 0;
}

function mapRow(row: RawLog): ActivityEvent | null {
  const t0 = strip0x(row.topic0).toLowerCase();
  const base = { block: row.block_num, txHash: row.tx_hash, id: `${row.tx_hash}-${row.log_index}` };

  if (t0 === strip0x(TOPIC0.TokensDelegated)) {
    return { ...base, type: 'delegated', serviceProvider: topicToAddress(row.topic1), verifier: row.topic2 ? topicToAddress(row.topic2) : undefined, delegator: row.topic3 ? topicToAddress(row.topic3) : undefined, tokensGRT: decodeTokens(row.data, 0) };
  }
  if (t0 === strip0x(TOPIC0.TokensUndelegated)) {
    return { ...base, type: 'undelegated', serviceProvider: topicToAddress(row.topic1), verifier: row.topic2 ? topicToAddress(row.topic2) : undefined, delegator: row.topic3 ? topicToAddress(row.topic3) : undefined, tokensGRT: decodeTokens(row.data, 0) };
  }
  if (t0 === strip0x(TOPIC0.DelegatedTokensWithdrawn)) {
    return { ...base, type: 'withdrawn', serviceProvider: topicToAddress(row.topic1), verifier: row.topic2 ? topicToAddress(row.topic2) : undefined, delegator: row.topic3 ? topicToAddress(row.topic3) : undefined, tokensGRT: decodeTokens(row.data, 0) };
  }
  if (t0 === strip0x(TOPIC0.DelegationSlashed)) {
    return { ...base, type: 'delegation_slash', serviceProvider: topicToAddress(row.topic1), verifier: row.topic2 ? topicToAddress(row.topic2) : undefined, tokensGRT: decodeTokens(row.data, 0) };
  }
  if (t0 === strip0x(TOPIC0.HorizonStakeDeposited)) {
    return { ...base, type: 'stake_deposit', serviceProvider: topicToAddress(row.topic1), tokensGRT: decodeTokens(row.data, 0) };
  }
  if (t0 === strip0x(TOPIC0.HorizonStakeLocked)) {
    return { ...base, type: 'stake_lock', serviceProvider: topicToAddress(row.topic1), tokensGRT: decodeTokens(row.data, 0) };
  }
  if (t0 === strip0x(TOPIC0.HorizonStakeWithdrawn)) {
    return { ...base, type: 'stake_withdraw', serviceProvider: topicToAddress(row.topic1), tokensGRT: decodeTokens(row.data, 0) };
  }
  if (t0 === strip0x(TOPIC0.ProvisionCreated)) {
    return { ...base, type: 'provision', serviceProvider: topicToAddress(row.topic1), verifier: row.topic2 ? topicToAddress(row.topic2) : undefined, tokensGRT: decodeTokens(row.data, 0) };
  }
  if (t0 === strip0x(TOPIC0.ProvisionSlashed)) {
    return { ...base, type: 'provision_slash', serviceProvider: topicToAddress(row.topic1), verifier: row.topic2 ? topicToAddress(row.topic2) : undefined, tokensGRT: decodeTokens(row.data, 0) };
  }
  return null;
}

export async function GET(request: NextRequest) {
  if (!hasAmpAccess()) {
    return NextResponse.json({ error: 'Amp not configured' }, { status: 503 });
  }

  const limit = Math.min(parseInt(request.nextUrl.searchParams.get('limit') ?? '25', 10), 200);

  try {
    const topic0List = ALL_TOPICS.map((t) => hexLit(t)).join(', ');

    const data = await cached(`horizon:activity:${limit}`, 60, async () => {
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
        WHERE address = ${hexLit(HORIZON_STAKING)}
          AND topic0 IN (${topic0List})
        ORDER BY block_num DESC
        LIMIT ${limit}
      `, 250_000);
      return rows.map(mapRow).filter((e): e is ActivityEvent => e !== null);
    });

    return NextResponse.json({ data }, {
      headers: { 'Cache-Control': 'public, s-maxage=25, stale-while-revalidate=60' },
    });
  } catch (error) {
    if (error instanceof AmpError) {
      log.ingest.warn({ err: error }, 'Amp query failed for horizon activity');
      return NextResponse.json({ error: 'Amp query failed', detail: error.message }, { status: 502 });
    }
    if (error instanceof Error && error.name === 'TimeoutError') {
      log.ingest.warn({ err: error }, 'Amp query timed out for horizon activity');
      return NextResponse.json({ error: 'Amp query timed out' }, { status: 504 });
    }
    log.ingest.error({ err: error }, 'Horizon activity error');
    const cause = error instanceof Error ? String((error as NodeJS.ErrnoException).cause) : undefined;
    return NextResponse.json({ error: 'Failed to fetch horizon activity', detail: String(error), cause }, { status: 500 });
  }
}
