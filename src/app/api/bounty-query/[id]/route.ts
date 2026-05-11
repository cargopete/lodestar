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
 *   → proxy to <url>/subgraphs/id/<deploymentId>
 */
import { NextResponse, type NextRequest } from 'next/server';
import { hasDbAccess } from '@/lib/db';
import { getBounty } from '@/lib/studio/db';
import { arbitrumClient } from '@/lib/reo-contract';
import { BOUNTY_BOARD_ABI, SUBGRAPH_SERVICE_ABI } from '@/lib/bountyBoard';
import { subgraphQuery } from '@/lib/subgraph';
import { cached } from '@/lib/cache';
import { ipfsHashToBytes32 } from '@/lib/studio/ipfs';

const BOUNTY_BOARD = (process.env.NEXT_PUBLIC_BOUNTY_BOARD_ADDRESS ?? '0x0000000000000000000000000000000000000000').trim() as `0x${string}`;
const SUBGRAPH_SERVICE = '0xb2Bb92d0DE618878E438b55D5846cfecD9301105' as const;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const GATEWAY = process.env.GRAPH_API_KEY
  ? `https://gateway-arbitrum.network.thegraph.com/api/${process.env.GRAPH_API_KEY}`
  : null;

async function resolveQueryUrl(chainBountyId: string, deploymentId: string): Promise<string | null> {
  return cached(`bounty-query-url:v1:${chainBountyId}`, 3600, async () => {
    // 1. Read winning allocation ID from the BountyBoard contract
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

    // 2. Get the indexer address from SubgraphService
    let indexerAddress: string;
    try {
      const allocation = await arbitrumClient.readContract({
        address: SUBGRAPH_SERVICE,
        abi: SUBGRAPH_SERVICE_ABI,
        functionName: 'getAllocation',
        args: [winner],
      });
      indexerAddress = (allocation.indexer as string).toLowerCase();
    } catch {
      return null;
    }

    if (!indexerAddress || indexerAddress === ZERO_ADDRESS) return null;

    // 3. Look up the winner's public query URL from The Graph network subgraph
    try {
      const data = await subgraphQuery<{ indexer: { url: string | null } | null }>(
        `{ indexer(id: "${indexerAddress}") { url } }`,
      );
      const url = data.indexer?.url;
      if (url) {
        const base = url.endsWith('/') ? url : `${url}/`;
        return `${base}subgraphs/id/${deploymentId}`;
      }
    } catch {
      // fall through to allocation scan
    }

    // 4. Winner has no URL — scan all active allocations for any indexer serving this deployment
    try {
      const deploymentHex = ipfsHashToBytes32(deploymentId);
      const allocData = await subgraphQuery<{
        allocations: Array<{ indexer: { url: string | null } }>;
      }>(`{
        allocations(
          where: { subgraphDeployment: "${deploymentHex}", status: Active }
          first: 10
          orderBy: allocatedTokens
          orderDirection: desc
        ) { indexer { url } }
      }`);
      for (const alloc of allocData.allocations ?? []) {
        const url = alloc.indexer?.url;
        if (url) {
          const base = url.endsWith('/') ? url : `${url}/`;
          return `${base}subgraphs/id/${deploymentId}`;
        }
      }
    } catch {
      // fall through to gateway
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
      { error: 'Bounty not yet claimed — no query endpoint available' },
      { status: 422 },
    );
  }

  if (!bounty.chain_bounty_id) {
    return NextResponse.json({ error: 'No on-chain bounty ID' }, { status: 422 });
  }

  if (BOUNTY_BOARD === ZERO_ADDRESS) {
    return NextResponse.json({ error: 'BountyBoard contract not configured' }, { status: 503 });
  }

  // Try direct indexer URL first, fall back to gateway
  let queryUrl = await resolveQueryUrl(bounty.chain_bounty_id, bounty.deployment_id);
  if (!queryUrl && GATEWAY) {
    queryUrl = `${GATEWAY}/deployments/id/${bounty.deployment_id}`;
  }
  if (!queryUrl) {
    return NextResponse.json(
      { error: 'Could not resolve query endpoint — indexer has no public URL and no gateway key is configured' },
      { status: 502 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

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
      { error: `Upstream error: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }
}
