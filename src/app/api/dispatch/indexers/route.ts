import { NextResponse } from 'next/server';
import { dispatchRegistryQuery, hasSubgraphAccess } from '@/lib/subgraph';
import { cached } from '@/lib/cache';

interface DispatchIndexer {
  id: string;
  address: string;
  endpoint: string;
  geoHash: string | null;
  paymentsDestination: string | null;
  registered: boolean;
  registeredAt: string;
  chains: Array<{ id: string }>;
}

export async function GET() {
  if (!hasSubgraphAccess()) {
    return NextResponse.json({ error: 'No API key configured' }, { status: 503 });
  }

  try {
    const data = await cached('lodestar:dispatch:indexers', 120, async () => {
      const result = await dispatchRegistryQuery<{ indexers: DispatchIndexer[] }>(`{
        indexers(
          first: 100
          orderBy: registeredAt
          orderDirection: desc
          where: { registered: true }
        ) {
          id
          address
          endpoint
          geoHash
          paymentsDestination
          registered
          registeredAt
          chains { id }
        }
      }`);
      const BLOCKED = new Set(['0xb43b2cccceada5292732a8c58ae134adefce09bb']);
      return (result.indexers ?? []).filter(
        (i) => !BLOCKED.has(i.address?.toLowerCase())
      );
    });

    return NextResponse.json({ data }, {
      headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=300' },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
