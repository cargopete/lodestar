import { NextRequest, NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { hasNuthatch, nuthatchSqlReady } from '@/lib/nuthatch';
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

/**
 * Reconstruct the community subgraph's `delegationEvents` feed from the `graph-staking-nest`
 * (RFC-0011 pilot): a UNION over the four HorizonStaking delegation-event tables, mapping each to the
 * subgraph's `eventType` vocabulary (TokensDelegated→"delegation", TokensUndelegated→"undelegation",
 * {DelegatedTokensWithdrawn, StakeDelegatedWithdrawn}→"withdrawal"). Same columns, same order, same
 * filters — a drop-in for the gateway query. `indexer`/`first`/`since` are pre-validated by the caller
 * (address regex, clamped int), so no injection surface reaches the SQL.
 */
function delegationEventsSql(indexer: string | null, first: number, since: number): string {
  const row = (evType: string, table: string, indexerCol: string) =>
    `SELECT tx_hash || '-' || CAST(log_index AS VARCHAR) AS id, '${evType}' AS "eventType", ` +
    `LOWER(${indexerCol}) AS indexer, LOWER(delegator) AS delegator, CAST(tokens AS VARCHAR) AS tokens, ` +
    `block_timestamp AS ts, tx_hash AS "txHash" FROM "${table}"`;
  const union = [
    row('delegation', 'staking__tokens_delegated', '"serviceProvider"'),
    row('undelegation', 'staking__tokens_undelegated', '"serviceProvider"'),
    row('withdrawal', 'staking__delegated_tokens_withdrawn', '"serviceProvider"'),
    row('withdrawal', 'staking__stake_delegated_withdrawn', 'indexer'),
  ].join(' UNION ALL ');
  const where = [`ts > ${since}`, indexer ? `indexer = '${indexer}'` : null]
    .filter(Boolean)
    .join(' AND ');
  return (
    `SELECT id, "eventType", indexer, delegator, tokens, CAST(ts AS VARCHAR) AS "timestamp", "txHash" ` +
    `FROM (${union}) t WHERE ${where} ORDER BY ts DESC LIMIT ${first}`
  );
}

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
