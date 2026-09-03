import type { DbClient } from '../db';
import { getIngestionState, updateIngestionState } from '../db';
import { subgraphQuery } from '../subgraph';
import { nuthatchEnabled, nuthatchSqlReady } from '../nuthatch';
import { log } from '../logger';

interface SubgraphDispute {
  id: string;
  type: string;
  indexer: { id: string };
  fisherman: { id: string };
  allocation: { id: string } | null;
  subgraphDeployment: { id: string };
  status: string;
  tokensSlashed: string;
  tokensBurned: string;
  createdAt: number;
  closedAt: number;
}

/** The nest carrying the Lodestar views. `/alloc` reverse-proxies to graph-allocations-nest. */
const NEST_BASE_PATH = process.env.NUTHATCH_DISPUTES_BASE_PATH || '/alloc';

/** A dispute as `lodestar_disputes` reports it, with the deployment joined in from allocations. */
interface NestDispute {
  id: string;
  kind: string | null;
  indexer: string;
  fisherman: string;
  allocation_id: string | null;
  subgraph_deployment: string | null;
  status: string | null;
  created_at: number | null;
  resolved_at: number | null;
}

/**
 * `lodestar_disputes` calls a drawn dispute `Drawn`; the subgraph calls it `Draw`. Everything else
 * matches once lowercased. Mapping rather than passing through, so a migrated row is byte-identical
 * to the one the gateway produced and `DisputesSection` does not have to learn a second vocabulary.
 */
function nestStatus(status: string | null): string | null {
  if (!status) return null;
  const s = status.toLowerCase();
  return s === 'drawn' ? 'draw' : s;
}

/**
 * Disputes from the nest (nightswatchhq/nuthatch#1078).
 *
 * **Parity is exact and was measured, not assumed.** At a pinned block the nest and the subgraph hold
 * the same 8 live disputes, ids identical in both directions, and all eight comparable fields agree
 * across all eight rows: type, indexer, fisherman, allocation, deployment, status, createdAt,
 * closedAt. `subgraphDeployment.id` is not a column on `lodestar_disputes` and is joined in from
 * `lodestar_allocations`, which resolves for 8 of 8.
 *
 * **The two token fields are the whole caveat, and this refuses rather than guesses.** A dispute only
 * slashes when it is *accepted*, and no dispute ever has been: all eight are `Drawn` with
 * `tokensSlashed` and `tokensBurned` at zero on **both** sides. So emitting zero is exactly correct
 * today. It would stop being correct the moment a dispute is accepted, and the nest cannot compute
 * the burn until `StakeSlashed` is indexed (nuthatch#1125), so an accepted dispute **fails the run**
 * rather than being written as a silent zero. Under-reporting a slash to a panel that renders it is
 * precisely the absence-reads-as-agreement failure this migration exists to avoid.
 *
 * `lodestar_disputes.resolution_tokens` is deliberately **not** mapped to `tokens_slashed_grt`: for a
 * drawn dispute it is the deposit returned, and it reads 10,000 GRT where the subgraph correctly
 * reports a slash of zero.
 */
async function ingestDisputesFromNest(
  sql: DbClient,
): Promise<{ ingested: number }> {
  const result = await nuthatchSqlReady<NestDispute>(
    `SELECT d.id, d.kind, d.indexer, d.fisherman, d.allocation_id,
            a.subgraph_deployment, d.status, d.created_at, d.resolved_at
     FROM lodestar_disputes d
     LEFT JOIN lodestar_allocations a ON a.id = d.allocation_id
     ORDER BY d.created_at`,
    NEST_BASE_PATH,
  );
  if (!result.ok) {
    throw Object.assign(new Error(result.error), { nest: result });
  }

  const disputes = result.data.rows;

  const accepted = disputes.filter(
    (d) => (d.status ?? '').toLowerCase() === 'accepted',
  );
  if (accepted.length > 0) {
    throw new Error(
      `${accepted.length} accepted dispute(s) in the nest (${accepted
        .map((d) => d.id)
        .join(', ')}), and an accepted dispute slashes. The nest cannot compute ` +
        'tokens_burned_grt until StakeSlashed is indexed (nuthatch#1125), and writing zero would ' +
        'under-report a slash to a panel that renders it. Refusing rather than guessing.',
    );
  }

  const rows = disputes.map((d) => ({
    id: d.id,
    dispute_type: d.kind?.toLowerCase() ?? null,
    indexer_address: d.indexer.toLowerCase(),
    fisherman: d.fisherman.toLowerCase(),
    allocation_id: d.allocation_id ?? null,
    deployment_id: d.subgraph_deployment,
    status: nestStatus(d.status),
    // Zero on both sides for every dispute that has ever existed - see the note above.
    tokens_slashed_grt: 0,
    tokens_burned_grt: 0,
    created_at: d.created_at ? new Date(d.created_at * 1000).toISOString() : null,
    closed_at: d.resolved_at ? new Date(d.resolved_at * 1000).toISOString() : null,
  }));

  if (rows.length > 0) {
    await sql`
      INSERT INTO disputes ${sql(rows)}
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        tokens_slashed_grt = EXCLUDED.tokens_slashed_grt,
        tokens_burned_grt = EXCLUDED.tokens_burned_grt,
        closed_at = EXCLUDED.closed_at
    `;
  }

  // The nest read is a full snapshot rather than a cursor walk - eight rows, not a paginated
  // history - so there is no cursor to advance. `updated_at` still moves, which is what the health
  // check reads to tell "running idle" from "stuck".
  await updateIngestionState(sql, 'disputes', {});

  return { ingested: rows.length };
}

const DISPUTE_FIELDS = `
        id
        type
        indexer { id }
        fisherman { id }
        allocation { id }
        subgraphDeployment { id }
        status
        tokensSlashed
        tokensBurned
        createdAt
        closedAt`;

async function upsertSubgraphDisputes(sql: DbClient, disputes: SubgraphDispute[]): Promise<number> {
  if (disputes.length === 0) return 0;
  const rows = disputes.map((d) => ({
    id: d.id,
    dispute_type: d.type?.toLowerCase() ?? null,
    indexer_address: d.indexer.id.toLowerCase(),
    fisherman: d.fisherman.id.toLowerCase(),
    allocation_id: d.allocation?.id ?? null,
    deployment_id: d.subgraphDeployment.id,
    status: d.status?.toLowerCase() ?? null,
    tokens_slashed_grt: parseFloat(d.tokensSlashed) || 0,
    tokens_burned_grt: parseFloat(d.tokensBurned) || 0,
    created_at: d.createdAt ? new Date(d.createdAt * 1000).toISOString() : null,
    closed_at: d.closedAt ? new Date(d.closedAt * 1000).toISOString() : null,
  }));
  await sql`
    INSERT INTO disputes ${sql(rows)}
    ON CONFLICT (id) DO UPDATE SET
      status = EXCLUDED.status,
      tokens_slashed_grt = EXCLUDED.tokens_slashed_grt,
      tokens_burned_grt = EXCLUDED.tokens_burned_grt,
      closed_at = EXCLUDED.closed_at
  `;
  return rows.length;
}

/**
 * The second pass the cursor cannot do (lodestar#57). `createdAt_gt` only ever returns disputes
 * newer than the newest already seen, so a dispute ingested while `undecided` is never fetched
 * again and its status, close time and slash are frozen at first sight. Measured on the primary on
 * 2026-09-03: six disputes sat `undecided` in Postgres for up to three and a half months after the
 * chain had drawn them. So every dispute Postgres still calls undecided is re-fetched by id and
 * re-upserted; the set is small (single digits), so one query in batches of 100 is the whole cost.
 */
async function revisitOpenDisputes(sql: DbClient): Promise<number> {
  const open = await sql<{ id: string }[]>`SELECT id FROM disputes WHERE status = 'undecided'`;
  const ids = open.map((r) => r.id);
  let refreshed = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const result = await subgraphQuery<{ disputes: SubgraphDispute[] }>(`{
      disputes(first: ${batch.length}, where: { id_in: [${batch.map((id) => `"${id}"`).join(', ')}] }) {${DISPUTE_FIELDS}
      }
    }`);
    refreshed += await upsertSubgraphDisputes(sql, result.disputes);
  }
  return refreshed;
}

/**
 * Ingest disputes from the network subgraph.
 * Uses id_gt cursor — disputes are infrequent.
 */
export async function ingestDisputes(sql: DbClient): Promise<{ ingested: number }> {
  // Off by default. #1078 wants each surface switchable and revertible on its own, and this one is
  // not yet approved as safe - the flag is how that decision gets taken per environment rather than
  // per deploy.
  if (nuthatchEnabled('NUTHATCH_DISPUTES')) {
    log.api.info('disputes: reading from the nest');
    return ingestDisputesFromNest(sql);
  }

  const state = await getIngestionState(sql, 'disputes');
  // Use createdAt_gt (numeric timestamp) instead of id_gt — dispute IDs are hashes
  // and lexicographic ordering on random hex strings causes the cursor to get stuck
  // once it lands on a high-value hash (same bug as delegation_events).
  const lastCreatedAt = state.last_block ?? 0;

  let totalIngested = 0;
  let cursor = lastCreatedAt;

  while (true) {
    const result = await subgraphQuery<{ disputes: SubgraphDispute[] }>(`{
      disputes(
        first: 1000
        orderBy: createdAt
        orderDirection: asc
        ${cursor ? `where: { createdAt_gt: ${cursor} }` : ''}
      ) {${DISPUTE_FIELDS}
      }
    }`);

    const disputes = result.disputes;
    if (disputes.length === 0) break;

    totalIngested += await upsertSubgraphDisputes(sql, disputes);
    cursor = Math.max(...disputes.map((d) => d.createdAt));

    if (disputes.length < 1000) break;
  }

  // Open disputes already in Postgres are outside the cursor's reach; refresh them by id. Counted
  // separately from the cursor walk because they are re-reads, not new rows, and the cursor must
  // not move on their account.
  const revisited = await revisitOpenDisputes(sql);

  // Always update updated_at so health checks can distinguish "running idle" from "stuck".
  await updateIngestionState(
    sql,
    'disputes',
    totalIngested > 0 ? { last_block: cursor } : {},
  );

  return { ingested: totalIngested + revisited };
}
