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

export interface StudioApiKey {
  id: number;
  owner_address: string;
  label: string | null;
  key_hash: string;
  key_prefix: string;
  status: 'active' | 'revoked';
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
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

export interface SubgraphAlert {
  id: number;
  owner_address: string;
  deployment_id: string;
  label: string | null;
  webhook_url: string;
  channel: string; // 'discord' | 'slack' | 'webhook'
  lag_threshold_blocks: string; // BIGINT comes back as string
  enabled: boolean;
  created_at: string;
  last_alerted_at: string | null;
  last_status: string | null; // 'ok' | 'lagging' | 'failed' | null
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

export async function listApiKeys(owner: string): Promise<StudioApiKey[]> {
  return db!<StudioApiKey[]>`
    SELECT * FROM studio_api_keys
    WHERE owner_address = ${owner.toLowerCase()}
    ORDER BY created_at DESC
  `;
}

export async function createApiKey(
  owner: string,
  label: string | null,
  keyHash: string,
  keyPrefix: string,
): Promise<StudioApiKey> {
  const [row] = await db!<StudioApiKey[]>`
    INSERT INTO studio_api_keys (owner_address, label, key_hash, key_prefix)
    VALUES (${owner.toLowerCase()}, ${label}, ${keyHash}, ${keyPrefix})
    RETURNING *
  `;
  return row;
}

export async function revokeApiKey(id: number, owner: string): Promise<void> {
  await db!`
    UPDATE studio_api_keys
    SET status = 'revoked', revoked_at = NOW()
    WHERE id = ${id} AND owner_address = ${owner.toLowerCase()}
  `;
}

/**
 * Look up a key by its hash for proxy auth, bumping last_used_at.
 * Returns the id/owner/status (caller checks status === 'active').
 */
export async function findApiKeyByHash(
  keyHash: string,
): Promise<{ id: number; owner_address: string; status: string } | null> {
  const rows = await db!<{ id: number; owner_address: string; status: string }[]>`
    SELECT id, owner_address, status
    FROM studio_api_keys
    WHERE key_hash = ${keyHash}
  `;
  if (!rows[0]) return null;
  await db!`UPDATE studio_api_keys SET last_used_at = NOW() WHERE key_hash = ${keyHash}`;
  return rows[0];
}

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

export async function listAlerts(owner: string): Promise<SubgraphAlert[]> {
  return db!<SubgraphAlert[]>`
    SELECT * FROM subgraph_alerts
    WHERE owner_address = ${owner.toLowerCase()}
    ORDER BY created_at DESC
  `;
}

/**
 * Insert an alert, or — if the owner already has one for this deployment —
 * edit it in place (re-adding acts as an update). Returns the row.
 */
export async function createAlert(
  owner: string,
  deploymentId: string,
  label: string | null,
  webhookUrl: string,
  channel: string,
  lagThreshold: number,
): Promise<SubgraphAlert> {
  const [row] = await db!<SubgraphAlert[]>`
    INSERT INTO subgraph_alerts
      (owner_address, deployment_id, label, webhook_url, channel, lag_threshold_blocks)
    VALUES (
      ${owner.toLowerCase()},
      ${deploymentId},
      ${label},
      ${webhookUrl},
      ${channel},
      ${lagThreshold}
    )
    ON CONFLICT (owner_address, deployment_id)
    DO UPDATE SET
      label                = EXCLUDED.label,
      webhook_url          = EXCLUDED.webhook_url,
      channel              = EXCLUDED.channel,
      lag_threshold_blocks = EXCLUDED.lag_threshold_blocks,
      enabled              = true
    RETURNING *
  `;
  return row;
}

export async function deleteAlert(id: number, owner: string): Promise<void> {
  await db!`
    DELETE FROM subgraph_alerts
    WHERE id = ${id} AND owner_address = ${owner.toLowerCase()}
  `;
}

export async function setAlertEnabled(
  id: number,
  owner: string,
  enabled: boolean,
): Promise<void> {
  await db!`
    UPDATE subgraph_alerts
    SET enabled = ${enabled}
    WHERE id = ${id} AND owner_address = ${owner.toLowerCase()}
  `;
}

export async function getAlert(id: number, owner: string): Promise<SubgraphAlert | null> {
  const rows = await db!<SubgraphAlert[]>`
    SELECT * FROM subgraph_alerts
    WHERE id = ${id} AND owner_address = ${owner.toLowerCase()}
  `;
  return rows[0] ?? null;
}

/** ALL enabled alerts across every owner — for the cron scan (not owner-scoped). */
export async function listEnabledAlerts(): Promise<SubgraphAlert[]> {
  return db!<SubgraphAlert[]>`
    SELECT * FROM subgraph_alerts
    WHERE enabled = true
    ORDER BY id ASC
  `;
}

/**
 * Record that we actually fired a webhook: bump last_alerted_at / last_status
 * on the config row AND append a log entry. Used for lagging/failed/recovered.
 */
export async function recordAlertFire(
  id: number,
  status: string,
  detail: string | null,
): Promise<void> {
  await db!`
    UPDATE subgraph_alerts
    SET last_alerted_at = NOW(), last_status = ${status}
    WHERE id = ${id}
  `;
  await db!`
    INSERT INTO subgraph_alert_log (alert_id, status, detail)
    VALUES (${id}, ${status}, ${detail})
  `;
}

/** Update last_status WITHOUT firing — for no-op / unchanged transitions. */
export async function updateAlertStatus(id: number, status: string): Promise<void> {
  await db!`
    UPDATE subgraph_alerts
    SET last_status = ${status}
    WHERE id = ${id}
  `;
}
