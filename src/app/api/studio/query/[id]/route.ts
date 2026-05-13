/**
 * Proxy a GraphQL query for a studio subgraph through the Graph gateway.
 *
 * POST /api/studio/query/[id]  (id = studio DB subgraph id)
 * Body: { query: string, variables?: object }
 *
 * Uses our server-side GRAPH_API_KEY — requires studio session auth so we
 * don't become an open proxy.
 *
 * Routes to:
 *   gateway-arbitrum.../deployments/id/<deployment_ipfs_hash>
 *
 * Works for any deployment the gateway has indexers for — published or not.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { requireAuth } from '@/lib/studio/auth';
import { hasDbAccess } from '@/lib/db';
import { getSubgraphById } from '@/lib/studio/db';

const GATEWAY = process.env.GRAPH_API_KEY
  ? `https://gateway-arbitrum.network.thegraph.com/api/${process.env.GRAPH_API_KEY}`
  : null;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  if (!hasDbAccess()) return NextResponse.json({ error: 'DB unavailable' }, { status: 503 });
  if (!GATEWAY) return NextResponse.json({ error: 'Gateway not configured on this server' }, { status: 503 });

  const { id } = await params;
  const numId = parseInt(id, 10);
  if (isNaN(numId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const sg = await getSubgraphById(numId);
  if (!sg) return NextResponse.json({ error: 'Subgraph not found' }, { status: 404 });
  if (sg.owner_address !== auth.address.toLowerCase()) {
    return NextResponse.json({ error: 'Not your subgraph' }, { status: 403 });
  }
  if (!sg.deployment_id) {
    return NextResponse.json(
      { error: 'No deployment yet — run graph deploy first (step 3)' },
      { status: 422 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const queryUrl = `${GATEWAY}/deployments/id/${sg.deployment_id}`;

  try {
    const upstream = await fetch(queryUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.ok ? 200 : upstream.status });
  } catch (err) {
    return NextResponse.json(
      { error: `Gateway error: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }
}
