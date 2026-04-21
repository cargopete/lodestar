import { NextResponse, type NextRequest } from 'next/server';
import { cached } from '@/lib/cache';
import { subgraphQuery, hasSubgraphAccess } from '@/lib/subgraph';
import { log } from '@/lib/logger';

interface DeploymentRaw {
  id: string;
  ipfsHash: string;
  signalledTokens: string;
  stakedTokens: string;
  queryFeesAmount: string;
  indexerAllocations: { id: string }[];
  curatorSignals: { id: string }[];
  versions: { subgraph: { metadata: { displayName: string } | null } }[];
}

const ALLOWED_ORDER_BY = new Set([
  'signalledTokens',
  'stakedTokens',
  'queryFeesAmount',
]);

export async function GET(request: NextRequest) {
  if (!hasSubgraphAccess()) {
    return NextResponse.json({ error: 'No API key configured' }, { status: 503 });
  }

  const params = request.nextUrl.searchParams;
  const first = Math.min(Number(params.get('first')) || 25, 500);
  const skip = Math.max(Number(params.get('skip')) || 0, 0);
  const orderBy = ALLOWED_ORDER_BY.has(params.get('orderBy') ?? '')
    ? params.get('orderBy')!
    : 'signalledTokens';
  const orderDirection = params.get('orderDirection') === 'asc' ? 'asc' : 'desc';

  const query = `{
    subgraphDeployments(
      first: ${first}
      skip: ${skip}
      orderBy: ${orderBy}
      orderDirection: ${orderDirection}
      where: { signalledTokens_gt: "1000000000000000000" }
    ) {
      id
      ipfsHash
      signalledTokens
      stakedTokens
      queryFeesAmount
      indexerAllocations(where: { status: Active }) {
        id
      }
      curatorSignals {
        id
      }
      versions(first: 1, orderBy: createdAt, orderDirection: desc) {
        subgraph {
          metadata { displayName }
        }
      }
    }
  }`;

  const cacheKey = `lodestar:deployments:${first}:${skip}:${orderBy}:${orderDirection}`;

  try {
    const data = await cached(cacheKey, 300, async () => {
      const result = await subgraphQuery<{ subgraphDeployments: DeploymentRaw[] }>(query);
      return result.subgraphDeployments.map((d) => ({
        ...d,
        displayName: d.versions?.[0]?.subgraph?.metadata?.displayName ?? null,
        versions: undefined,
      }));
    });

    return NextResponse.json({ data }, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch (error) {
    log.api.error({ err: error }, 'Subgraph deployments error');
    return NextResponse.json({ error: 'Failed to fetch deployments' }, { status: 500 });
  }
}
