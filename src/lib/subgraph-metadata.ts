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
import { bytes32ToIpfsHash, ipfsHashToBytes32, ipfsEndpoint } from './studio/ipfs';
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
  const byId = new Map<string, string>();
  for (const h of ipfsHashes) { try { byId.set(ipfsHashToBytes32(h).toLowerCase(), h); } catch { /* not a CIDv0; no name */ } }
  const meta = await subgraphMetadataForDeployments([...byId.keys()]);
  const out: Record<string, string | null> = {};
  for (const h of ipfsHashes) out[h] = null;
  for (const [id, hash] of byId) out[hash] = meta.get(id)?.metadata?.displayName ?? null;
  return out;
}

/**
 * The raw text behind a CID, for documents that are not JSON: a deployment's manifest (YAML) sits at
 * the deployment's own CID. Cached in `ipfs_metadata.text` under the same rules as `ipfsJson`.
 */
export async function ipfsText(cid: string): Promise<string | null> {
  return cached<string | null>(`ipfs:text:${cid}`, 86400, async () => {
    if (hasDbAccess() && db) {
      const rows = await db<{ text: string | null; error: string | null; fetched_at: Date }[]>`
        SELECT text, error, fetched_at FROM ipfs_metadata WHERE cid = ${cid}
      `;
      const hit = rows[0];
      if (hit && (hit.text !== null || (hit.error && Date.now() - new Date(hit.fetched_at).getTime() < 3600_000))) return hit.text;
    }
    let text: string | null = null; let error: string | null = null;
    try { text = await ipfsCat(cid); } catch (e) { error = e instanceof Error ? e.message : String(e); log.api.warn({ cid, err: error }, 'ipfs fetch failed'); }
    if (hasDbAccess() && db) {
      try {
        await db`
          INSERT INTO ipfs_metadata (cid, text, error, fetched_at) VALUES (${cid}, ${text}, ${error}, NOW())
          ON CONFLICT (cid) DO UPDATE SET text = EXCLUDED.text, error = EXCLUDED.error, fetched_at = NOW()
        `;
      } catch (e) { log.api.warn({ cid, err: e }, 'ipfs cache write failed'); }
    }
    if (error && text === null) throw new Error(error);
    return text;
  }).catch(() => null);
}

export interface ManifestFacts { network: string | null; poweredBySubstreams: boolean }
/** What the pages read off a deployment's manifest: the network, and whether a substreams data source powers it. */
export function manifestFacts(yaml: string | null): ManifestFacts {
  if (!yaml) return { network: null, poweredBySubstreams: false };
  const net = yaml.match(/^\s*network:\s*['"]?([a-zA-Z0-9_-]+)['"]?\s*$/m);
  return { network: net ? net[1] : null, poweredBySubstreams: /kind:\s*['"]?substreams/.test(yaml) };
}

/** Display metadata for many deployments plus each one's manifest facts, for the deployment lists. */
export async function enrichDeployments<T extends { id: string; ipfsHash: string }>(rows: T[], withManifest = false): Promise<Array<T & { displayName: string | null; categories: string[]; description: string | null; subgraphId: string | null; manifest: ManifestFacts | null }>> {
  const meta = await subgraphMetadataForDeployments(rows.map((r) => r.id));
  return Promise.all(rows.map(async (r) => {
    const m = meta.get(r.id.toLowerCase());
    const manifest = withManifest ? manifestFacts(await ipfsText(r.ipfsHash)) : null;
    return { ...r, displayName: m?.metadata?.displayName ?? null, categories: m?.metadata?.categories ?? [], description: m?.metadata?.description ?? null, subgraphId: m?.subgraphId ?? null, manifest };
  }));
}

/**
 * A `lodestar_deployments` row in the shape `api/subgraph-deployments` always returned: wei as strings,
 * `indexerAllocations` and `curatorSignals` as arrays whose lengths are the counts (the pages read
 * `.length` and nothing else off them), and the name and categories off IPFS.
 */
export function deploymentRowToApi(r: { id: string; signalled_tokens: string; staked_tokens: string; query_fees_amount: string; created_at: number | string; active_allocation_count: number | string; curator_count: number | string },
  meta: { displayName: string | null; categories: string[] }) {
  return {
    id: r.id,
    ipfsHash: bytes32ToIpfsHash(r.id),
    signalledTokens: String(r.signalled_tokens),
    stakedTokens: String(r.staked_tokens),
    queryFeesAmount: String(r.query_fees_amount),
    createdAt: Number(r.created_at),
    indexerAllocations: Array.from({ length: Number(r.active_allocation_count) }, (_, i) => ({ id: `${r.id}-${i}` })),
    curatorSignals: Array.from({ length: Number(r.curator_count) }, (_, i) => ({ id: `${r.id}-${i}` })),
    displayName: meta.displayName,
    categories: meta.categories,
  };
}

export interface SearchHit {
  id: string;
  metadata: { displayName: string; description: string | null } | null;
  currentVersion: { subgraphDeployment: { ipfsHash: string; signalledTokens: string; stakedTokens: string } } | null;
}
interface SubgraphCurrentRow { subgraph_id: string; current_deployment_id: string; subgraph_metadata: string | null }
interface DeploymentFiguresRow { id: string; signalled_tokens: string; staked_tokens: string }
const ALLOC_BASE_PATH = process.env.NUTHATCH_ALLOCATIONS_BASE_PATH || '/alloc';

const figuresSql = (ids: string[]) =>
  `SELECT id, CAST(signalled_tokens AS VARCHAR) AS signalled_tokens, CAST(staked_tokens AS VARCHAR) AS staked_tokens FROM lodestar_deployments WHERE id IN (${ids.map((i) => `'${i.toLowerCase()}'`).join(', ')})`;

/** Search hits for a set of deployment ids: each one's most recent subgraph and name, ordered by signal, `limit` of them. */
async function hitsForDeployments(ids: string[], limit: number): Promise<SearchHit[]> {
  if (ids.length === 0) return [];
  const [figures, meta] = await Promise.all([
    nuthatchSql<DeploymentFiguresRow>(figuresSql(ids), ALLOC_BASE_PATH),
    subgraphMetadataForDeployments(ids),
  ]);
  const byId = new Map(figures.map((f) => [f.id.toLowerCase(), f]));
  return ids
    .map((id) => id.toLowerCase())
    .sort((a, b) => { const sa = BigInt(byId.get(a)?.signalled_tokens ?? '0'); const sb = BigInt(byId.get(b)?.signalled_tokens ?? '0'); return sa < sb ? 1 : sa > sb ? -1 : 0; })
    .slice(0, limit)
    .map((id) => {
      const f = byId.get(id); const m = meta.get(id);
      return {
        id: m?.subgraphId ?? id,
        metadata: m?.metadata?.displayName ? { displayName: m.metadata.displayName, description: m.metadata.description ?? null } : null,
        currentVersion: { subgraphDeployment: { ipfsHash: bytes32ToIpfsHash(id), signalledTokens: f?.signalled_tokens ?? '0', stakedTokens: f?.staked_tokens ?? '0' } },
      };
    });
}

/** Deployments whose CIDv0 starts with `prefix`: every deployment with signal or stake, mapped to CIDs, filtered. */
export async function searchDeploymentsByHashPrefix(prefix: string, limit = 10): Promise<SearchHit[]> {
  const ids = await cached<string[]>('lodestar:deployment-ids:v1', 300, async () =>
    (await nuthatchSql<{ id: string }>('SELECT id FROM lodestar_deployments WHERE signalled_tokens > 0 OR staked_tokens > 0', ALLOC_BASE_PATH)).map((r) => r.id.toLowerCase()));
  const matching = ids.filter((id) => { try { return bytes32ToIpfsHash(id).startsWith(prefix); } catch { return false; } });
  return hitsForDeployments(matching, limit);
}

/**
 * Subgraphs whose cached display name contains `q`, by way of Postgres: the IPFS cache holds the
 * metadata documents the lists have already asked for and the warm cron fills the rest, so a name
 * nobody has fetched yet is not findable until the cron has run. Deprecated subgraphs are skipped.
 */
export async function searchSubgraphsByName(q: string, limit = 10): Promise<SearchHit[]> {
  if (!hasDbAccess() || !db) return [];
  const docs = await db<{ cid: string }[]>`
    SELECT cid FROM ipfs_metadata WHERE json->>'displayName' ILIKE ${'%' + q + '%'} LIMIT 500
  `;
  if (docs.length === 0) return [];
  const hashes = docs.map((d) => { try { return ipfsHashToBytes32(d.cid).toLowerCase(); } catch { return null; } }).filter((h): h is string => !!h);
  if (hashes.length === 0) return [];
  const current = await nuthatchSql<SubgraphCurrentRow>(
    `SELECT subgraph_id, current_deployment_id, subgraph_metadata FROM subgraph_current WHERE NOT deprecated AND LOWER(subgraph_metadata) IN (${hashes.map((h) => `'${h}'`).join(', ')})`,
    GNS_BASE_PATH,
  );
  return hitsForDeployments([...new Set(current.map((c) => c.current_deployment_id.toLowerCase()))], limit);
}

/** Deployments whose cached manifest mentions `address`: what `manifest_contains_nocase` did on the gateway. */
export async function searchDeploymentsByManifestAddress(address: string, limit = 20): Promise<SearchHit[]> {
  if (!hasDbAccess() || !db) return [];
  const docs = await db<{ cid: string }[]>`
    SELECT cid FROM ipfs_metadata WHERE text ILIKE ${'%' + address + '%'} LIMIT 200
  `;
  const ids = docs.map((d) => { try { return ipfsHashToBytes32(d.cid).toLowerCase(); } catch { return null; } }).filter((h): h is string => !!h);
  return hitsForDeployments(ids, limit);
}

/**
 * Fill the IPFS cache for search: every live subgraph's metadata document and every signalled or
 * staked deployment's manifest, `budget` fetches per run so a cron stays inside its slot. Returns how
 * many documents were fetched this run and how many are still missing.
 */
export async function warmIpfsCache(budget = 150): Promise<{ fetched: number; remaining: number }> {
  if (!hasDbAccess() || !db) return { fetched: 0, remaining: 0 };
  const [current, deployments] = await Promise.all([
    nuthatchSql<{ subgraph_metadata: string | null }>('SELECT subgraph_metadata FROM subgraph_current WHERE NOT deprecated AND subgraph_metadata IS NOT NULL', GNS_BASE_PATH),
    nuthatchSql<{ id: string }>('SELECT id FROM lodestar_deployments WHERE signalled_tokens > 0 OR staked_tokens > 0', ALLOC_BASE_PATH),
  ]);
  const wantJson = new Set(current.map((c) => metadataCid(c.subgraph_metadata)).filter((c): c is string => !!c));
  const wantText = new Set(deployments.map((d) => { try { return bytes32ToIpfsHash(d.id); } catch { return null; } }).filter((c): c is string => !!c));
  const want = [...wantJson, ...wantText];
  if (want.length === 0) return { fetched: 0, remaining: 0 };
  const have = await db<{ cid: string; json: unknown; text: string | null; error: string | null; fetched_at: Date }[]>`
    SELECT cid, json, text, error, fetched_at FROM ipfs_metadata WHERE cid IN ${db(want)}
  `;
  const recentFailure = (r: { error: string | null; fetched_at: Date }) => !!r.error && Date.now() - new Date(r.fetched_at).getTime() < 3600_000;
  const haveJson = new Set(have.filter((r) => r.json !== null || recentFailure(r)).map((r) => r.cid));
  const haveText = new Set(have.filter((r) => r.text !== null || recentFailure(r)).map((r) => r.cid));
  const todo: Array<() => Promise<unknown>> = [];
  for (const c of wantJson) if (!haveJson.has(c)) todo.push(() => ipfsJson(c));
  for (const c of wantText) if (!haveText.has(c)) todo.push(() => ipfsText(c));
  const batch = todo.slice(0, budget);
  for (let i = 0; i < batch.length; i += 10) await Promise.all(batch.slice(i, i + 10).map((f) => f()));
  return { fetched: batch.length, remaining: todo.length - batch.length };
}
