import { NextRequest, NextResponse } from 'next/server';
import { cacheSet } from '@/lib/cache';
import { subgraphQuery, delegationEventsQuery, hasSubgraphAccess } from '@/lib/subgraph';
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

interface ProvisionRaw {
  id: string;
  tokensProvisioned: string;
  createdAt: string;
  dataService: { id: string };
  indexer: { id: string };
}

function mapDelegationType(eventType: string): ActivityEvent['type'] {
  if (eventType === 'undelegation') return 'undelegated';
  if (eventType === 'withdrawal') return 'withdrawn';
  return 'delegated';
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!hasSubgraphAccess()) {
    return NextResponse.json({ error: 'Subgraph not configured' }, { status: 503 });
  }

  const t0 = Date.now();

  const [delegationResult, provisionResult] = await Promise.all([
    delegationEventsQuery<{ delegationEvents: DelegationEventRaw[] }>(`{
      delegationEvents(
        first: 20
        orderBy: timestamp
        orderDirection: desc
      ) {
        id
        eventType
        indexer
        delegator
        tokens
        timestamp
        txHash
      }
    }`),
    subgraphQuery<{ provisions: ProvisionRaw[] }>(`{
      provisions(
        first: 10
        orderBy: createdAt
        orderDirection: desc
      ) {
        id
        tokensProvisioned
        createdAt
        dataService { id }
        indexer { id }
      }
    }`),
  ]);

  const delegationEvents: ActivityEvent[] = delegationResult.delegationEvents.map((e) => ({
    id: `d-${e.id}`,
    type: mapDelegationType(e.eventType),
    block: 0,
    txHash: e.txHash,
    timestamp: parseInt(e.timestamp),
    serviceProvider: e.indexer.toLowerCase(),
    delegator: e.delegator.toLowerCase(),
    tokensGRT: toGRT(e.tokens),
  }));

  const provisionEvents: ActivityEvent[] = provisionResult.provisions.map((p) => ({
    id: `p-${p.id}`,
    type: 'provision' as const,
    block: 0,
    txHash: '',
    timestamp: parseInt(p.createdAt),
    serviceProvider: p.indexer.id.toLowerCase(),
    verifier: p.dataService.id.toLowerCase(),
    tokensGRT: toGRT(p.tokensProvisioned),
  }));

  const events = [...delegationEvents, ...provisionEvents]
    .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
    .slice(0, 25);

  await cacheSet(CACHE_KEY, events, CACHE_TTL);

  const durationMs = Date.now() - t0;
  log.cron.info({ step: 'horizon-activity', count: events.length, durationMs }, 'Horizon activity cached');
  return NextResponse.json({ ok: true, count: events.length, durationMs });
}
