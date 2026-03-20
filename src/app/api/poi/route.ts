import { NextResponse, type NextRequest } from 'next/server';
import { cached } from '@/lib/cache';
import { subgraphQuery, hasSubgraphAccess } from '@/lib/subgraph';
import { computeOverview, computeDeploymentDetail } from '@/lib/poi';
import type { ClosedAllocation } from '@/lib/poi';

interface AllocationsResponse {
  allocations: ClosedAllocation[];
}

const OVERVIEW_QUERY = `{
  allocations(
    first: 1000
    where: { status: Closed, poi_not: "0x0000000000000000000000000000000000000000000000000000000000000000" }
    orderBy: closedAt
    orderDirection: desc
  ) {
    id
    poi
    indexer {
      id
      account {
        defaultDisplayName
        metadata {
          displayName
          description
        }
      }
    }
    allocatedTokens
    closedAtEpoch
    closedAt
    subgraphDeployment {
      id
      ipfsHash
      signalledTokens
      stakedTokens
    }
  }
}`;

function deploymentQuery(deploymentId: string) {
  return `{
    allocations(
      first: 1000
      where: { status: Closed, poi_not: "0x0000000000000000000000000000000000000000000000000000000000000000", subgraphDeployment: "${deploymentId}" }
      orderBy: closedAt
      orderDirection: desc
    ) {
      id
      poi
      indexer {
        id
        account {
          defaultDisplayName
          metadata {
            displayName
            description
          }
        }
      }
      allocatedTokens
      closedAtEpoch
      closedAt
      subgraphDeployment {
        id
        ipfsHash
        signalledTokens
        stakedTokens
      }
    }
  }`;
}

function resolveDeploymentQuery(ipfsHash: string) {
  return `{
    subgraphDeployments(first: 1, where: { ipfsHash: "${ipfsHash}" }) {
      id
    }
  }`;
}

export async function GET(request: NextRequest) {
  if (!hasSubgraphAccess()) {
    return NextResponse.json({ error: 'No API key configured' }, { status: 503 });
  }

  const deployment = request.nextUrl.searchParams.get('deployment');

  try {
    if (deployment) {
      // Deployment detail — resolve ipfsHash to bytes32 ID if needed
      let deploymentId = deployment;
      if (deployment.startsWith('Qm')) {
        const resolved = await cached(
          `lodestar:poi:resolve:${deployment}`,
          86400,
          () => subgraphQuery<{ subgraphDeployments: { id: string }[] }>(resolveDeploymentQuery(deployment)),
        );
        if (!resolved.subgraphDeployments.length) {
          return NextResponse.json({ error: 'Deployment not found' }, { status: 404 });
        }
        deploymentId = resolved.subgraphDeployments[0].id;
      }

      const data = await cached(`lodestar:poi:detail:${deploymentId}`, 300, async () => {
        const result = await subgraphQuery<AllocationsResponse>(deploymentQuery(deploymentId));
        return computeDeploymentDetail(result.allocations);
      });

      if (!data) {
        return NextResponse.json({ error: 'No POI data for this deployment' }, { status: 404 });
      }

      return NextResponse.json({ data }, {
        headers: {
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
        },
      });
    }

    // Overview
    const data = await cached('lodestar:poi:overview', 300, async () => {
      const result = await subgraphQuery<AllocationsResponse>(OVERVIEW_QUERY);
      return computeOverview(result.allocations);
    });

    return NextResponse.json({ data }, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch (error) {
    console.error('POI query error:', error);
    return NextResponse.json({ error: 'Failed to fetch POI data' }, { status: 500 });
  }
}
