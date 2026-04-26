import { NextRequest, NextResponse } from 'next/server';
import { cacheSet } from '@/lib/cache';
import { hasAmpAccess, ampQuery, HORIZON_STAKING, TOPIC0, AMP_DATASET, topicToAddress, hexToBigInt, hexLit, strip0x } from '@/lib/amp';
import { log } from '@/lib/logger';
import type { ActivityEvent } from '@/app/api/horizon/activity/route';

export const maxDuration = 120;

const CACHE_KEY = 'horizon:activity:25';
const CACHE_TTL = 300; // 5 min — cron runs every 2 min so always fresh

function isAuthorized(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  return request.headers.get('authorization') === `Bearer ${cronSecret}`;
}

const toGRT = (hex: string) => {
  const clean = hex.startsWith('0x') ? hex : '0x' + hex;
  return Number(hexToBigInt(clean)) / 1e18;
};

function decodeTokens(data: string, chunkIndex = 0): number {
  const hex = data.startsWith('0x') ? data.slice(2) : data;
  const chunk = hex.slice(chunkIndex * 64, (chunkIndex + 1) * 64);
  return chunk ? toGRT(chunk) : 0;
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

function mapRow(row: RawLog): ActivityEvent | null {
  const t0 = strip0x(row.topic0).toLowerCase();
  const base = { block: row.block_num, txHash: row.tx_hash, id: `${row.tx_hash}-${row.log_index}` };

  if (t0 === strip0x(TOPIC0.TokensDelegated))
    return { ...base, type: 'delegated', serviceProvider: topicToAddress(row.topic1), verifier: row.topic2 ? topicToAddress(row.topic2) : undefined, delegator: row.topic3 ? topicToAddress(row.topic3) : undefined, tokensGRT: decodeTokens(row.data, 0) };
  if (t0 === strip0x(TOPIC0.TokensUndelegated))
    return { ...base, type: 'undelegated', serviceProvider: topicToAddress(row.topic1), verifier: row.topic2 ? topicToAddress(row.topic2) : undefined, delegator: row.topic3 ? topicToAddress(row.topic3) : undefined, tokensGRT: decodeTokens(row.data, 0) };
  if (t0 === strip0x(TOPIC0.DelegatedTokensWithdrawn))
    return { ...base, type: 'withdrawn', serviceProvider: topicToAddress(row.topic1), verifier: row.topic2 ? topicToAddress(row.topic2) : undefined, delegator: row.topic3 ? topicToAddress(row.topic3) : undefined, tokensGRT: decodeTokens(row.data, 0) };
  if (t0 === strip0x(TOPIC0.DelegationSlashed))
    return { ...base, type: 'delegation_slash', serviceProvider: topicToAddress(row.topic1), verifier: row.topic2 ? topicToAddress(row.topic2) : undefined, tokensGRT: decodeTokens(row.data, 0) };
  if (t0 === strip0x(TOPIC0.HorizonStakeDeposited))
    return { ...base, type: 'stake_deposit', serviceProvider: topicToAddress(row.topic1), tokensGRT: decodeTokens(row.data, 0) };
  if (t0 === strip0x(TOPIC0.HorizonStakeLocked))
    return { ...base, type: 'stake_lock', serviceProvider: topicToAddress(row.topic1), tokensGRT: decodeTokens(row.data, 0) };
  if (t0 === strip0x(TOPIC0.HorizonStakeWithdrawn))
    return { ...base, type: 'stake_withdraw', serviceProvider: topicToAddress(row.topic1), tokensGRT: decodeTokens(row.data, 0) };
  if (t0 === strip0x(TOPIC0.ProvisionCreated))
    return { ...base, type: 'provision', serviceProvider: topicToAddress(row.topic1), verifier: row.topic2 ? topicToAddress(row.topic2) : undefined, tokensGRT: decodeTokens(row.data, 0) };
  if (t0 === strip0x(TOPIC0.ProvisionSlashed))
    return { ...base, type: 'provision_slash', serviceProvider: topicToAddress(row.topic1), verifier: row.topic2 ? topicToAddress(row.topic2) : undefined, tokensGRT: decodeTokens(row.data, 0) };
  return null;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!hasAmpAccess()) {
    return NextResponse.json({ error: 'Amp not configured' }, { status: 503 });
  }

  const t0 = Date.now();
  const topic0List = ALL_TOPICS.map((t) => hexLit(t)).join(', ');

  // ~500k blocks ≈ 5 days on Arbitrum — keeps the scan small and fast
  const rows = await ampQuery<RawLog>(`
    SELECT block_num, tx_hash, log_index, topic0, topic1, topic2, topic3, data
    FROM ${AMP_DATASET}.logs
    WHERE address = ${hexLit(HORIZON_STAKING)}
      AND topic0 IN (${topic0List})
      AND block_num > (SELECT MAX(block_num) - 500000 FROM ${AMP_DATASET}.logs)
    ORDER BY block_num DESC
    LIMIT 25
  `, 30_000);

  const events = rows.map(mapRow).filter((e): e is ActivityEvent => e !== null);
  await cacheSet(CACHE_KEY, events, CACHE_TTL);

  const durationMs = Date.now() - t0;
  log.cron.info({ step: 'horizon-activity', count: events.length, durationMs }, 'Horizon activity cached');
  return NextResponse.json({ ok: true, count: events.length, durationMs });
}
