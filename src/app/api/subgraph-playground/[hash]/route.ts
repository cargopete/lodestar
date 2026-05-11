/**
 * Public proxy for GraphQL queries to a deployment via the Graph gateway.
 *
 * POST /api/subgraph-playground/[hash]  (hash = deployment IPFS CID)
 * Body: { query: string, variables?: object }
 *
 * No auth required — the subgraph data is already public.
 * Uses server-side GRAPH_API_KEY so the key is never exposed to the browser.
 */
import { NextResponse, type NextRequest } from 'next/server';

const GATEWAY = process.env.GRAPH_API_KEY
  ? `https://gateway-arbitrum.network.thegraph.com/api/${process.env.GRAPH_API_KEY}`
  : null;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ hash: string }> },
) {
  if (!GATEWAY) {
    return NextResponse.json({ error: 'Gateway not configured on this server' }, { status: 503 });
  }

  const { hash } = await params;
  if (!hash || hash.length < 10) {
    return NextResponse.json({ error: 'Invalid deployment hash' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const queryUrl = `${GATEWAY}/deployments/id/${hash}`;

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
