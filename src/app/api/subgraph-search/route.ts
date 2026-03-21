import { NextResponse, type NextRequest } from 'next/server';
import { cached } from '@/lib/cache';
import { subgraphQuery, hasSubgraphAccess } from '@/lib/subgraph';

interface SubgraphResult {
  id: string;
  metadata: { displayName: string; description: string | null } | null;
  currentVersion: {
    subgraphDeployment: {
      ipfsHash: string;
      signalledTokens: string;
      stakedTokens: string;
    };
  } | null;
}

export async function GET(request: NextRequest) {
  if (!hasSubgraphAccess()) {
    return NextResponse.json({ error: 'No API key configured' }, { status: 503 });
  }

  const q = request.nextUrl.searchParams.get('q')?.trim();
  if (!q || q.length < 2) {
    return NextResponse.json({ data: [] });
  }

  // Sanitise — strip anything that could break the GraphQL string
  const safe = q.replace(/["\\\n\r]/g, '');

  try {
    const data = await cached(
      `lodestar:subgraph-search:${safe.toLowerCase()}`,
      300, // 5 min — subgraph names don't change often
      () =>
        subgraphQuery<{ subgraphs: SubgraphResult[] }>(`{
          subgraphs(
            first: 10
            orderBy: signalledTokens
            orderDirection: desc
            where: { metadata_: { displayName_contains_nocase: "${safe}" }, currentVersion_not: null }
          ) {
            id
            metadata { displayName description }
            currentVersion {
              subgraphDeployment {
                ipfsHash
                signalledTokens
                stakedTokens
              }
            }
          }
        }`),
    );

    return NextResponse.json(
      { data: data.subgraphs },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
        },
      },
    );
  } catch (error) {
    console.error('Subgraph search error:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
