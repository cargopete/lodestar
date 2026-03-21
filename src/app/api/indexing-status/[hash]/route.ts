import { NextResponse, type NextRequest } from 'next/server';
import { cached } from '@/lib/cache';
import { subgraphQuery, hasSubgraphAccess } from '@/lib/subgraph';
import {
  queryIndexerStatus,
  buildIndexerStatus,
  type DeploymentIndexingStatus,
  type IndexerStatusResult,
} from '@/lib/indexing-status';

// ---------------------------------------------------------------------------
// Subgraph types for allocation + deployment resolution
// ---------------------------------------------------------------------------

interface AllocationIndexer {
  id: string;
  url: string | null;
  account: {
    defaultDisplayName: string | null;
    metadata: {
      displayName: string | null;
    } | null;
  };
}

interface AllocationRow {
  indexer: AllocationIndexer;
  allocatedTokens: string;
}

interface DeploymentRow {
  id: string;
  ipfsHash: string;
  signalledTokens: string;
  stakedTokens: string;
}

// ---------------------------------------------------------------------------
// GraphQL queries
// ---------------------------------------------------------------------------

function resolveDeploymentQuery(ipfsHash: string) {
  return `{
    subgraphDeployments(first: 1, where: { ipfsHash: "${ipfsHash}" }) {
      id
      ipfsHash
      signalledTokens
      stakedTokens
    }
  }`;
}

function allocationsQuery(deploymentId: string) {
  return `{
    allocations(
      first: 100
      where: { subgraphDeployment: "${deploymentId}", status: Active }
      orderBy: allocatedTokens
      orderDirection: desc
    ) {
      indexer {
        id
        url
        account {
          defaultDisplayName
          metadata {
            displayName
          }
        }
      }
      allocatedTokens
    }
  }`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveIndexerName(indexer: AllocationIndexer): string | null {
  return (
    indexer.account?.metadata?.displayName ??
    indexer.account?.defaultDisplayName ??
    null
  );
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ hash: string }> },
) {
  if (!hasSubgraphAccess()) {
    return NextResponse.json({ error: 'No API key configured' }, { status: 503 });
  }

  const { hash } = await params;

  try {
    const data = await cached<DeploymentIndexingStatus>(
      `lodestar:indexing-status:${hash}`,
      60, // Status changes frequently — short TTL
      async () => {
        // 1. Resolve IPFS hash → bytes32 deployment ID
        let deploymentId = hash;
        let ipfsHash = hash;
        let signalledTokens = '0';
        let stakedTokens = '0';

        if (hash.startsWith('Qm') || hash.startsWith('bafy')) {
          const resolved = await subgraphQuery<{
            subgraphDeployments: DeploymentRow[];
          }>(resolveDeploymentQuery(hash));

          if (!resolved.subgraphDeployments.length) {
            throw new Error('Deployment not found');
          }

          const dep = resolved.subgraphDeployments[0];
          deploymentId = dep.id;
          ipfsHash = dep.ipfsHash;
          signalledTokens = dep.signalledTokens;
          stakedTokens = dep.stakedTokens;
        }

        // 2. Fetch indexers with active allocations on this deployment
        const allocResult = await subgraphQuery<{
          allocations: AllocationRow[];
        }>(allocationsQuery(deploymentId));

        const allocations = allocResult.allocations;

        // 3. Query each indexer's /status endpoint in parallel (with timeout)
        const withUrl = allocations.filter((a) => a.indexer.url);
        const withoutUrl = allocations.filter((a) => !a.indexer.url);

        const statusPromises = withUrl.map(async (alloc) => {
          const raw = await queryIndexerStatus(alloc.indexer.url!, ipfsHash);
          return buildIndexerStatus(
            alloc.indexer.id,
            resolveIndexerName(alloc.indexer),
            alloc.indexer.url!,
            alloc.allocatedTokens,
            raw,
          );
        });

        const noUrlStatuses: IndexerStatusResult[] = withoutUrl.map((alloc) => ({
          indexerId: alloc.indexer.id,
          indexerName: resolveIndexerName(alloc.indexer),
          url: '',
          allocatedTokens: alloc.allocatedTokens,
          status: 'unreachable' as const,
        }));

        const indexers = [
          ...(await Promise.all(statusPromises)),
          ...noUrlStatuses,
        ];

        // 4. Aggregate
        const syncedCount = indexers.filter((s) => s.status === 'synced').length;
        const failedCount = indexers.filter((s) => s.status === 'failed').length;
        const unreachableCount = indexers.filter((s) => s.status === 'unreachable').length;
        const healthyCount = indexers.filter((s) => s.health === 'healthy').length;
        const unhealthyCount = indexers.filter((s) => s.health === 'unhealthy').length;

        return {
          deploymentId,
          ipfsHash,
          signalledTokens,
          stakedTokens,
          indexers,
          totalIndexers: indexers.length,
          totalAllocations: allocations.length,
          syncedCount,
          healthyCount,
          unhealthyCount,
          failedCount,
          unreachableCount,
        };
      },
    );

    return NextResponse.json(
      { data },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
        },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (message === 'Deployment not found') {
      return NextResponse.json({ error: 'Deployment not found' }, { status: 404 });
    }
    console.error('Indexing status error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch indexing status' },
      { status: 500 },
    );
  }
}
