import type { DbClient } from '../db';
import { getIngestionState, updateIngestionState } from '../db';
import { delegationEventsQuery } from '../subgraph';
import { weiToGRT } from '../utils';

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
