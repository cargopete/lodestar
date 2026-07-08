import { NextResponse, type NextRequest } from 'next/server';
import { cached } from '@/lib/cache';
import { subgraphQuery, hasSubgraphAccess } from '@/lib/subgraph';
import {
  queryIndexerStatus,
  buildIndexerStatus,
  reconcileToNetworkHead,
  probeServing,
  withServeProbe,
  type DeploymentIndexingStatus,
  type IndexerStatusResult,
} from '@/lib/indexing-status';
import { assessServability } from '@/lib/servability';
import { log } from '@/lib/logger';

// probeServing resolves DNS (node:dns); this route must run on Node, not Edge.
export const runtime = 'nodejs';

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
  versions: { subgraph: { metadata: { displayName: string } | null } }[];
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
      versions(first: 1, orderBy: createdAt, orderDirection: desc) {
        subgraph { metadata { displayName } }
      }
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
        let displayName: string | null = null;

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
          displayName = dep.versions?.[0]?.subgraph?.metadata?.displayName ?? null;
        }

        // 2. Fetch indexers with active allocations on this deployment
        const allocResult = await subgraphQuery<{
          allocations: AllocationRow[];
        }>(allocationsQuery(deploymentId));

        const allocations = allocResult.allocations;

        // 3. Query each indexer's /status endpoint in parallel (with timeout)
        const withUrl = allocations.filter((a) => a.indexer.url);
        const withoutUrl = allocations.filter((a) => !a.indexer.url);

        // /status (is it indexing?) and the serving probe (does the paid path
        // answer right now? — RFC-006 D1) in parallel, per indexer.
        const statusPromises = withUrl.map(async (alloc) => {
          const [raw, probe] = await Promise.all([
            queryIndexerStatus(alloc.indexer.url!, ipfsHash),
            // indexer.id is the on-chain address — enables a paid (receipt-backed)
            // probe where escrow is funded, else falls back to receipt-less.
            probeServing(alloc.indexer.url!, ipfsHash, alloc.indexer.id),
          ]);
          const built = buildIndexerStatus(
            alloc.indexer.id,
            resolveIndexerName(alloc.indexer),
            alloc.indexer.url!,
            alloc.allocatedTokens,
            raw,
          );
          return withServeProbe(built, probe);
        });

        const noUrlStatuses: IndexerStatusResult[] = withoutUrl.map((alloc) => ({
          indexerId: alloc.indexer.id,
          indexerName: resolveIndexerName(alloc.indexer),
          url: '',
          allocatedTokens: alloc.allocatedTokens,
          status: 'unreachable' as const,
          serveProbe: 'unreachable',
          servable: false,
        }));

        // Reconcile each indexer's lag against the freshest peer's head, so an
        // indexer with a stalled firehose (self-diff ≈ 0) doesn't read as
        // "caught up" while being tens of thousands of blocks behind the chain.
        const indexers = reconcileToNetworkHead([
          ...(await Promise.all(statusPromises)),
          ...noUrlStatuses,
        ]);

        // 4. Aggregate
        const syncedCount = indexers.filter((s) => s.status === 'synced').length;
        const failedCount = indexers.filter((s) => s.status === 'failed').length;
        const unreachableCount = indexers.filter((s) => s.status === 'unreachable').length;
        const healthyCount = indexers.filter((s) => s.health === 'healthy').length;
        const unhealthyCount = indexers.filter((s) => s.health === 'unhealthy').length;

        // RFC-006 D2 — live serving verdict over the allocated set. Each indexer
        // is its own operator for now; clustering (D4) can collapse identities
        // later. This is the instantaneous read; persistence is a D5 concern.
        const servability = assessServability(
          indexers.map((i) => ({
            indexerId: i.indexerId,
            servable: !!i.servable,
            status: i.status,
            allocatedTokens: i.allocatedTokens,
          })),
        );

        return {
          deploymentId,
          ipfsHash,
          displayName,
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
          servability,
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
    log.api.error({ err: error }, 'Indexing status error');
    return NextResponse.json(
      { error: 'Failed to fetch indexing status' },
      { status: 500 },
    );
  }
}
