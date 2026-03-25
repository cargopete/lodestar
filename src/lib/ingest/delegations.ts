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
export async function ingestDelegationEvents(db: DbClient): Promise<{ ingested: number }> {
  const state = await getIngestionState(db, 'delegation_events');
  const lastId = state.last_id ?? '';

  let totalIngested = 0;
  let cursor = lastId;

  // Paginate through new events in ascending order
  while (true) {
    const result = await delegationEventsQuery<{
      delegationEvents: SubgraphDelegationEvent[];
    }>(`{
      delegationEvents(
        first: 1000
        orderBy: id
        orderDirection: asc
        ${cursor ? `where: { id_gt: "${cursor}" }` : ''}
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

    // Upsert in smaller chunks to avoid Supabase statement timeout
    const CHUNK = 200;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error } = await db
        .from('delegation_events')
        .upsert(rows.slice(i, i + CHUNK), { onConflict: 'id' });
      if (error) throw new Error(`Delegation event upsert failed: ${error.message}`);
    }

    totalIngested += rows.length;
    cursor = events[events.length - 1].id;

    if (events.length < 1000) break;
  }

  if (totalIngested > 0) {
    await updateIngestionState(db, 'delegation_events', { last_id: cursor });
  }

  return { ingested: totalIngested };
}
