/**
 * Lightweight graph-node stub for `graph deploy`.
 *
 * graph-cli sends JSON-RPC to this endpoint:
 *   Authorization: Bearer <deploy-key>
 *
 * We validate the key and record the IPFS hash — no real graph-node involved.
 * Subgraphs are deployed directly to The Graph's decentralised network via the
 * Publish flow (GNS.publishNewSubgraph), not to a private node.
 *
 * Methods: subgraph_create (acknowledge), subgraph_deploy (record IPFS hash)
 */
import { type NextRequest, NextResponse } from 'next/server';
import { hashKey } from '@/lib/studio/auth';
import { hasDbAccess } from '@/lib/db';
import { findOwnerByKeyHash, getSubgraphBySlug, updateSubgraphDeployment } from '@/lib/studio/db';

const ALLOWED_METHODS = new Set(['subgraph_create', 'subgraph_deploy']);

async function extractBearerKey(req: NextRequest): Promise<string | null> {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return null;
  return auth.slice(7).trim() || null;
}

export async function POST(req: NextRequest) {
  if (!hasDbAccess()) return NextResponse.json({ error: 'DB unavailable' }, { status: 503 });

  const plainKey = await extractBearerKey(req);
  if (!plainKey) return rpcError(-32600, 'Missing deploy key');

  const owner = await findOwnerByKeyHash(hashKey(plainKey));
  if (!owner) return rpcError(-32600, 'Invalid deploy key');

  const body = await req.json().catch(() => null);
  if (!body || body.jsonrpc !== '2.0' || !body.method) {
    return rpcError(-32600, 'Invalid JSON-RPC request');
  }

  if (!ALLOWED_METHODS.has(body.method)) {
    return rpcError(-32601, `Method not allowed: ${body.method}`);
  }

  const name: string = body.params?.name ?? '';
  if (!name) return rpcError(-32602, 'Missing subgraph name');

  const subgraph = await getSubgraphBySlug(name);
  if (!subgraph) return rpcError(-32602, `Subgraph "${name}" not registered`);
  if (subgraph.owner_address !== owner) return rpcError(-32602, 'Not your subgraph');

  if (body.method === 'subgraph_deploy') {
    const ipfsHash: string = body.params?.ipfs_hash ?? '';
    const network: string | null = body.params?.network ?? null;
    if (ipfsHash) {
      await updateSubgraphDeployment(name, ipfsHash, network).catch(() => {});
    }
    const explorerBase = 'https://thegraph.com/explorer/subgraphs';
    return NextResponse.json({
      jsonrpc: '2.0',
      result: {
        errors: [],
        warnings: [],
        playground: `${explorerBase}/${name}`,
        queries: `${explorerBase}/${name}`,
        subscriptions: `${explorerBase}/${name}`,
      },
      id: body.id ?? null,
    });
  }

  // subgraph_create — just acknowledge
  return NextResponse.json({ jsonrpc: '2.0', result: null, id: body.id ?? null });
}

function rpcError(code: number, message: string) {
  return NextResponse.json(
    { jsonrpc: '2.0', error: { code, message }, id: null },
    { status: 400 },
  );
}
