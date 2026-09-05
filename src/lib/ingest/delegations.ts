import type { DbClient } from '../db';
import { getIngestionState, updateIngestionState } from '../db';
import { delegationEventsQuery } from '../subgraph';
import { weiToGRT } from '../utils';
import { nuthatchEnabled, nuthatchSql } from '../nuthatch';
import { log } from '../logger';

const DELEGATIONS_BASE_PATH = process.env.NUTHATCH_DELEGATIONS_BASE_PATH || '/alloc';
interface NestDelegationRow { id: string; event_type: string; indexer: string; delegator: string; tokens: string; timestamp: number | string }

interface SubgraphDelegationEvent {
  id: string;
  eventType: string;
  indexer: string;
  delegator: string;
  tokens: string;
  timestamp: string;
}

/**
 * Ingest delegation events from Paolo Diomede's delegation events subgraph.
 * Uses the last seen event ID as cursor for delta ingestion.
 */
export async function ingestDelegationEvents(sql: DbClient): Promise<{ ingested: number }> {
  // Off by default (nuthatch#1160). On the nest path the third-party subgraph is not consulted.
  if (nuthatchEnabled('NUTHATCH_DELEGATIONS')) {
    log.ingest.info({ step: 'delegation_events' }, 'delegation events: reading from the nest');
    return ingestDelegationEventsFromNest(sql);
  }
  const state = await getIngestionState(sql, 'delegation_events');
  // Use timestamp_gt (monotonically increasing) instead of id_gt — delegation event
  // IDs are random hashes, so lexicographic id_gt breaks once the cursor lands on a
  // high-value hash (e.g. 0xffffff...) and all newer events with lower hashes are skipped.
  const lastTimestamp = state.last_block ?? 0;

  let totalIngested = 0;
  let cursor = lastTimestamp;

  // Paginate through new events in ascending order
  while (true) {
    const result = await delegationEventsQuery<{
      delegationEvents: SubgraphDelegationEvent[];
    }>(`{
      delegationEvents(
        first: 1000
        orderBy: timestamp
        orderDirection: asc
        ${cursor ? `where: { timestamp_gt: "${cursor}" }` : ''}
      ) {
        id
        eventType
        indexer
        delegator
        tokens
        timestamp
      }
    }`);

    const events = result.delegationEvents;
    if (events.length === 0) break;

    const rows = events.map((e) => ({
      id: e.id,
      event_type: e.eventType,
      delegator: e.delegator.toLowerCase(),
      indexer: e.indexer.toLowerCase(),
      tokens_grt: weiToGRT(e.tokens),
      timestamp: new Date(parseInt(e.timestamp) * 1000).toISOString(),
    }));

    // Batch in chunks to avoid oversized queries
    const CHUNK = 200;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const batch = rows.slice(i, i + CHUNK);
      await sql`
        INSERT INTO delegation_events ${sql(batch)}
        ON CONFLICT (id) DO NOTHING
      `;
    }

    totalIngested += rows.length;
    cursor = Math.max(...events.map((e) => parseInt(e.timestamp)));

    if (events.length < 1000) break;
  }

  // Always update updated_at so health checks can distinguish "running idle" from "stuck".
  await updateIngestionState(
    sql,
    'delegation_events',
    totalIngested > 0 ? { last_block: cursor } : {},
  );

  return { ingested: totalIngested };
}

/**
 * The same rows from `lodestar_delegations` (graph-allocations-nest, both staking eras), same cursor
 * on the timestamp, same insert. The nest's ids are `txHash-logIndex` rather than the third-party
 * subgraph's hashes, so the two sources never collide on `id` and a switch leaves history in place.
 * The event vocabulary is the same one (`delegation`, `undelegation`, `withdrawal`) by construction
 * of the view.
 */
async function ingestDelegationEventsFromNest(sql: DbClient): Promise<{ ingested: number }> {
  const state = await getIngestionState(sql, 'delegation_events');
  let cursor = state.last_block ?? 0;
  let totalIngested = 0;
  while (true) {
    const events = await nuthatchSql<NestDelegationRow>(
      `SELECT id, event_type, indexer, delegator, CAST(tokens AS VARCHAR) AS tokens, timestamp FROM lodestar_delegations ` +
      `WHERE timestamp > ${Math.floor(cursor)} ORDER BY timestamp ASC, id ASC LIMIT 1000`,
      DELEGATIONS_BASE_PATH,
    );
    if (events.length === 0) break;
    const rows = events.map((e) => ({
      id: e.id,
      event_type: e.event_type,
      delegator: e.delegator.toLowerCase(),
      indexer: e.indexer.toLowerCase(),
      tokens_grt: weiToGRT(e.tokens),
      timestamp: new Date(Number(e.timestamp) * 1000).toISOString(),
    }));
    const CHUNK = 200;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const batch = rows.slice(i, i + CHUNK);
      await sql`
        INSERT INTO delegation_events ${sql(batch)}
        ON CONFLICT (id) DO NOTHING
      `;
    }
    totalIngested += rows.length;
    // A page that ends mid-second would drop that second's remaining events on the next page; the
    // cursor is therefore the last *complete* second in a full page, and the whole second otherwise.
    const last = Number(events[events.length - 1].timestamp);
    cursor = events.length < 1000 ? last : Math.max(cursor + 1, last - 1);
    if (events.length < 1000) break;
  }
  await updateIngestionState(sql, 'delegation_events', totalIngested > 0 ? { last_block: cursor } : {});
  return { ingested: totalIngested };
}
