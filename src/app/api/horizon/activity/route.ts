/**
 * GET /api/horizon/activity
 *
 * Serves the 25 most recent Horizon staking events from Redis.
 * Data is pre-computed every 2 minutes by /api/cron/ingest-horizon-activity.
 */

import { NextResponse } from 'next/server';
import { cacheGet } from '@/lib/cache';

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

const CACHE_KEY = 'horizon:activity:25';

export async function GET() {
  const data = await cacheGet<ActivityEvent[]>(CACHE_KEY);

  if (!data) {
    return NextResponse.json({ error: 'Amp node unreachable' }, { status: 503 });
  }

  return NextResponse.json({ data }, {
    headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' },
  });
}
