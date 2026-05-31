/**
 * Lodestar metered query gateway — RFC-004 Phase A.
 *
 * NON-CUSTODIAL, FREE-TIER ONLY. This proxy authenticates a Lodestar-issued
 * API key, enforces free-tier monthly limits, and forwards GraphQL queries to
 * The Graph's decentralised network gateway using OUR server-side GRAPH_API_KEY.
 *
 * There is deliberately NO billing here: no GRT balances, no deposits, no
 * custody. Usage is metered purely to enforce free-tier caps:
 *   - per-user cap  (GATEWAY_FREE_TIER_PER_USER, default 5000 / month)
 *   - global ceiling (GATEWAY_FREE_TIER_GLOBAL,  default 90000 / month) = kill switch
 *
 *   POST /api/gateway/<lod_live_...>
 *   Body: { deployment?: string, subgraphId?: string, query: string, variables? }
 *   (exactly one of deployment | subgraphId is required)
 */
import { type NextRequest, NextResponse } from 'next/server';
import { hashApiKey, isValidApiKeyFormat } from '@/lib/studio/api-keys';
import { hasDbAccess } from '@/lib/db';
import {
  findApiKeyByHash,
  getGlobalUsage,
  getOwnerUsage,
  incrementKeyUsage,
} from '@/lib/studio/db';

const GATEWAY = process.env.GRAPH_API_KEY
  ? `https://gateway-arbitrum.network.thegraph.com/api/${process.env.GRAPH_API_KEY}`
  : null;

const PER_USER = process.env.GATEWAY_FREE_TIER_PER_USER
  ? parseInt(process.env.GATEWAY_FREE_TIER_PER_USER, 10)
  : 5000;

const GLOBAL = process.env.GATEWAY_FREE_TIER_GLOBAL
  ? parseInt(process.env.GATEWAY_FREE_TIER_GLOBAL, 10)
  : 90000;

function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;

  // 1. Key format + auth
  if (!isValidApiKeyFormat(key)) {
    return NextResponse.json({ error: 'Invalid API key' }, { status: 401 });
  }
  if (!hasDbAccess()) return NextResponse.json({ error: 'DB unavailable' }, { status: 503 });

  const record = await findApiKeyByHash(hashApiKey(key));
  if (!record || record.status !== 'active') {
    return NextResponse.json({ error: 'Invalid or revoked API key' }, { status: 401 });
  }

  const owner = record.owner_address;
  const period = currentPeriod();

  // 2. Enforce free-tier limits BEFORE forwarding (don't meter rejected calls).
  if ((await getOwnerUsage(owner, period)) >= PER_USER) {
    return NextResponse.json(
      { error: 'Free-tier monthly limit reached', limit: PER_USER, period },
      { status: 429 },
    );
  }
  if ((await getGlobalUsage(period)) >= GLOBAL) {
    // Global kill-switch — protects our upstream GRAPH_API_KEY spend.
    return NextResponse.json(
      { error: 'Gateway free-tier capacity reached, try later', period },
      { status: 429 },
    );
  }

  // 3. Validate target + body.
  if (!GATEWAY) {
    return NextResponse.json({ error: 'Gateway not configured on this server' }, { status: 503 });
  }

  let body: { deployment?: string; subgraphId?: string; query?: string; variables?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { deployment, subgraphId, query, variables } = body ?? {};
  if (typeof query !== 'string' || !query.trim()) {
    return NextResponse.json({ error: 'Missing "query"' }, { status: 400 });
  }
  if (Boolean(deployment) === Boolean(subgraphId)) {
    return NextResponse.json(
      { error: 'Provide exactly one of "deployment" or "subgraphId"' },
      { status: 400 },
    );
  }
  // Validate the identifiers before interpolating into the upstream URL, so a
  // caller can't inject path segments (e.g. "../") to reach other gateway routes.
  // deployment = IPFS CIDv0 (Qm…); subgraphId = 0x… 64-hex (GNS NFT id / subgraph hash).
  if (deployment && !/^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(deployment)) {
    return NextResponse.json({ error: 'Invalid "deployment" — expect an IPFS CIDv0 (Qm…)' }, { status: 400 });
  }
  if (subgraphId && !/^0x[0-9a-fA-F]{64}$/.test(subgraphId)) {
    return NextResponse.json({ error: 'Invalid "subgraphId" — expect 0x… (64 hex)' }, { status: 400 });
  }

  const targetUrl = deployment
    ? `${GATEWAY}/deployments/id/${deployment}`
    : `${GATEWAY}/subgraphs/id/${subgraphId}`;

  // 4. Forward, and meter ONLY on a successful upstream call.
  try {
    const upstream = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await upstream.json();

    if (upstream.ok) {
      await incrementKeyUsage(record.id, period);
    }

    return NextResponse.json(data, { status: upstream.ok ? 200 : upstream.status });
  } catch (err) {
    return NextResponse.json(
      { error: `Gateway error: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }
}
