import type { DbClient } from '../db';
import { getIngestionState, updateIngestionState } from '../db';
import { subgraphQuery } from '../subgraph';

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

/**
 * Ingest disputes from the network subgraph.
 * Uses id_gt cursor — disputes are infrequent.
 */
export async function ingestDisputes(sql: DbClient): Promise<{ ingested: number }> {
  const state = await getIngestionState(sql, 'disputes');
  const lastId = state.last_id ?? '';

  let totalIngested = 0;
  let cursor = lastId;

  while (true) {
    const result = await subgraphQuery<{ disputes: SubgraphDispute[] }>(`{
      disputes(
        first: 1000
        orderBy: id
        orderDirection: asc
        ${cursor ? `where: { id_gt: "${cursor}" }` : ''}
      ) {
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
        closedAt
      }
    }`);

    const disputes = result.disputes;
    if (disputes.length === 0) break;

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

    totalIngested += rows.length;
    cursor = disputes[disputes.length - 1].id;

    if (disputes.length < 1000) break;
  }

  if (totalIngested > 0) {
    await updateIngestionState(sql, 'disputes', { last_id: cursor });
  }

  return { ingested: totalIngested };
}
