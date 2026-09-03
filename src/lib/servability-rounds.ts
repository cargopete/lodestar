// The round store behind RFC-006 D5 (lodestar#59): one row per probe round, read back as the short
// history `applyPersistence` needs. Postgres, because an incident question ("was it actually down
// at 1:34?") is a query over time, and a cache entry is not.
//
// Everything here is best-effort from the route's point of view: a store that is down must not
// take the status page with it. With no history the persistence rule renders a dead round as
// `rechecking`, which is the safe direction.

import type { DbClient } from './db';
import type { ServabilityVerdict } from './servability';
import type { RoundSummary } from './servability-persistence';

export interface RoundRecord extends RoundSummary {
  deploymentHash: string;
  verdict: ServabilityVerdict;
}

export async function recordRound(sql: DbClient, r: RoundRecord): Promise<void> {
  await sql`
    INSERT INTO servability_rounds
      (deployment_hash, probed_at, serving_operator_count, serving_indexer_count, gateway_verdict, verdict_json)
    VALUES
      (${r.deploymentHash}, ${r.probedAt}, ${r.servingOperators}, ${r.servingIndexers}, ${r.gatewayVerdict}, ${JSON.stringify(r.verdict)}::jsonb)
  `;
}

/** The newest `limit` rounds for a deployment, oldest first, as `applyPersistence` wants them. */
export async function recentRounds(sql: DbClient, deploymentHash: string, limit: number): Promise<RoundSummary[]> {
  const rows = await sql<
    { probed_at: string | Date; serving_operator_count: number; serving_indexer_count: number; gateway_verdict: string | null }[]
  >`
    SELECT probed_at, serving_operator_count, serving_indexer_count, gateway_verdict
    FROM servability_rounds
    WHERE deployment_hash = ${deploymentHash}
    ORDER BY probed_at DESC
    LIMIT ${limit}
  `;
  return rows
    .map((r) => ({
      probedAt: r.probed_at instanceof Date ? r.probed_at.toISOString() : String(r.probed_at),
      servingOperators: Number(r.serving_operator_count),
      servingIndexers: Number(r.serving_indexer_count),
      gatewayVerdict: (r.gateway_verdict ?? null) as RoundSummary['gatewayVerdict'],
    }))
    .reverse();
}
