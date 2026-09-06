import { NextRequest, NextResponse } from 'next/server';
import { cacheSet } from '@/lib/cache';
import { hasNuthatch, nuthatchSqlReady } from '@/lib/nuthatch';
import { delegationEventsSql, newestProvisionsSql } from '@/lib/nest-queries';
import { log } from '@/lib/logger';
import type { ActivityEvent } from '@/app/api/horizon/activity/route';

export const maxDuration = 30;

const CACHE_KEY = 'horizon:activity:25';
const CACHE_TTL = 300; // 5 min — cron runs every 2 min so always fresh

function isAuthorized(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  return request.headers.get('authorization') === `Bearer ${cronSecret}`;
}

const toGRT = (wei: string) => Number(BigInt(wei)) / 1e18;

interface DelegationEventRaw {
  id: string;
  eventType: string;
  indexer: string;
  delegator: string;
  tokens: string;
  timestamp: string;
  txHash: string;
}

function mapDelegationType(eventType: string): ActivityEvent['type'] {
  if (eventType === 'undelegation') return 'undelegated';
  if (eventType === 'withdrawal') return 'withdrawn';
  return 'delegated';
}

/**
 * The nests carrying `ProvisionCreated` and the delegation events. Both live on graph-allocations-nest
 * behind `/alloc` since the separate horizon and staking nests retired (2026-09-06); the knobs stay
 * for an operator who splits them again.
 */
const HORIZON_BASE_PATH = process.env.NUTHATCH_HORIZON_BASE_PATH || '/alloc';
const DELEGATIONS_BASE_PATH = process.env.NUTHATCH_DELEGATIONS_BASE_PATH || '/alloc';

interface NestProvision {
  tx_hash: string;
  log_index: number;
  block_number: number;
  block_timestamp: number;
  indexer: string;
  verifier: string;
  tokens: string;
}

/**
 * The same feed from two nests (nightswatchhq/nuthatch#1078): the twenty newest delegation events
 * from `graph-staking-nest`, which already serves `/api/delegation-events` with this exact SQL, and
 * the ten newest provisions from the horizon nest. Both are Horizon-era by definition, which is what
 * the feed shows. A nest that is not ready refuses the run rather than caching a stale page.
 *
 * Two things the gateway path could not give the feed: a provision's transaction hash (it wrote an
 * empty string, so the card had no explorer link) and its block.
 */
async function activityFromNests(): Promise<ActivityEvent[]> {
  const [delegations, provisions] = await Promise.all([
    nuthatchSqlReady<DelegationEventRaw>(delegationEventsSql(null, 20, 0), DELEGATIONS_BASE_PATH),
    nuthatchSqlReady<NestProvision>(newestProvisionsSql(10), HORIZON_BASE_PATH),
  ]);
  if (!delegations.ok) {
    throw Object.assign(new Error(`delegation events: ${delegations.error}`), { nest: delegations });
  }
  if (!provisions.ok) {
    throw Object.assign(new Error(`provisions: ${provisions.error}`), { nest: provisions });
  }

  const delegationEvents: ActivityEvent[] = delegations.data.rows.map((e) => ({
    id: `d-${e.id}`,
    type: mapDelegationType(e.eventType),
    block: 0,
    txHash: e.txHash,
    timestamp: parseInt(e.timestamp),
    serviceProvider: e.indexer.toLowerCase(),
    delegator: e.delegator.toLowerCase(),
    tokensGRT: toGRT(e.tokens),
  }));

  const provisionEvents: ActivityEvent[] = provisions.data.rows.map((p) => ({
    id: `p-${p.tx_hash}-${p.log_index}`,
    type: 'provision' as const,
    block: p.block_number,
    txHash: p.tx_hash,
    timestamp: p.block_timestamp,
    serviceProvider: p.indexer.toLowerCase(),
    verifier: p.verifier.toLowerCase(),
    tokensGRT: toGRT(p.tokens),
  }));

  return [...delegationEvents, ...provisionEvents]
    .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
    .slice(0, 25);
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const t0 = Date.now();

  // From the nests, always (nuthatch#1160). The gateway path this once fell back to left with the key.
  if (!hasNuthatch()) {
    return NextResponse.json({ error: 'Nuthatch is not configured' }, { status: 503 });
  }
  try {
    const events = await activityFromNests();
    await cacheSet(CACHE_KEY, events, CACHE_TTL);
    const durationMs = Date.now() - t0;
    log.cron.info({ step: 'horizon-activity', count: events.length, durationMs, source: 'nuthatch' }, 'Horizon activity cached');
    return NextResponse.json({ ok: true, count: events.length, durationMs, source: 'nuthatch' });
  } catch (error) {
    log.cron.error({ err: error, step: 'horizon-activity' }, 'Horizon activity from the nests failed');
    return NextResponse.json({ error: 'Horizon activity from the nests failed' }, { status: 503 });
  }
}
