import { NextResponse, type NextRequest } from 'next/server';
import { cached } from '@/lib/cache';
import { log } from '@/lib/logger';
import { hasNuthatch, nuthatchSql } from '@/lib/nuthatch';
import { ipfsJson, metadataCid, type VersionMetadataDoc } from '@/lib/subgraph-metadata';
import { bytes32ToIpfsHash, ipfsHashToBytes32 } from '@/lib/studio/ipfs';

const GNS_BASE_PATH = process.env.NUTHATCH_GNS_BASE_PATH || '/gns';
const ALLOC_BASE_PATH = process.env.NUTHATCH_ALLOCATIONS_BASE_PATH || '/alloc';

/**
 * The nest path (nuthatch#1160, group B): the deployment's most recent subgraph from graph-gns-nest,
 * that subgraph's versions with their deployments, each version's label from the IPFS document behind
 * its version-metadata hash, and each deployment's signal and active stake from graph-allocations-nest.
 */
async function versionsFromNest(hash: string): Promise<{ subgraphId: string | null; versions: Array<{ version: number; label: string | null; createdAt: number; ipfsHash: string; signalledTokens: string; stakedTokens: string; isCurrent: boolean }> }> {
  const id = ipfsHashToBytes32(hash).toLowerCase();
  const owner = await nuthatchSql<{ subgraph_id: string }>(
    `SELECT subgraph_id FROM deployment_subgraphs WHERE LOWER(deployment_id) = '${id}' ORDER BY created_at DESC LIMIT 1`, GNS_BASE_PATH);
  const subgraphId = owner[0]?.subgraph_id ?? null;
  if (!subgraphId) return { subgraphId: null, versions: [] };
  const rows = await nuthatchSql<{ deployment_id: string; version_metadata: string | null; version_number: number | string; created_at: number }>(
    `SELECT deployment_id, version_metadata, version_number, created_at FROM subgraph_versions WHERE subgraph_id = '${subgraphId}' ORDER BY version_number DESC LIMIT 100`, GNS_BASE_PATH);
  const deps = [...new Set(rows.map((r) => r.deployment_id.toLowerCase()))];
  const stats = deps.length === 0 ? [] : await nuthatchSql<{ subgraph_deployment: string; signalled_tokens: string | null; staked_tokens: string | null }>(
    `SELECT LOWER(subgraph_deployment) AS subgraph_deployment, CAST(MAX(signalled_tokens) AS VARCHAR) AS signalled_tokens, ` +
    `CAST(COALESCE(SUM(allocated_tokens) FILTER (WHERE status = 'Active'), 0) AS VARCHAR) AS staked_tokens FROM lodestar_allocations ` +
    `WHERE LOWER(subgraph_deployment) IN (${deps.map((d) => `'${d}'`).join(', ')}) GROUP BY 1`, ALLOC_BASE_PATH);
  const statById = new Map(stats.map((s) => [s.subgraph_deployment, s]));
  const versions = await Promise.all(rows.map(async (r) => {
    const cid = metadataCid(r.version_metadata);
    const doc = cid ? await ipfsJson<VersionMetadataDoc>(cid) : null;
    let ipfsHash = r.deployment_id;
    try { ipfsHash = bytes32ToIpfsHash(r.deployment_id); } catch { /* keep */ }
    const st = statById.get(r.deployment_id.toLowerCase());
    return {
      version: Number(r.version_number), label: doc?.label ?? null, createdAt: Number(r.created_at), ipfsHash,
      signalledTokens: st?.signalled_tokens ?? '0', stakedTokens: st?.staked_tokens ?? '0', isCurrent: ipfsHash === hash,
    };
  }));
  return { subgraphId, versions };
}

const IPFS_HASH_RE = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ hash: string }> },
) {
  const { hash } = await params;

  if (!IPFS_HASH_RE.test(hash)) {
    return NextResponse.json({ error: 'Invalid deployment hash' }, { status: 400 });
  }

  // From the nest, always (nuthatch#1160); the gateway path this once fell back to left with the key.
  if (!hasNuthatch()) {
    return NextResponse.json({ error: 'Nuthatch is not configured' }, { status: 503 });
  }
  try {
    const data = await cached(`lodestar:versions:${hash}:nuthatch:v1`, 600, () => versionsFromNest(hash));
    return NextResponse.json({ data, source: 'nuthatch' }, {
      headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=1200' },
    });
  } catch (error) {
    log.api.error({ err: error }, 'Subgraph versions from the nests failed');
    return NextResponse.json({ error: 'Failed to load version history from Nuthatch' }, { status: 503 });
  }
}
