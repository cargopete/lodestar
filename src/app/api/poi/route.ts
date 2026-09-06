import { NextResponse, type NextRequest } from 'next/server';
import { cached } from '@/lib/cache';
import { hasNuthatch, nuthatchSqlReady } from '@/lib/nuthatch';
import { poiAllocationsSql } from '@/lib/nest-queries';
import { bytes32ToIpfsHash, ipfsHashToBytes32 } from '@/lib/studio/ipfs';
import { computeOverview, computeDeploymentDetail } from '@/lib/poi';
import type { ClosedAllocation } from '@/lib/poi';
import { log } from '@/lib/logger';

/** The nest carrying the Lodestar views. `/alloc` reverse-proxies to graph-allocations-nest. */
const NEST_BASE_PATH = process.env.NUTHATCH_POI_BASE_PATH || '/alloc';

interface NestPoiAllocation {
  id: string;
  poi: string;
  indexer: string;
  allocated_tokens: string;
  closed_at_epoch: string | number;
  closed_at: number;
  subgraph_deployment: string;
  signalled_tokens: string;
  staked_tokens: string;
}

/**
 * Closed allocations with a real POI from the nest (nightswatchhq/nuthatch#1078), in the exact
 * shape `computeOverview` / `computeDeploymentDetail` read. Measured at a pinned block: the newest
 * 1,000 are the same 1,000 the subgraph returns, and every field the consensus computation uses
 * agrees on all of them.
 *
 * Two things the nest does not carry. The indexer's display name is IPFS metadata, so `account`
 * is empty and the name resolver falls back to the shortened address, as it already does for any
 * indexer without one. And the deployment's `ipfsHash` is not stored, because it is the bytes32 id
 * in another encoding; it is rebuilt here.
 */
async function poiAllocationsFromNest(deployment: string | null): Promise<ClosedAllocation[]> {
  const result = await nuthatchSqlReady<NestPoiAllocation>(poiAllocationsSql(deployment, 1000), NEST_BASE_PATH);
  if (!result.ok) {
    throw Object.assign(new Error(result.error), { nest: result });
  }
  return result.data.rows.map((a) => ({
    id: a.id,
    poi: a.poi,
    indexer: { id: a.indexer.toLowerCase(), account: { defaultDisplayName: null, metadata: null } },
    allocatedTokens: a.allocated_tokens,
    closedAtEpoch: Number(a.closed_at_epoch),
    closedAt: a.closed_at,
    subgraphDeployment: {
      id: a.subgraph_deployment,
      ipfsHash: bytes32ToIpfsHash(a.subgraph_deployment),
      signalledTokens: a.signalled_tokens,
      stakedTokens: a.staked_tokens,
    },
  }));
}

async function getFromNest(deployment: string | null) {
  if (deployment) {
    // A Qm hash is the bytes32 id in another encoding; no lookup is needed to resolve it.
    const deploymentId = deployment.startsWith('Qm') ? ipfsHashToBytes32(deployment) : deployment.toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(deploymentId)) {
      return NextResponse.json({ error: 'Deployment not found' }, { status: 404 });
    }
    const data = await cached(`lodestar:poi:detail:${deploymentId}:nuthatch:v1`, 300, async () =>
      computeDeploymentDetail(await poiAllocationsFromNest(deploymentId)),
    );
    if (!data) {
      return NextResponse.json({ error: 'No POI data for this deployment' }, { status: 404 });
    }
    return NextResponse.json({ data, source: 'nuthatch' }, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
    });
  }
  const data = await cached('lodestar:poi:overview:nuthatch:v1', 300, async () =>
    computeOverview(await poiAllocationsFromNest(null)),
  );
  return NextResponse.json({ data, source: 'nuthatch' }, {
    headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
  });
}

export async function GET(request: NextRequest) {
  const deployment = request.nextUrl.searchParams.get('deployment');

  // From the nest, always (nuthatch#1160). The gateway path this once fell back to left with the key.
  if (!hasNuthatch()) {
    return NextResponse.json({ error: 'Nuthatch is not configured' }, { status: 503 });
  }
  try {
    return await getFromNest(deployment);
  } catch (error) {
    log.api.error({ err: error }, 'POI from the nest failed');
    return NextResponse.json({ error: 'Failed to load POI data from Nuthatch' }, { status: 503 });
  }
}
