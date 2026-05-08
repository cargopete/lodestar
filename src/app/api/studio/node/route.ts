/**
 * Graph-node admin API proxy for `graph deploy`.
 *
 * graph-cli sends JSON-RPC to this endpoint with:
 *   Authorization: Bearer <deploy-key>
 *
 * We validate the key, enforce slug ownership, then forward to the
 * graph-node admin API (GRAPH_NODE_ADMIN_URL).
 *
 * Methods handled: subgraph_create, subgraph_deploy
 * All other methods are blocked.
 */
import { type NextRequest, NextResponse } from 'next/server';
import { hashKey } from '@/lib/studio/auth';
import { hasDbAccess } from '@/lib/db';
import { findOwnerByKeyHash, getSubgraphBySlug, updateSubgraphDeployment } from '@/lib/studio/db';

const ALLOWED_METHODS = new Set(['subgraph_create', 'subgraph_deploy']);
const NODE_ID = 'index_node_0';

function adminUrl(): string {
  const u = process.env.GRAPH_NODE_ADMIN_URL;
  if (!u) throw new Error('GRAPH_NODE_ADMIN_URL not configured');
  return u;
}

async function extractBearerKey(req: NextRequest): Promise<string | null> {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return null;
  return auth.slice(7).trim() || null;
}

export async function POST(req: NextRequest) {
  if (!hasDbAccess()) return NextResponse.json({ error: 'DB unavailable' }, { status: 503 });

  // --- Auth ---
  const plainKey = await extractBearerKey(req);
  if (!plainKey) return rpcError(-32600, 'Missing deploy key');

  const owner = await findOwnerByKeyHash(hashKey(plainKey));
  if (!owner) return rpcError(-32600, 'Invalid deploy key');

  // --- Parse RPC body ---
  const body = await req.json().catch(() => null);
  if (!body || body.jsonrpc !== '2.0' || !body.method) {
    return rpcError(-32600, 'Invalid JSON-RPC request');
  }

  if (!ALLOWED_METHODS.has(body.method)) {
    return rpcError(-32601, `Method not allowed: ${body.method}`);
  }

  const name: string = body.params?.name ?? '';
  if (!name) return rpcError(-32602, 'Missing subgraph name');

  // Verify this slug belongs to the authenticated developer
  const subgraph = await getSubgraphBySlug(name);
  if (!subgraph) return rpcError(-32602, `Subgraph "${name}" not registered in Lodestar Studio`);
  if (subgraph.owner_address !== owner) return rpcError(-32602, 'Not your subgraph');

  // For subgraph_deploy, enforce our node_id
  const forwardBody = { ...body };
  if (body.method === 'subgraph_deploy' && forwardBody.params) {
    forwardBody.params = { ...forwardBody.params, node_id: NODE_ID };
  }

  // --- Forward to graph-node ---
  let nodeRes: Response;
  try {
    nodeRes = await fetch(adminUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(forwardBody),
    });
  } catch (err) {
    return rpcError(-32603, `Cannot reach graph-node: ${err}`);
  }

  const result = await nodeRes.json();

  // Update our registry with the new deployment ID after a successful deploy
  if (
    body.method === 'subgraph_deploy' &&
    result.result?.deployment &&
    !result.error
  ) {
    const ipfsHash = body.params?.ipfs_hash ?? '';
    const network = body.params?.network ?? null;
    if (ipfsHash) {
      await updateSubgraphDeployment(name, ipfsHash, network).catch(() => {});
    }
  }

  return NextResponse.json(result, { status: nodeRes.status });
}

function rpcError(code: number, message: string) {
  return NextResponse.json(
    { jsonrpc: '2.0', error: { code, message }, id: null },
    { status: 400 },
  );
}
