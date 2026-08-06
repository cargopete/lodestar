import { NextRequest, NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { delegationEventsQuery, hasSubgraphAccess } from '@/lib/subgraph';
import { nuthatchEnabled, nuthatchSql } from '@/lib/nuthatch';
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

    // RFC-0011 pilot: when the flag is on, serve this feed from our own nuthatch nest instead of the
    // community subgraph. Falls back to the gateway on any error, so the panel never goes dark.
    if (nuthatchEnabled('NUTHATCH_DELEGATION_EVENTS')) {
      try {
        const data = await cached(`${cacheKey}:nuthatch:v2`, 300, async () => {
          const rows = await nuthatchSql<DelegationEvent>(
            delegationEventsSql(indexer, first, sevenDaysAgo)
          );
          // `source` lives inside `data` (not as a sibling) to match /api/developer-activity's shape.
          return { delegationEvents: rows, source: 'nuthatch' as const };
        });
        return NextResponse.json(
          { data },
          { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } }
        );
      } catch (err) {
        log.api.error({ err }, 'nuthatch delegation events failed, falling back to subgraph');
      }
    }

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
