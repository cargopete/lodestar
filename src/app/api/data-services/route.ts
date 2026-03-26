import { NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { subgraphQuery, hasSubgraphAccess } from '@/lib/subgraph';
import type { DataServicesResponse } from '@/lib/queries';

const QUERY = `{
  dataServices(first: 20, orderBy: totalTokensProvisioned, orderDirection: desc) {
    id
    totalTokensProvisioned
    totalTokensAllocated
    totalTokensThawing
    totalTokensDelegated
    minimumProvisionTokens
    maximumVerifierCut
    minimumVerifierCut
    minimumThawingPeriod
    maximumThawingPeriod
    delegationRatio
    curationCut
  }
}`;

export async function GET() {
  if (!hasSubgraphAccess()) {
    return NextResponse.json({ error: 'No API key configured' }, { status: 503 });
  }

  try {
    const data = await cached('lodestar:data-services', 300, () =>
      subgraphQuery<DataServicesResponse>(QUERY)
    );

    return NextResponse.json({ data }, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch (error) {
    console.error('Data services error:', error);
    return NextResponse.json({ error: 'Failed to fetch data services' }, { status: 500 });
  }
}
