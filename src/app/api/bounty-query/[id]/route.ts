/**
 * Proxy a GraphQL query to the winning indexer's query endpoint.
 *
 * POST /api/bounty-query/[id]
 * Body: { query: string, variables?: object, operationName?: string }
 *
 * Resolution chain:
 *   DB bounty → chain BountyBoard.getBounty() → winner allocation ID
 *   → SubgraphService.getAllocation() → indexer address
 *   → Graph network subgraph → indexer.url
 *   → proxy to <url>/subgraphs/id/<deploymentId> with TAP receipt
 *
 * For published subgraphs the gateway serves them directly (no TAP needed on
 * our side). For unpublished bounty deployments we go direct-to-indexer and
 * attach a TAP v2 receipt so the indexer-service accepts the query.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { hasDbAccess } from '@/lib/db';
import { getBounty } from '@/lib/studio/db';
import { arbitrumClient } from '@/lib/reo-contract';
import { BOUNTY_BOARD_ABI } from '@/lib/bountyBoard';
import { subgraphQuery } from '@/lib/subgraph';
import { cached } from '@/lib/cache';
import { ipfsHashToBytes32 } from '@/lib/studio/ipfs';
import { signTapReceipt, hasTapSigner } from '@/lib/tap';

const BOUNTY_BOARD = (process.env.NEXT_PUBLIC_BOUNTY_BOARD_ADDRESS ?? '0x0000000000000000000000000000000000000000').trim() as `0x${string}`;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const GATEWAY = process.env.GRAPH_API_KEY
  ? `https://gateway-arbitrum.network.thegraph.com/api/${process.env.GRAPH_API_KEY}`
  : null;
// Direct graph-node query endpoint (bypasses TAP — our node only).
// Basic auth: GRAPH_NODE_FREE_QUERY_KEY = "user:password"
const GRAPH_NODE_FREE_QUERY_BASE = process.env.GRAPH_NODE_FREE_QUERY_KEY
  ? 'https://indexer.lodestar-dashboard.com/free-query'
  : null;

interface ResolvedEndpoint {
  url: string;
  /** Indexer address to sign the TAP receipt for; null when routing via gateway. */
  indexerAddress: string | null;
}

async function resolveEndpoint(chainBountyId: string, deploymentId: string): Promise<ResolvedEndpoint | null> {
  // Cache the resolved endpoint for 1 hour. Null values are not cached by
  // `cached()` so a failed resolution is retried on the next request.
  return cached(`bounty-query-url:v2:${chainBountyId}`, 3600, async () => {
    // 1. Read winning allocation ID from the BountyBoard contract.
    let winner: `0x${string}`;
    try {
      const bountyData = await arbitrumClient.readContract({
        address: BOUNTY_BOARD,
        abi: BOUNTY_BOARD_ABI,
        functionName: 'getBounty',
        args: [BigInt(chainBountyId)],
      });
      winner = bountyData.winner as `0x${string}`;
    } catch {
      return null;
    }

    if (!winner || winner.toLowerCase() === ZERO_ADDRESS) return null;

    // 2. The BountyBoard resolves the allocation to the indexer internally and
    //    stores the indexer address directly as `winner` — use it as-is.
    const indexerAddress = winner.toLowerCase();

    // 3. Look up the winner's public query URL from The Graph network subgraph.
    try {
      const data = await subgraphQuery<{ indexer: { url: string | null } | null }>(
        `{ indexer(id: "${indexerAddress}") { url } }`,
      );
      const url = data.indexer?.url;
      if (url) {
        const base = url.endsWith('/') ? url : `${url}/`;
        return { url: `${base}subgraphs/id/${deploymentId}`, indexerAddress };
      }
    } catch {
      // fall through to allocation scan
    }

    // 4. Winner has no URL — scan all active allocations for any indexer serving this deployment.
    try {
      const deploymentHex = ipfsHashToBytes32(deploymentId);
      const allocData = await subgraphQuery<{
        allocations: Array<{ indexer: { id: string; url: string | null } }>;
      }>(`{
        allocations(
          where: { subgraphDeployment: "${deploymentHex}", status: Active }
          first: 10
          orderBy: allocatedTokens
          orderDirection: desc
        ) { indexer { id url } }
      }`);
      for (const alloc of allocData.allocations ?? []) {
        const url = alloc.indexer?.url;
        if (url) {
          const base = url.endsWith('/') ? url : `${url}/`;
          return {
            url: `${base}subgraphs/id/${deploymentId}`,
            indexerAddress: alloc.indexer.id.toLowerCase(),
          };
        }
      }
    } catch {
      // fall through — no direct indexer found
    }

    return null;
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const numId = parseInt(id, 10);
  if (isNaN(numId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  if (!hasDbAccess()) return NextResponse.json({ error: 'DB unavailable' }, { status: 503 });

  const bounty = await getBounty(numId);
  if (!bounty) return NextResponse.json({ error: 'Bounty not found' }, { status: 404 });

  if (bounty.status !== 'claimed') {
    return NextResponse.json(
      { error: 'Bounty not yet claimed, so no query endpoint is available' },
      { status: 422 },
    );
  }

  if (!bounty.chain_bounty_id) {
    return NextResponse.json({ error: 'No on-chain bounty ID' }, { status: 422 });
  }

  if (BOUNTY_BOARD === ZERO_ADDRESS) {
    return NextResponse.json({ error: 'BountyBoard contract not configured' }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Try our own graph-node directly (no TAP required, basicAuth only).
  // This works for any deployment our node is syncing and avoids TAP v2 complexity.
  if (GRAPH_NODE_FREE_QUERY_BASE && process.env.GRAPH_NODE_FREE_QUERY_KEY) {
    const freeUrl = `${GRAPH_NODE_FREE_QUERY_BASE}/subgraphs/id/${bounty.deployment_id}`;
    const authHeader = `Basic ${Buffer.from(process.env.GRAPH_NODE_FREE_QUERY_KEY.trim()).toString('base64')}`;
    try {
      const upstream = await fetch(freeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      if (upstream.ok) {
        const data = await upstream.json();
        return NextResponse.json(data);
      }
      // Non-200 means our node isn't serving this deployment — fall through.
    } catch {
      // Network error — fall through.
    }
  }

  // Try direct indexer routing (with TAP receipt for unpublished deployments).
  const endpoint = await resolveEndpoint(bounty.chain_bounty_id, bounty.deployment_id);

  if (endpoint) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    // Attach a TAP receipt so the indexer-service accepts our query.
    // The payer (TAP_SIGNER_PRIVATE_KEY) must have escrow with this indexer.
    // Published subgraphs also benefit from this path when an indexer URL is known.
    if (hasTapSigner() && endpoint.indexerAddress) {
      try {
        const receipt = await signTapReceipt(endpoint.indexerAddress);
        if (receipt) headers['TAP-Receipt'] = receipt;
      } catch {
        // signing failed — try without receipt (indexer may reject, will fall back below)
      }
    }

    try {
      const upstream = await fetch(endpoint.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      const data = await upstream.json();
      // If indexer rejected due to missing/invalid receipt, fall through to gateway.
      if (!upstream.ok && upstream.status === 402) {
        // payment required — fall through
      } else {
        return NextResponse.json(data, { status: upstream.ok ? 200 : upstream.status });
      }
    } catch {
      // network error — try gateway
    }
  }

  // Gateway fallback — works for published (signalled) subgraphs.
  // Unpublished bounty deployments will get "subgraph not found" from the gateway.
  if (GATEWAY) {
    const gatewayUrl = `${GATEWAY}/deployments/id/${bounty.deployment_id}`;
    try {
      const upstream = await fetch(gatewayUrl, {
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

  return NextResponse.json(
    { error: 'Could not resolve query endpoint: no direct indexer URL and no gateway key configured' },
    { status: 502 },
  );
}
