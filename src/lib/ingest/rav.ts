import type { DbClient } from '../db';
import { getIngestionState, updateIngestionState } from '../db';
import { subgraphQuery } from '../subgraph';
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

export async function ingestRav(
  sql: DbClient,
  opts: { backfill?: boolean } = {},
): Promise<{ ingested: number }> {
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
