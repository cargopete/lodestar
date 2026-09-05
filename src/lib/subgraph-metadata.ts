/**
 * What a subgraph is called, off the gateway (nightswatchhq/nuthatch#1160, group B).
 *
 * On chain there is a bytes32 per subgraph (`SubgraphMetadataUpdated`) and per version
 * (`SubgraphVersionUpdated`); the name, description, image, repository and website behind it are a
 * JSON document on IPFS. `graph-gns-nest` carries the hashes (`subgraph_current`,
 * `deployment_subgraphs`, `account_default_names`); this module fetches the documents from the IPFS
 * API Lodestar already uses for uploads and keeps them in Postgres, because IPFS is slow, the
 * documents are immutable (a hash is its content), and nuthatch will never fetch IPFS itself.
 *
 * Every function here fails open on a name: a fetch that fails leaves the name null and records the
 * error against the hash, so the page shows the address rather than a wrong name, and the next run
 * tries again. Nothing here touches `GRAPH_API_KEY`.
 */
import { db, hasDbAccess } from './db';
import { cached } from './cache';
import { nuthatchSql } from './nuthatch';
import { bytes32ToIpfsHash, ipfsEndpoint } from './studio/ipfs';
import { log } from './logger';

const GNS_BASE_PATH = process.env.NUTHATCH_GNS_BASE_PATH || '/gns';

export interface SubgraphMetadataDoc {
  displayName?: string | null;
  description?: string | null;
  image?: string | null;
  codeRepository?: string | null;
  website?: string | null;
  categories?: string[] | null;
}
export interface VersionMetadataDoc {
  label?: string | null;
  description?: string | null;
}

/** The IPFS API's `cat`, which The Graph's endpoint serves on POST. Throws on a non-2xx or a timeout. */
export async function ipfsCat(cid: string, timeoutMs = 8000): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${ipfsEndpoint()}/api/v0/cat?arg=${encodeURIComponent(cid)}`, { method: 'POST', signal: ctrl.signal });
    if (!res.ok) throw new Error(`ipfs cat ${cid}: HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

/**
 * The JSON document behind a CID, from Postgres if it has been seen, else from IPFS and then into
 * Postgres. A document that failed to fetch is recorded with its error and retried on the next ask
 * after an hour; a document that fetched but is not JSON is recorded as such and not retried.
 */
export async function ipfsJson<T = Record<string, unknown>>(cid: string): Promise<T | null> {
  return cached<T | null>(`ipfs:json:${cid}`, 86400, async () => {
    if (hasDbAccess() && db) {
      const rows = await db<{ json: T | null; error: string | null; fetched_at: Date }[]>`
        SELECT json, error, fetched_at FROM ipfs_metadata WHERE cid = ${cid}
      `;
      const hit = rows[0];
      if (hit && (hit.json !== null || (hit.error && Date.now() - new Date(hit.fetched_at).getTime() < 3600_000))) {
        return hit.json;
      }
    }
    let json: T | null = null;
    let error: string | null = null;
    try {
      const text = await ipfsCat(cid);
      try { json = JSON.parse(text) as T; } catch { error = 'not json'; }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      log.api.warn({ cid, err: error }, 'ipfs fetch failed');
    }
    if (hasDbAccess() && db) {
      try {
        await db`
          INSERT INTO ipfs_metadata (cid, json, error, fetched_at) VALUES (${cid}, ${json === null ? null : JSON.stringify(json)}::jsonb, ${error}, NOW())
          ON CONFLICT (cid) DO UPDATE SET json = EXCLUDED.json, error = EXCLUDED.error, fetched_at = NOW()
        `;
      } catch (e) {
        log.api.warn({ cid, err: e }, 'ipfs cache write failed');
      }
    }
    if (error && json === null) throw new Error(error); // `cached()` does not memoise a rejection
    return json;
  }).catch(() => null);
}

/** A bytes32 metadata hash to its CIDv0, or null for the zero hash a subgraph without metadata carries. */
export function metadataCid(hash: string | null | undefined): string | null {
  if (!hash) return null;
  const hex = hash.toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{64}$/.test(hex) || /^0+$/.test(hex)) return null;
  try { return bytes32ToIpfsHash(`0x${hex}`); } catch { return null; }
}

interface DeploymentSubgraphRow { deployment_id: string; subgraph_id: string; subgraph_metadata: string | null; version_metadata: string | null; is_current: boolean; version_number: number | string; deprecated: boolean }

/**
 * For each deployment, the subgraph that most recently published it and that subgraph's metadata
 * document, which is what `subgraphDeployment.versions[0].subgraph.metadata` was on the gateway path.
 */
export async function subgraphMetadataForDeployments(deploymentIds: string[]): Promise<Map<string, { subgraphId: string; metadata: SubgraphMetadataDoc | null; version: VersionMetadataDoc | null }>> {
  const out = new Map<string, { subgraphId: string; metadata: SubgraphMetadataDoc | null; version: VersionMetadataDoc | null }>();
  const ids = [...new Set(deploymentIds.map((d) => d.toLowerCase()))];
  if (ids.length === 0) return out;
  const list = ids.map((d) => `'${d}'`).join(', ');
  const rows = await nuthatchSql<DeploymentSubgraphRow>(
    `SELECT deployment_id, subgraph_id, subgraph_metadata, version_metadata, is_current, version_number, deprecated FROM (` +
    `SELECT *, ROW_NUMBER() OVER (PARTITION BY LOWER(deployment_id) ORDER BY created_at DESC) AS rn FROM deployment_subgraphs WHERE LOWER(deployment_id) IN (${list})) WHERE rn = 1`,
    GNS_BASE_PATH,
  );
  await Promise.all(rows.map(async (r) => {
    const [metadata, version] = await Promise.all([
      (async () => { const c = metadataCid(r.subgraph_metadata); return c ? ipfsJson<SubgraphMetadataDoc>(c) : null; })(),
      (async () => { const c = metadataCid(r.version_metadata); return c ? ipfsJson<VersionMetadataDoc>(c) : null; })(),
    ]);
    out.set(r.deployment_id.toLowerCase(), { subgraphId: r.subgraph_id, metadata, version });
  }));
  return out;
}

/** Display names for deployments, the shape `api/subgraph-names` returns: `{ [ipfsHash]: displayName }`. */
export async function displayNamesForDeployments(ipfsHashes: string[]): Promise<Record<string, string | null>> {
  const { ipfsHashToBytes32 } = await import('./studio/ipfs');
  const byId = new Map<string, string>();
  for (const h of ipfsHashes) { try { byId.set(ipfsHashToBytes32(h).toLowerCase(), h); } catch { /* not a CIDv0; no name */ } }
  const meta = await subgraphMetadataForDeployments([...byId.keys()]);
  const out: Record<string, string | null> = {};
  for (const h of ipfsHashes) out[h] = null;
  for (const [id, hash] of byId) out[hash] = meta.get(id)?.metadata?.displayName ?? null;
  return out;
}
