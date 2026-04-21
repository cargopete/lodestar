import { NextResponse, type NextRequest } from 'next/server';
import { cached } from '@/lib/cache';
import { subgraphQuery, hasSubgraphAccess } from '@/lib/subgraph';
import { log } from '@/lib/logger';

interface RawSignal {
  id: string;
  signalledTokens: string;
  unsignalledTokens: string;
  signal: string;
  lastSignalChange: number;
  realizedRewards: string;
}

interface RawDeployment {
  signalledTokens: string;
  queryFeesAmount: string;
  curatorSignals: RawSignal[];
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ hash: string }> },
) {
  const { hash } = await params;

  if (!hasSubgraphAccess()) {
    return NextResponse.json({ error: 'No API key configured' }, { status: 503 });
  }

  const query = `{
    subgraphDeployments(where: { ipfsHash: "${hash}" }, first: 1) {
      signalledTokens
      queryFeesAmount
      curatorSignals(first: 100, orderBy: signalledTokens, orderDirection: desc) {
        id
        signalledTokens
        unsignalledTokens
        signal
        lastSignalChange
        realizedRewards
      }
    }
  }`;

  const cacheKey = `lodestar:curation:${hash}`;

  try {
    const data = await cached(cacheKey, 300, async () => {
      const result = await subgraphQuery<{ subgraphDeployments: RawDeployment[] }>(query);
      const deployment = result.subgraphDeployments[0];
      if (!deployment) return { signals: [], totalSignalledTokens: '0' };

      const signals = deployment.curatorSignals.map((s) => ({
        ...s,
        // Signal ID format: <curatorAddress>-<deploymentId>
        curatorAddress: s.id.split('-')[0],
      }));

      return {
        signals,
        totalSignalledTokens: deployment.signalledTokens,
        queryFeesAmount: deployment.queryFeesAmount ?? '0',
      };
    });

    return NextResponse.json({ data }, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
    });
  } catch (error) {
    log.api.error({ err: error }, 'Subgraph curation error');
    return NextResponse.json({ error: 'Failed to fetch curation data' }, { status: 500 });
  }
}
