import type { DbClient } from '../db';
import { getIngestionState, updateIngestionState } from '../db';
import { weiToGRT } from '../utils';
import { nuthatchSql } from '../nuthatch';
import { log } from '../logger';

const DELEGATIONS_BASE_PATH = process.env.NUTHATCH_DELEGATIONS_BASE_PATH || '/alloc';
interface NestDelegationRow { id: string; event_type: string; indexer: string; delegator: string; tokens: string; timestamp: number | string }

/**
 * Ingest delegation events into Postgres from `lodestar_delegations` on the nest (nuthatch#1160).
 * The third-party subgraph this once fell back to left with the key.
 */
export async function ingestDelegationEvents(sql: DbClient): Promise<{ ingested: number }> {
  log.ingest.info({ step: 'delegation_events' }, 'delegation events: reading from the nest');
  return ingestDelegationEventsFromNest(sql);
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
