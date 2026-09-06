import type { DbClient } from '../db';
import { getIngestionState, updateIngestionState } from '../db';
import { nuthatchSqlReady } from '../nuthatch';
import { weiToGRT } from '../utils';
import { log } from '../logger';

/** The nest carrying the Lodestar views. `/alloc` reverse-proxies to graph-allocations-nest. */
const NEST_BASE_PATH = process.env.NUTHATCH_ALLOCATIONS_BASE_PATH || '/alloc';

/** One page of a nest read. Well under the nest's 50,000-row cap, so `truncated` is a defect, not a page. */
const NEST_PAGE = 10000;

/** An allocation as `lodestar_allocations` reports it. Token amounts are wei as decimal strings. */
interface NestAllocation {
  id: string;
  indexer: string;
  subgraph_deployment: string;
  signalled_tokens: string;
  allocated_tokens: string;
  created_at_epoch: string | number | null;
  closed_at_epoch: string | number | null;
  created_at: number | null;
  closed_at: number | null;
  poi: string | null;
  indexing_rewards: string;
  query_fees_collected: string;
  status: string;
}

const ALLOCATION_COLUMNS =
  'id, indexer, subgraph_deployment, signalled_tokens, allocated_tokens, created_at_epoch, ' +
  'closed_at_epoch, created_at, closed_at, poi, indexing_rewards, query_fees_collected, status';

/**
 * One read against `lodestar_allocations`, with the two things a caller must not forget: the
 * readiness gate, and that a truncated answer is a defect here. Every query below is sized to fit
 * under the row cap, so `truncated: true` means the assumption broke and the run must fail rather
 * than write a partial snapshot that reads as complete.
 */
async function readNestAllocations(where: string, orderAndLimit: string): Promise<NestAllocation[]> {
  const result = await nuthatchSqlReady<NestAllocation>(
    `SELECT ${ALLOCATION_COLUMNS} FROM lodestar_allocations ${where} ${orderAndLimit}`,
    NEST_BASE_PATH,
  );
  if (!result.ok) {
    throw Object.assign(new Error(result.error), { nest: result });
  }
  if (result.data.truncated) {
    throw new Error(
      `lodestar_allocations read was truncated at ${result.data.count} rows (${where.trim() || 'no filter'}); ` +
        'refusing to write a partial snapshot as if it were complete',
    );
  }
  return result.data.rows;
}

/**
 * The nest's idea of the current epoch: the newest epoch `epoch_boundaries` has seen. It can trail
 * the chain by one until the first event carrying the new epoch lands, which only makes the next
 * delta re-read one extra epoch of closed allocations - and the upsert makes that harmless.
 */
async function nestCurrentEpoch(): Promise<number> {
  const result = await nuthatchSqlReady<{ epoch: string | number | null }>(
    'SELECT MAX(epoch) AS epoch FROM epoch_boundaries',
    NEST_BASE_PATH,
  );
  if (!result.ok) {
    throw Object.assign(new Error(result.error), { nest: result });
  }
  const epoch = Number(result.data.rows[0]?.epoch);
  if (!Number.isFinite(epoch) || epoch <= 0) {
    throw new Error(`epoch_boundaries reports no current epoch (${String(result.data.rows[0]?.epoch)})`);
  }
  return epoch;
}

/**
 * Map a nest row onto the `allocations` table, byte-for-byte the shape `upsertAllocations` writes
 * from the gateway. `signalled_tokens` on the view is the deployment's net signal at read time,
 * which is exactly what `subgraphDeployment.signalledTokens` is on the subgraph, so `signal_at_open`
 * keeps its existing meaning: the signal at first sight, since the upsert never updates it.
 */
function nestRowToAllocation(a: NestAllocation) {
  return {
    id: a.id,
    indexer_address: a.indexer.toLowerCase(),
    deployment_id: a.subgraph_deployment,
    allocated_tokens_grt: weiToGRT(a.allocated_tokens),
    created_epoch: a.created_at_epoch == null ? null : Number(a.created_at_epoch),
    closed_epoch: a.closed_at_epoch == null ? null : Number(a.closed_at_epoch),
    created_at: a.created_at ? new Date(a.created_at * 1000).toISOString() : null,
    closed_at: a.closed_at ? new Date(a.closed_at * 1000).toISOString() : null,
    signal_at_open: weiToGRT(a.signalled_tokens),
    poi: a.poi,
    indexing_rewards_grt: weiToGRT(a.indexing_rewards),
    query_fees_grt: weiToGRT(a.query_fees_collected),
    status: a.status === 'Active' ? 'open' : 'closed',
  };
}

async function upsertNestAllocations(sql: DbClient, allocations: NestAllocation[]): Promise<number> {
  const rows = allocations.map(nestRowToAllocation);
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK);
    await sql`
      INSERT INTO allocations ${sql(batch)}
      ON CONFLICT (id) DO UPDATE SET
        allocated_tokens_grt = EXCLUDED.allocated_tokens_grt,
        closed_epoch = EXCLUDED.closed_epoch,
        closed_at = EXCLUDED.closed_at,
        poi = EXCLUDED.poi,
        indexing_rewards_grt = EXCLUDED.indexing_rewards_grt,
        query_fees_grt = EXCLUDED.query_fees_grt,
        status = EXCLUDED.status
    `;
  }
  return rows.length;
}

/**
 * Allocations from the nest (nightswatchhq/nuthatch#1078).
 *
 * **Parity is exact and was measured.** At a pinned block the nest's `lodestar_allocations` and the
 * subgraph's non-legacy allocations hold the same count, 258,489, and the view emits every field
 * this module writes. The one deliberate difference is scope: the nest indexes `SubgraphService`
 * from its deployment, so it carries **Horizon allocations only**. The legacy allocations already in
 * Postgres are closed, immutable, and untouched by this path - the same shape as the disputes
 * migration, and for the same reason.
 *
 * Same two passes as the gateway path so the cursor keeps its meaning: every active allocation
 * (13,775 at the time of writing, well under the row cap) so status stays current, then everything
 * closed at or after the last epoch seen. Backfill walks the whole view by id in pages.
 */
async function ingestAllocationsFromNest(
  sql: DbClient,
  opts: { backfill?: boolean },
): Promise<{ ingested: number }> {
  let totalIngested = 0;

  if (opts.backfill) {
    let lastId = '';
    while (true) {
      const page = await readNestAllocations(
        lastId ? `WHERE id > '${lastId}'` : '',
        `ORDER BY id LIMIT ${NEST_PAGE}`,
      );
      if (page.length === 0) break;
      totalIngested += await upsertNestAllocations(sql, page);
      lastId = page[page.length - 1].id;
      if (totalIngested % 50000 === 0) {
        log.ingest.info({ step: 'allocations', totalIngested }, 'Backfill progress (nest)');
      }
      if (page.length < NEST_PAGE) break;
    }
  } else {
    const state = await getIngestionState(sql, 'allocations');
    const lastEpoch = state.last_epoch ?? 0;

    const open = await readNestAllocations(`WHERE status = 'Active'`, 'ORDER BY id');
    totalIngested += await upsertNestAllocations(sql, open);

    if (lastEpoch > 0) {
      const closed = await readNestAllocations(
        `WHERE status <> 'Active' AND closed_at_epoch >= ${Math.floor(lastEpoch)}`,
        'ORDER BY id',
      );
      totalIngested += await upsertNestAllocations(sql, closed);
    }
  }

  await updateIngestionState(sql, 'allocations', { last_epoch: await nestCurrentEpoch() });
  return { ingested: totalIngested };
}

/**
 * Ingest allocations from the network subgraph.
 * Delta mode: fetch allocations closed since last epoch + all currently open.
 * Backfill mode: fetch ALL allocations using id_gt pagination.
 */
export async function ingestAllocations(
  sql: DbClient,
  opts: { backfill?: boolean } = {}
): Promise<{ ingested: number }> {
  // From the nest, always (nuthatch#1160). The gateway path this once fell back to left with the key.
  log.ingest.info({ step: 'allocations' }, 'allocations: reading from the nest');
  return ingestAllocationsFromNest(sql, opts);
}
