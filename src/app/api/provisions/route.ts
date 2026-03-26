import { NextRequest, NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { subgraphQuery, hasSubgraphAccess } from '@/lib/subgraph';
import type { IndexerProvisionsResponse, ServiceProvisionsResponse } from '@/lib/queries';

export async function GET(request: NextRequest) {
  if (!hasSubgraphAccess()) {
    return NextResponse.json({ error: 'No API key configured' }, { status: 503 });
  }

  const indexer = request.nextUrl.searchParams.get('indexer');
  const service = request.nextUrl.searchParams.get('service');
  const first = parseInt(request.nextUrl.searchParams.get('first') ?? '50', 10);
  const skip = parseInt(request.nextUrl.searchParams.get('skip') ?? '0', 10);

  if (!indexer && !service) {
    return NextResponse.json({ error: 'indexer or service parameter required' }, { status: 400 });
  }

  try {
    if (indexer) {
      const addr = indexer.toLowerCase();
      const data = await cached(`lodestar:provisions:indexer:${addr}`, 300, () =>
        subgraphQuery<IndexerProvisionsResponse>(`{
          provisions(
            where: { indexer: "${addr}" }
            orderBy: tokensProvisioned
            orderDirection: desc
          ) {
            id
            tokensProvisioned
            tokensAllocated
            tokensThawing
            maxVerifierCut
            thawingPeriod
            createdAt
            allocationCount
            dataService {
              id
              totalTokensProvisioned
              totalTokensAllocated
              minimumThawingPeriod
              maximumThawingPeriod
            }
          }
        }`)
      );

      return NextResponse.json({ data }, {
        headers: {
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
        },
      });
    }

    // Service provisions
    const addr = service!.toLowerCase();
    const data = await cached(`lodestar:provisions:service:${addr}:${first}:${skip}`, 300, () =>
      subgraphQuery<ServiceProvisionsResponse>(`{
        provisions(
          where: { dataService: "${addr}" }
          first: ${first}
          skip: ${skip}
          orderBy: tokensProvisioned
          orderDirection: desc
        ) {
          id
          tokensProvisioned
          tokensAllocated
          tokensThawing
          maxVerifierCut
          thawingPeriod
          createdAt
          allocationCount
          indexer {
            id
            account {
              defaultDisplayName
              metadata {
                displayName
                description
              }
            }
            stakedTokens
            delegatedTokens
          }
        }
      }`)
    );

    return NextResponse.json({ data }, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch (error) {
    console.error('Provisions error:', error);
    return NextResponse.json({ error: 'Failed to fetch provisions' }, { status: 500 });
  }
}
