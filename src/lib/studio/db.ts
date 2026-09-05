import { db } from '@/lib/db';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StudioSubgraph {
  id: number;
  owner_address: string;
  slug: string;
  display_name: string | null;
  description: string | null;
  deployment_id: string | null;
  network: string | null;
  published_subgraph_id: string | null;
  version_label: string | null;
  last_published_deployment_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DeployKey {
  key_hash: string;
  created_at: string;
  last_used_at: string | null;
}

export interface SyncBounty {
  id: number;
  deployment_id: string;
  subgraph_id: number | null;
  developer_address: string;
  amount_grt: string;
  message: string | null;
  status: 'open' | 'claimed' | 'cancelled' | 'expired';
  claimed_by: string | null;
  claimed_at: string | null;
  created_at: string;
  expires_at: string | null;
  chain_bounty_id: string | null;
  post_tx_hash: string | null;
}

// ---------------------------------------------------------------------------
// Subgraphs
// ---------------------------------------------------------------------------

export async function listSubgraphs(owner: string): Promise<StudioSubgraph[]> {
  return db!<StudioSubgraph[]>`
    SELECT * FROM studio_subgraphs
    WHERE owner_address = ${owner.toLowerCase()}
    ORDER BY created_at DESC
  `;
}

export async function getSubgraphBySlug(slug: string): Promise<StudioSubgraph | null> {
  const rows = await db!<StudioSubgraph[]>`
    SELECT * FROM studio_subgraphs WHERE slug = ${slug}
  `;
  return rows[0] ?? null;
}

export async function getSubgraphById(id: number): Promise<StudioSubgraph | null> {
  const rows = await db!<StudioSubgraph[]>`
    SELECT * FROM studio_subgraphs WHERE id = ${id}
  `;
  return rows[0] ?? null;
}

export async function createSubgraph(
  owner: string,
  slug: string,
  displayName: string | null,
): Promise<StudioSubgraph> {
  const [row] = await db!<StudioSubgraph[]>`
    INSERT INTO studio_subgraphs (owner_address, slug, display_name)
    VALUES (${owner.toLowerCase()}, ${slug}, ${displayName})
    RETURNING *
  `;
  return row;
}

export async function updateSubgraphDeployment(
  slug: string,
  deploymentId: string,
  network: string | null,
): Promise<void> {
  await db!`
    UPDATE studio_subgraphs
    SET deployment_id = ${deploymentId}, network = ${network}, updated_at = NOW()
    WHERE slug = ${slug}
  `;
}

export async function updateSubgraphMeta(
  id: number,
  owner: string,
  displayName: string | null,
  description: string | null,
): Promise<void> {
  await db!`
    UPDATE studio_subgraphs
    SET display_name = ${displayName}, description = ${description}, updated_at = NOW()
    WHERE id = ${id} AND owner_address = ${owner.toLowerCase()}
  `;
}

export async function setPublishedSubgraphId(
  id: number,
  owner: string,
  publishedId: string,
  versionLabel?: string | null,
  lastPublishedDeploymentId?: string | null,
): Promise<void> {
  await db!`
    UPDATE studio_subgraphs
    SET published_subgraph_id = ${publishedId},
        version_label = ${versionLabel ?? null},
        last_published_deployment_id = ${lastPublishedDeploymentId ?? null},
        updated_at = NOW()
    WHERE id = ${id} AND owner_address = ${owner.toLowerCase()}
  `;
}

export async function updateVersionLabel(
  id: number,
  owner: string,
  versionLabel: string | null,
  lastPublishedDeploymentId?: string | null,
): Promise<void> {
  await db!`
    UPDATE studio_subgraphs
    SET version_label = ${versionLabel},
        last_published_deployment_id = ${lastPublishedDeploymentId ?? null},
        updated_at = NOW()
    WHERE id = ${id} AND owner_address = ${owner.toLowerCase()}
  `;
}

export async function deleteSubgraph(id: number, owner: string): Promise<void> {
  await db!`
    DELETE FROM studio_subgraphs
    WHERE id = ${id} AND owner_address = ${owner.toLowerCase()}
  `;
}

// ---------------------------------------------------------------------------
// Deploy keys
// ---------------------------------------------------------------------------

export async function getDeployKey(owner: string): Promise<DeployKey | null> {
  const rows = await db!<DeployKey[]>`
    SELECT key_hash, created_at, last_used_at
    FROM studio_deploy_keys
    WHERE owner_address = ${owner.toLowerCase()}
  `;
  return rows[0] ?? null;
}

export async function upsertDeployKey(owner: string, keyHash: string): Promise<void> {
  await db!`
    INSERT INTO studio_deploy_keys (owner_address, key_hash)
    VALUES (${owner.toLowerCase()}, ${keyHash})
    ON CONFLICT (owner_address)
    DO UPDATE SET key_hash = EXCLUDED.key_hash, created_at = NOW(), last_used_at = NULL
  `;
}

export async function findOwnerByKeyHash(keyHash: string): Promise<string | null> {
  const rows = await db!<{ owner_address: string }[]>`
    SELECT owner_address FROM studio_deploy_keys WHERE key_hash = ${keyHash}
  `;
  if (!rows[0]) return null;
  await db!`UPDATE studio_deploy_keys SET last_used_at = NOW() WHERE key_hash = ${keyHash}`;
  return rows[0].owner_address;
}

// ---------------------------------------------------------------------------
// Metered gateway API keys (RFC-004 Phase A — free-tier only, NO billing)
// ---------------------------------------------------------------------------

/** Upsert the per-key, per-month meter by +1. */
export async function incrementKeyUsage(keyId: number, period: string): Promise<void> {
  await db!`
    INSERT INTO api_key_usage (key_id, period, query_count)
    VALUES (${keyId}, ${period}, 1)
    ON CONFLICT (key_id, period)
    DO UPDATE SET query_count = api_key_usage.query_count + 1
  `;
}

/** Current period's query_count for one key (0 if none). */
export async function getKeyUsage(keyId: number, period: string): Promise<number> {
  const rows = await db!<{ query_count: string }[]>`
    SELECT query_count FROM api_key_usage
    WHERE key_id = ${keyId} AND period = ${period}
  `;
  return rows[0] ? Number(rows[0].query_count) : 0;
}

/** Total queries across ALL keys for the period (global free-tier ceiling). */
export async function getGlobalUsage(period: string): Promise<number> {
  const rows = await db!<{ total: string | null }[]>`
    SELECT COALESCE(SUM(query_count), 0) AS total
    FROM api_key_usage
    WHERE period = ${period}
  `;
  return rows[0] ? Number(rows[0].total) : 0;
}

/** Total queries across one owner's keys for the period (per-user cap is per-USER). */
export async function getOwnerUsage(owner: string, period: string): Promise<number> {
  const rows = await db!<{ total: string | null }[]>`
    SELECT COALESCE(SUM(u.query_count), 0) AS total
    FROM api_key_usage u
    JOIN studio_api_keys k ON k.id = u.key_id
    WHERE k.owner_address = ${owner.toLowerCase()} AND u.period = ${period}
  `;
  return rows[0] ? Number(rows[0].total) : 0;
}

// ---------------------------------------------------------------------------
// Bounties
// ---------------------------------------------------------------------------

export async function listBounties(deploymentId?: string): Promise<SyncBounty[]> {
  if (deploymentId) {
    return db!<SyncBounty[]>`
      SELECT * FROM sync_bounties
      WHERE deployment_id = ${deploymentId}
      ORDER BY created_at DESC
    `;
  }
  return db!<SyncBounty[]>`
    SELECT * FROM sync_bounties
    WHERE status IN ('open', 'claimed', 'expired')
    ORDER BY
      CASE status WHEN 'open' THEN 0 WHEN 'claimed' THEN 1 ELSE 2 END,
      amount_grt::numeric DESC,
      created_at DESC
    LIMIT 100
  `;
}

/**
 * Bounties whose cached status may lag the chain — i.e. not yet in a terminal
 * cache state and backed by an on-chain bounty. Used by the reconcile cron.
 */
export async function listReconcilableBounties(): Promise<
  Pick<SyncBounty, 'id' | 'status' | 'chain_bounty_id' | 'claimed_by'>[]
> {
  return db!<Pick<SyncBounty, 'id' | 'status' | 'chain_bounty_id' | 'claimed_by'>[]>`
    SELECT id, status, chain_bounty_id, claimed_by
    FROM sync_bounties
    WHERE status IN ('open', 'claimed')
      AND chain_bounty_id IS NOT NULL
  `;
}

export async function createBounty(data: {
  deployment_id: string;
  subgraph_id?: number | null;
  developer_address: string;
  amount_grt: string;
  message?: string | null;
  expires_at?: string | null;
  chain_bounty_id?: string | null;
  post_tx_hash?: string | null;
}): Promise<SyncBounty> {
  const [row] = await db!<SyncBounty[]>`
    INSERT INTO sync_bounties
      (deployment_id, subgraph_id, developer_address, amount_grt, message, expires_at, chain_bounty_id, post_tx_hash)
    VALUES (
      ${data.deployment_id},
      ${data.subgraph_id ?? null},
      ${data.developer_address.toLowerCase()},
      ${data.amount_grt},
      ${data.message ?? null},
      ${data.expires_at ?? null},
      ${data.chain_bounty_id ?? null},
      ${data.post_tx_hash ?? null}
    )
    RETURNING *
  `;
  return row;
}

export async function getBounty(id: number): Promise<SyncBounty | null> {
  const rows = await db!<SyncBounty[]>`SELECT * FROM sync_bounties WHERE id = ${id}`;
  return rows[0] ?? null;
}

export async function updateBountyStatus(
  id: number,
  status: string,
  claimedBy?: string,
): Promise<void> {
  await db!`
    UPDATE sync_bounties
    SET
      status     = ${status},
      claimed_by = ${claimedBy ?? null},
      claimed_at = ${status === 'claimed' ? new Date().toISOString() : null}
    WHERE id = ${id}
  `;
}

// ---------------------------------------------------------------------------
// Subgraph health alerts (Tier 3 — webhook alerting for subgraph devs)
// ---------------------------------------------------------------------------

/** ALL enabled alerts across every owner — for the cron scan (not owner-scoped). */
/** Update last_status WITHOUT firing — for no-op / unchanged transitions. */
