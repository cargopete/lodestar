import type { DbClient } from '../db';
import { getIngestionState, updateIngestionState } from '../db';
import { weiToGRT } from '../utils';
import { nuthatchSql } from '../nuthatch';
import { epochsSql, epochTotalQueryFees, type NestEpochRow } from '../nest-queries';
import { log } from '../logger';

const EPOCHS_BASE_PATH = process.env.NUTHATCH_EPOCHS_BASE_PATH || '/alloc';

/**
 * Ingest new epochs into Postgres from `lodestar_epochs` on the nest (nuthatch#1160). The gateway
 * path this once fell back to left with the key.
 */
export async function ingestEpochs(sql: DbClient): Promise<{ ingested: number }> {
  log.ingest.info({ step: 'epochs' }, 'epochs: reading from the nest');
  return ingestEpochsFromNest(sql);
}

/**
 * The same rows from `lodestar_epochs` (graph-allocations-nest), same cursor, same upsert. The
 * cursor is the epoch id rather than `startBlock` because the view's id is numeric and the cursor
 * problem the gateway path works around (lexicographic ids) does not exist here. The newest epoch is
 * re-read on every run: it is still open, its `end_block` and sums move, and the upsert refreshes it.
 * `query_fee_rebates` is 0: Horizon has no rebate mechanism, and the subgraph's figure for it has
 * been frozen since the upgrade.
 */
async function ingestEpochsFromNest(sql: DbClient): Promise<{ ingested: number }> {
  const state = await getIngestionState(sql, 'epochs');
  const lastEpoch = Math.max((state.last_epoch ?? 0) - 1, 0);
  let totalIngested = 0;
  let cursor = lastEpoch;
  let lastEpochId = state.last_epoch ?? 0;
  let lastBlock = state.last_block ?? 0;
  while (true) {
    const epochs = await nuthatchSql<NestEpochRow>(epochsSql(100, cursor), EPOCHS_BASE_PATH);
    if (epochs.length === 0) break;
    const rows = epochs.map((e) => ({
      id: Number(e.id),
      start_block: Number(e.start_block),
      end_block: Number(e.end_block),
      stake_deposited: weiToGRT(e.stake_deposited),
      signalled_tokens: weiToGRT(e.signalled_tokens),
      total_rewards: weiToGRT(e.total_rewards),
      total_indexer_rewards: weiToGRT(e.total_indexer_rewards),
      total_delegator_rewards: weiToGRT(e.total_delegator_rewards),
      total_query_fees: weiToGRT(epochTotalQueryFees(e)),
      query_fees_collected: weiToGRT(e.query_fees_collected),
      curator_query_fees: weiToGRT(e.curator_query_fees),
      query_fee_rebates: 0,
      taxed_query_fees: weiToGRT(e.taxed_query_fees),
    }));
    await sql`
      INSERT INTO epochs ${sql(rows)}
      ON CONFLICT (id) DO UPDATE SET
        end_block = EXCLUDED.end_block,
        stake_deposited = EXCLUDED.stake_deposited,
        signalled_tokens = EXCLUDED.signalled_tokens,
        total_rewards = EXCLUDED.total_rewards,
        total_indexer_rewards = EXCLUDED.total_indexer_rewards,
        total_delegator_rewards = EXCLUDED.total_delegator_rewards,
        total_query_fees = EXCLUDED.total_query_fees,
        query_fees_collected = EXCLUDED.query_fees_collected,
        curator_query_fees = EXCLUDED.curator_query_fees,
        query_fee_rebates = EXCLUDED.query_fee_rebates,
        taxed_query_fees = EXCLUDED.taxed_query_fees
    `;
    totalIngested += rows.length;
    cursor = Math.max(...rows.map((r) => r.id));
    lastEpochId = Math.max(lastEpochId, cursor);
    lastBlock = Math.max(lastBlock, ...rows.map((r) => r.start_block));
    if (epochs.length < 100) break;
  }
  await updateIngestionState(sql, 'epochs', totalIngested > 0 ? { last_epoch: lastEpochId, last_block: lastBlock } : {});
  return { ingested: totalIngested };
}
