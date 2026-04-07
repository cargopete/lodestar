import type { DbClient } from '../db';
import { getIngestionState, updateIngestionState } from '../db';
import { subgraphQuery } from '../subgraph';
import { weiToGRT } from '../utils';

interface SubgraphEpoch {
  id: string;
  startBlock: number;
  endBlock: number | null;
  signalledTokens: string;
  stakeDeposited: string;
  totalRewards: string;
  totalIndexerRewards: string;
  totalDelegatorRewards: string;
  totalQueryFees: string;
  queryFeesCollected: string;
  curatorQueryFees: string;
  queryFeeRebates: string;
  taxedQueryFees: string;
}

/**
 * Ingest new epochs from the subgraph into Postgres.
 * Uses epoch ID as cursor — only fetches epochs newer than the last ingested.
 */
export async function ingestEpochs(sql: DbClient): Promise<{ ingested: number }> {
  const state = await getIngestionState(sql, 'epochs');
  // Use startBlock_gt (numeric) instead of id_gt (string) — epoch IDs are decimal
  // strings and lexicographic comparison breaks at id 1000 ("1000" < "999").
  const lastBlock = state.last_block ?? 0;

  let totalIngested = 0;
  let blockCursor = lastBlock;
  let lastEpochId = state.last_epoch ?? 0;

  // Paginate through new epochs (100 at a time)
  while (true) {
    const result = await subgraphQuery<{ epoches: SubgraphEpoch[] }>(`{
      epoches(
        first: 100
        orderBy: startBlock
        orderDirection: asc
        where: { startBlock_gt: ${blockCursor} }
      ) {
        id startBlock endBlock
        signalledTokens stakeDeposited
        totalRewards totalIndexerRewards totalDelegatorRewards
        totalQueryFees queryFeesCollected curatorQueryFees
        queryFeeRebates taxedQueryFees
      }
    }`);

    const epochs = result.epoches;
    if (epochs.length === 0) break;

    const rows = epochs.map((e) => ({
      id: parseInt(e.id),
      start_block: e.startBlock,
      end_block: e.endBlock,
      stake_deposited: weiToGRT(e.stakeDeposited),
      signalled_tokens: weiToGRT(e.signalledTokens),
      total_rewards: weiToGRT(e.totalRewards),
      total_indexer_rewards: weiToGRT(e.totalIndexerRewards),
      total_delegator_rewards: weiToGRT(e.totalDelegatorRewards),
      total_query_fees: weiToGRT(e.totalQueryFees),
      query_fees_collected: weiToGRT(e.queryFeesCollected),
      curator_query_fees: weiToGRT(e.curatorQueryFees),
      query_fee_rebates: weiToGRT(e.queryFeeRebates),
      taxed_query_fees: weiToGRT(e.taxedQueryFees),
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
    blockCursor = Math.max(...epochs.map((e) => e.startBlock));
    lastEpochId = Math.max(...epochs.map((e) => parseInt(e.id)));

    if (epochs.length < 100) break;
  }

  // Always update updated_at so health checks can distinguish "running idle" from "stuck".
  await updateIngestionState(
    sql,
    'epochs',
    totalIngested > 0 ? { last_epoch: lastEpochId, last_block: blockCursor } : {},
  );

  return { ingested: totalIngested };
}
