import { NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { subgraphQuery, hasSubgraphAccess } from '@/lib/subgraph';
import { log } from '@/lib/logger';

interface AllocationSlim {
  id: string;
  queryFeesCollected: string;
  subgraphDeployment: {
    id: string;
    ipfsHash: string;
  };
}

interface DeploymentDetail {
  id: string;
  ipfsHash: string;
  signalledTokens: string;
  stakedTokens: string;
  queryFeesAmount: string;
  indexerAllocations: { id: string }[];
  curatorSignals: { id: string }[];
  versions: { subgraph: { metadata: { displayName: string; categories: string[] | null } | null } }[];
}

interface AggregatedDeployment {
  id: string;
  ipfsHash: string;
  signalledTokens: string;
  stakedTokens: string;
  queryFeesAmount: string;
  queryFees30d: string;
  indexerAllocations: { id: string }[];
  curatorSignals: { id: string }[];
  displayName: string | null;
  categories: string[];
}

/**
 * Fetches all allocations closed in the last 30 days and aggregates
 * query fees per subgraph deployment. Returns deployments sorted by
 * 30-day fees descending.
 *
 * Two-pass approach to avoid expensive nested queries:
 *   1. Lightweight allocation scan (id + fees + deployment id/hash only)
 *   2. Targeted deployment detail fetch for the top results
 */
export async function GET() {
  if (!hasSubgraphAccess()) {
    return NextResponse.json({ error: 'No API key configured' }, { status: 503 });
  }

  const cacheKey = 'lodestar:deployments-fees-30d';

  try {
    const data = await cached(cacheKey, 300, async () => {
      const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 86400;

      // --- Pass 1: lightweight allocation scan ---
      const feesByDeployment = new Map<string, bigint>();
      const ipfsByDeployment = new Map<string, string>();

      let lastId = '';
      while (true) {
        const result = await subgraphQuery<{ allocations: AllocationSlim[] }>(`{
          allocations(
            first: 1000
            orderBy: id
            orderDirection: asc
            where: {
              status: Closed
              closedAt_gte: ${thirtyDaysAgo}
              ${lastId ? `id_gt: "${lastId}"` : ''}
            }
          ) {
            id
            queryFeesCollected
            subgraphDeployment {
              id
              ipfsHash
            }
          }
        }`);

        if (result.allocations.length === 0) break;

        for (const alloc of result.allocations) {
          const depId = alloc.subgraphDeployment.id;
          const fees = BigInt(alloc.queryFeesCollected);
          feesByDeployment.set(depId, (feesByDeployment.get(depId) ?? BigInt(0)) + fees);
          if (!ipfsByDeployment.has(depId)) {
            ipfsByDeployment.set(depId, alloc.subgraphDeployment.ipfsHash);
          }
        }

        lastId = result.allocations[result.allocations.length - 1].id;
        if (result.allocations.length < 1000) break;
      }

      // Sort deployment IDs by 30d fees descending, take top 200
      const sorted = [...feesByDeployment.entries()]
        .sort(([, a], [, b]) => (b > a ? 1 : b < a ? -1 : 0))
        .slice(0, 200);

      if (sorted.length === 0) return [];

      // --- Pass 2: fetch deployment details in batches ---
      const deploymentIds = sorted.map(([id]) => id);
      const detailMap = new Map<string, DeploymentDetail>();
      const BATCH = 100;

      for (let i = 0; i < deploymentIds.length; i += BATCH) {
        const batch = deploymentIds.slice(i, i + BATCH);
        const idList = batch.map((id) => `"${id}"`).join(', ');
        const result = await subgraphQuery<{ subgraphDeployments: DeploymentDetail[] }>(`{
          subgraphDeployments(
            first: ${batch.length}
            where: { id_in: [${idList}] }
          ) {
            id
            ipfsHash
            signalledTokens
            stakedTokens
            queryFeesAmount
            indexerAllocations(where: { status: Active }) { id }
            curatorSignals { id }
            versions(first: 1, orderBy: createdAt, orderDirection: desc) {
              subgraph {
                metadata { displayName categories }
              }
            }
          }
        }`);

        for (const dep of result.subgraphDeployments) {
          detailMap.set(dep.id, dep);
        }
      }

      // --- Assemble results ---
      const aggregated: AggregatedDeployment[] = [];
      for (const [depId, fees30d] of sorted) {
        const dep = detailMap.get(depId);
        if (!dep) continue;
        // Skip dust signal deployments (< 1 GRT)
        if (BigInt(dep.signalledTokens) <= BigInt('1000000000000000000')) continue;

        aggregated.push({
          id: dep.id,
          ipfsHash: dep.ipfsHash,
          signalledTokens: dep.signalledTokens,
          stakedTokens: dep.stakedTokens,
          queryFeesAmount: dep.queryFeesAmount,
          queryFees30d: fees30d.toString(),
          indexerAllocations: dep.indexerAllocations,
          curatorSignals: dep.curatorSignals,
          displayName: dep.versions?.[0]?.subgraph?.metadata?.displayName ?? null,
          categories: dep.versions?.[0]?.subgraph?.metadata?.categories ?? [],
        });
      }

      return aggregated;
    });

    return NextResponse.json({ data }, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch (error) {
    log.api.error({ err: error }, '30-day fees aggregation error');
    return NextResponse.json({ error: 'Failed to compute 30-day fees' }, { status: 500 });
  }
}
