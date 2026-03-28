import { NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { subgraphQuery, hasSubgraphAccess } from '@/lib/subgraph';

interface AllocationRaw {
  id: string;
  queryFeesCollected: string;
  subgraphDeployment: {
    id: string;
    ipfsHash: string;
    signalledTokens: string;
    stakedTokens: string;
    queryFeesAmount: string;
    indexerAllocations: { id: string }[];
    curatorSignals: { id: string }[];
  };
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
}

/**
 * Fetches all allocations closed in the last 30 days and aggregates
 * query fees per subgraph deployment. Returns deployments sorted by
 * 30-day fees descending.
 */
export async function GET() {
  if (!hasSubgraphAccess()) {
    return NextResponse.json({ error: 'No API key configured' }, { status: 503 });
  }

  const cacheKey = 'lodestar:deployments-fees-30d';

  try {
    const data = await cached(cacheKey, 300, async () => {
      const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 86400;
      const feesByDeployment = new Map<string, bigint>();
      const deploymentData = new Map<string, AllocationRaw['subgraphDeployment']>();

      let lastId = '';
      while (true) {
        const result = await subgraphQuery<{ allocations: AllocationRaw[] }>(`{
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
              signalledTokens
              stakedTokens
              queryFeesAmount
              indexerAllocations(first: 1000) { id }
              curatorSignals(first: 1000) { id }
            }
          }
        }`);

        if (result.allocations.length === 0) break;

        for (const alloc of result.allocations) {
          const depId = alloc.subgraphDeployment.id;
          const fees = BigInt(alloc.queryFeesCollected);
          feesByDeployment.set(depId, (feesByDeployment.get(depId) ?? BigInt(0)) + fees);
          // Keep the latest deployment data (all point to same entity)
          if (!deploymentData.has(depId)) {
            deploymentData.set(depId, alloc.subgraphDeployment);
          }
        }

        lastId = result.allocations[result.allocations.length - 1].id;
        if (result.allocations.length < 1000) break;
      }

      // Build aggregated list, filter dust signal (same as main endpoint)
      const aggregated: AggregatedDeployment[] = [];
      for (const [depId, fees30d] of feesByDeployment) {
        const dep = deploymentData.get(depId);
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
        });
      }

      // Sort by 30-day fees descending
      aggregated.sort((a, b) => {
        const fa = BigInt(a.queryFees30d);
        const fb = BigInt(b.queryFees30d);
        if (fb > fa) return 1;
        if (fb < fa) return -1;
        return 0;
      });

      return aggregated;
    });

    return NextResponse.json({ data }, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch (error) {
    console.error('30-day fees aggregation error:', error);
    return NextResponse.json({ error: 'Failed to compute 30-day fees' }, { status: 500 });
  }
}
