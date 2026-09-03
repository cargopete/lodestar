import type { DbClient } from '../db';
import { getIngestionState, updateIngestionState } from '../db';
import { subgraphQuery } from '../subgraph';
import { nuthatchEnabled, nuthatchSqlReady } from '../nuthatch';
import { weiToGRT } from '../utils';
import { log } from '../logger';

/**
 * Ingest RAV redemptions (query-fee revenue) into the rav_redemptions time-series.
 *
 * Source: `paymentsEscrowTransactions` on the network payments subgraph. Each row is
 * an event with a `type` (deposit / redeem / …), `allocationId`, `amount`, `timestamp`.
 * We keep only the REDEEM family — escrow inflows (deposit/thaw/withdraw) are not revenue.
 *
 * Deployment is resolved from our own `allocations` table via allocationId; rows with no
 * matching allocation keep deployment_id NULL (degrade gracefully).
 *
 * Cursor: ingestion_state['rav'].last_block holds the max transaction timestamp seen.
 * Delta runs re-scan a small overlap window; upserts make the overlap harmless.
 */

interface PaymentsTx {
  id: string;
  type: string;
  payer: { id: string } | null;
  receiver: { id: string } | null;
  allocationId: string | null;
  amount: string;
  timestamp: string;
}

const TX_FIELDS = `
  id
  type
  payer { id }
  receiver { id }
  allocationId
  amount
  timestamp
`;

// Re-scan this much wall-clock on every delta run so late-arriving / reordered
// transactions near the cursor boundary are not missed (upserts dedupe them).
const OVERLAP_SECONDS = 3600;
const PAGE = 1000;

/**
 * Redemption classifier.
 *
 * Confirmed against the live payments subgraph (2026-06-10): the `paymentsEscrowTransaction`
 * `type` enum is exactly `deposit` | `redeem`. Redemptions are the query-fee revenue rows
 * (each carries an allocationId; deposits do not). The ingest still logs distinct `type`
 * values as a cheap guard, so a future enum change surfaces instead of silently dropping rows.
 */
function isRedemption(type: string): boolean {
  return type === 'redeem';
}

/** The nest carrying the Lodestar views. `/alloc` reverse-proxies to graph-allocations-nest. */
const NEST_BASE_PATH = process.env.NUTHATCH_RAV_BASE_PATH || '/alloc';

/** One page of a nest read. Well under the nest's 50,000-row cap, so `truncated` is a defect, not a page. */
const NEST_PAGE = 10000;

/**
 * The GraphTallyCollector. An `EscrowCollected` whose collector is this contract is a query-fee
 * collection with a matching `QueryFeesCollected` in the same transaction, which is where the
 * allocation id lives. Any other collector has no such partner and no allocation.
 */
const GRAPH_TALLY_COLLECTOR = '0x8f69f5c07477ac46fbc491b1e6d91e2bb0111a9e';

/** One `EscrowCollected` as the nest reports it, with its fee event joined in where one exists. */
interface NestCollection {
  tx_hash: string;
  log_index: number;
  payer: string;
  receiver: string;
  tokens: string;
  block_timestamp: number;
  allocation_id: string | null;
  fee_tokens: string | null;
}

/**
 * The subgraph's `paymentsEscrowTransactions.id`, rebuilt from the nest's row so the upsert dedupes
 * against rows the gateway path already wrote instead of writing every collection twice.
 *
 * The encoding is `txHash (32 bytes) || logIndex (uint32, little-endian)`, and the subgraph's index
 * is the nest's `log_index` **plus one** - not a guess: joining on that basis matched 70,408 of
 * 70,408 subgraph rows at a pinned block, and the other two bases matched zero
 * (nightswatchhq/nuthatch#1114).
 */
export function subgraphEscrowTxId(txHash: string, logIndex: number): string {
  const n = logIndex + 1;
  const le = [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${txHash.toLowerCase()}${le}`;
}

/**
 * Query-fee collections from the nest (nightswatchhq/nuthatch#1078).
 *
 * `lodestar_escrow_transactions` keys rows by `tx_hash-log_index` and carries no allocation, so this
 * reads the two event tables directly: every `EscrowCollected`, and for the ones collected by the
 * GraphTallyCollector, the `QueryFeesCollected` from the same transaction with the same payer,
 * service provider and amount to the wei. The pairing is checked rather than trusted: a pair whose
 * amounts differ fails the run, because a wrong allocation on a revenue row is a plausible number
 * rather than an error.
 *
 * **Seventy-five collections get no allocation here where the gateway path wrote one.** They are
 * GraphTallyCollector collections for a data service other than SubgraphService, so no
 * `QueryFeesCollected` exists; the subgraph takes their `collectionId` from the collector's own
 * `PaymentCollected` event, which this nest does not yet index. Every one of them already has a
 * null `deployment_id` in Postgres (the id resolves to no allocation), so nothing rendered changes.
 * Indexing the collector on the nest is queued with its redeploy (nuthatch#1078).
 *
 * **Parity, measured at a pinned block (nuthatch#1114).** The nest is a strict superset of the
 * subgraph's `redeem` rows: 70,408 of 70,408 subgraph rows match a nest row by the derived id, and
 * the nest holds **nine** more - one address collecting from its own escrow to a single receiver,
 * which the subgraph drops because no escrow account keyed `(payer, collector, receiver)` was ever
 * funded. Those nine are real collections and this path keeps them; anyone comparing revenue before
 * and after the flag should expect nine extra rows and not read them as a regression.
 *
 * Same cursor as the gateway path: `last_block` is the newest timestamp seen, delta runs re-scan an
 * hour of overlap, and the upsert makes the overlap harmless. Pages by (timestamp, tx, log index).
 */
async function ingestRavFromNest(
  sql: DbClient,
  opts: { backfill?: boolean },
): Promise<{ ingested: number }> {
  const state = await getIngestionState(sql, 'rav');
  const since = opts.backfill ? 0 : Math.max(0, (state.last_block ?? 0) - OVERLAP_SECONDS);

  let totalIngested = 0;
  let maxTimestamp = state.last_block ?? 0;
  let after: NestCollection | null = null;

  while (true) {
    const keyset: string = after
      ? ` AND (c.block_timestamp > ${after.block_timestamp} OR (c.block_timestamp = ${after.block_timestamp} AND ` +
        `(c.tx_hash > '${after.tx_hash}' OR (c.tx_hash = '${after.tx_hash}' AND c.log_index > ${after.log_index}))))`
      : '';
    // A collection and its fee event share the transaction, the payer, the service provider and
    // the amount to the wei, so the pair is joined on all four; the rank only separates two
    // identical collections in one transaction. That leaves no way to pair a self-collection, or a
    // collection for some other data service, with a SubgraphService fee that is not its own.
    const query: string =
      `WITH fees AS (` +
      `SELECT tx_hash, LOWER(payer) AS payer, LOWER("serviceProvider") AS receiver, ` +
      `CAST("tokensCollected" AS VARCHAR) AS tokens, "allocationId" AS allocation_id, ` +
      `CAST("tokensCollected" AS VARCHAR) AS fee_tokens, ` +
      `ROW_NUMBER() OVER (PARTITION BY tx_hash, LOWER(payer), LOWER("serviceProvider"), CAST("tokensCollected" AS VARCHAR) ORDER BY log_index) AS rn ` +
      `FROM subgraph_service__query_fees_collected` +
      `), esc AS (` +
      `SELECT tx_hash, log_index, payer, receiver, tokens, block_timestamp, ` +
      `ROW_NUMBER() OVER (PARTITION BY tx_hash, LOWER(payer), LOWER(receiver), CAST(tokens AS VARCHAR) ORDER BY log_index) AS rn ` +
      `FROM escrow__escrow_collected WHERE LOWER(collector) = '${GRAPH_TALLY_COLLECTOR}'` +
      `) ` +
      `SELECT c.tx_hash, c.log_index, c.payer, c.receiver, CAST(c.tokens AS VARCHAR) AS tokens, c.block_timestamp, ` +
      `f.allocation_id, f.fee_tokens ` +
      `FROM escrow__escrow_collected c ` +
      `LEFT JOIN esc e ON e.tx_hash = c.tx_hash AND e.log_index = c.log_index ` +
      `LEFT JOIN fees f ON f.tx_hash = e.tx_hash AND f.payer = LOWER(e.payer) AND f.receiver = LOWER(e.receiver) ` +
      `AND f.tokens = CAST(e.tokens AS VARCHAR) AND f.rn = e.rn ` +
      `WHERE c.block_timestamp >= ${since}${keyset} ` +
      `ORDER BY c.block_timestamp, c.tx_hash, c.log_index LIMIT ${NEST_PAGE}`;

    const result = await nuthatchSqlReady<NestCollection>(query, NEST_BASE_PATH);
    if (!result.ok) {
      throw Object.assign(new Error(result.error), { nest: result });
    }
    if (result.data.truncated) {
      throw new Error(
        `escrow read was truncated at ${result.data.count} rows; refusing to write a partial page as if it were complete`,
      );
    }
    const rows: NestCollection[] = result.data.rows;
    if (rows.length === 0) break;

    const mismatched = rows.filter(
      (r) => r.fee_tokens != null && BigInt(r.fee_tokens) !== BigInt(r.tokens),
    );
    if (mismatched.length > 0) {
      const m = mismatched[0];
      throw new Error(
        `${mismatched.length} escrow collection(s) paired with a fee event of a different amount ` +
          `(first: ${m.tx_hash}-${m.log_index} escrow ${m.tokens} vs fee ${m.fee_tokens}); ` +
          'the allocation would be wrong, so refusing rather than guessing',
      );
    }

    const redemptions: PaymentsTx[] = rows.map((r) => ({
      id: subgraphEscrowTxId(r.tx_hash, r.log_index),
      type: 'redeem',
      payer: { id: r.payer },
      receiver: { id: r.receiver },
      allocationId: r.allocation_id,
      amount: r.tokens,
      timestamp: String(r.block_timestamp),
    }));
    for (const r of rows) {
      if (r.block_timestamp > maxTimestamp) maxTimestamp = r.block_timestamp;
    }
    totalIngested += await upsertRedemptions(sql, redemptions);

    after = rows[rows.length - 1];
    if (rows.length < NEST_PAGE) break;
    if (opts.backfill) {
      log.ingest.info({ step: 'rav', totalIngested }, 'RAV backfill progress (nest)');
    }
  }

  if (maxTimestamp > (state.last_block ?? 0)) {
    await updateIngestionState(sql, 'rav', { last_block: maxTimestamp });
  }
  log.ingest.info({ step: 'rav', ingested: totalIngested, source: 'nest' }, 'RAV ingestion complete');
  return { ingested: totalIngested };
}

export async function ingestRav(
  sql: DbClient,
  opts: { backfill?: boolean } = {},
): Promise<{ ingested: number }> {
  // Off by default. #1078 wants each surface switchable and revertible on its own, and the flag is
  // how that decision gets taken per environment rather than per deploy.
  if (nuthatchEnabled('NUTHATCH_RAV')) {
    log.ingest.info({ step: 'rav' }, 'rav: reading from the nest');
    return ingestRavFromNest(sql, opts);
  }

  const state = await getIngestionState(sql, 'rav');
  const since = opts.backfill ? 0 : Math.max(0, (state.last_block ?? 0) - OVERLAP_SECONDS);

  let lastId = '';
  let totalIngested = 0;
  let maxTimestamp = state.last_block ?? 0;
  const typeCounts: Record<string, number> = {};

  while (true) {
    const where: string[] = [];
    if (since > 0) where.push(`timestamp_gte: "${since}"`);
    if (lastId) where.push(`id_gt: "${lastId}"`);
    const whereClause = where.length ? `where: { ${where.join(', ')} }` : '';

    const result = await subgraphQuery<{ paymentsEscrowTransactions: PaymentsTx[] }>(`{
      paymentsEscrowTransactions(
        first: ${PAGE}
        orderBy: id
        orderDirection: asc
        ${whereClause}
      ) {
        ${TX_FIELDS}
      }
    }`);

    const txs = result.paymentsEscrowTransactions;
    if (txs.length === 0) break;

    const redemptions: PaymentsTx[] = [];
    for (const tx of txs) {
      typeCounts[tx.type] = (typeCounts[tx.type] ?? 0) + 1;
      const ts = Number(tx.timestamp);
      if (ts > maxTimestamp) maxTimestamp = ts;
      if (isRedemption(tx.type) && tx.receiver?.id) redemptions.push(tx);
    }

    if (redemptions.length > 0) {
      totalIngested += await upsertRedemptions(sql, redemptions);
    }

    lastId = txs[txs.length - 1].id;
    if (txs.length < PAGE) break;

    if (opts.backfill && totalIngested > 0 && totalIngested % 5000 < PAGE) {
      log.ingest.info({ step: 'rav', totalIngested }, 'RAV backfill progress');
    }
  }

  if (maxTimestamp > (state.last_block ?? 0)) {
    await updateIngestionState(sql, 'rav', { last_block: maxTimestamp });
  }

  // Surfaces the real `type` enum so isRedemption() can be tightened — see note above.
  log.ingest.info(
    { step: 'rav', ingested: totalIngested, typeCounts },
    'RAV ingestion complete',
  );

  return { ingested: totalIngested };
}

async function upsertRedemptions(sql: DbClient, redemptions: PaymentsTx[]): Promise<number> {
  // Resolve allocationId -> deployment_id from our own allocations table.
  const allocIds = [
    ...new Set(
      redemptions
        .map((r) => r.allocationId?.toLowerCase())
        .filter((id): id is string => !!id),
    ),
  ];

  const depMap = new Map<string, string | null>();
  if (allocIds.length > 0) {
    // Allocation IDs are canonically lowercase hex on both sides, so match the PK
    // directly (keeps the primary-key index; an unlikely mismatch just leaves
    // deployment_id NULL).
    const rows = await sql<{ id: string; deployment_id: string | null }[]>`
      SELECT id, deployment_id FROM allocations WHERE id IN ${sql(allocIds)}
    `;
    for (const row of rows) depMap.set(row.id.toLowerCase(), row.deployment_id);
  }

  const batch = redemptions.map((r) => {
    const allocId = r.allocationId?.toLowerCase() ?? null;
    return {
      id: r.id,
      indexer_address: r.receiver!.id.toLowerCase(),
      payer: r.payer?.id?.toLowerCase() ?? null,
      allocation_id: allocId,
      deployment_id: allocId ? depMap.get(allocId) ?? null : null,
      tokens_grt: weiToGRT(r.amount),
      source: 'graphtally',
      collected_at: new Date(Number(r.timestamp) * 1000).toISOString(),
      block: null,
      chain_id: 42161,
    };
  });

  const CHUNK = 200;
  for (let i = 0; i < batch.length; i += CHUNK) {
    const slice = batch.slice(i, i + CHUNK);
    await sql`
      INSERT INTO rav_redemptions ${sql(slice)}
      ON CONFLICT (id) DO UPDATE SET
        tokens_grt    = EXCLUDED.tokens_grt,
        deployment_id = EXCLUDED.deployment_id,
        allocation_id = EXCLUDED.allocation_id,
        payer         = EXCLUDED.payer,
        collected_at  = EXCLUDED.collected_at
    `;
  }

  return batch.length;
}
