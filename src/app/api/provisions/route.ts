import { NextRequest, NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { subgraphQuery, ensQuery, hasSubgraphAccess } from '@/lib/subgraph';
import type { IndexerProvisionsResponse, ServiceProvisionsResponse } from '@/lib/queries';
import { log } from '@/lib/logger';

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
    const data = await cached(`lodestar:provisions:service:${addr}:${first}:${skip}`, 300, async () => {
      const result = await subgraphQuery<ServiceProvisionsResponse>(`{
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
      }`);

      // ENS fallback: look up names for indexers the subgraph didn't resolve
      const missing = result.provisions
        .filter((p) => !p.indexer.account?.defaultDisplayName && !p.indexer.account?.metadata?.displayName)
        .map((p) => p.indexer.id);

      if (missing.length > 0) {
        try {
          const idList = missing.map((id) => `"${id}"`).join(', ');
          const ensResult = await ensQuery<{ domains: Array<{ name: string; resolvedAddress: { id: string } }> }>(`{
            domains(first: 100, where: { resolvedAddress_in: [${idList}], name_not: null }) {
              name
              resolvedAddress { id }
            }
          }`);
          const ensMap: Record<string, string> = {};
          for (const d of ensResult.domains) {
            const a = d.resolvedAddress.id.toLowerCase();
            if (!ensMap[a] || d.name.length < ensMap[a].length) ensMap[a] = d.name;
          }
          for (const p of result.provisions) {
            const ens = ensMap[p.indexer.id.toLowerCase()];
            if (ens) {
              if (!p.indexer.account) (p.indexer as Record<string, unknown>).account = {};
              p.indexer.account!.defaultDisplayName = ens;
            }
          }
        } catch {
          // ENS lookup failed — names just won't resolve, not fatal
        }
      }

      return result;
    });

    return NextResponse.json({ data }, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch (error) {
    log.api.error({ err: error }, 'Provisions error');
    return NextResponse.json({ error: 'Failed to fetch provisions' }, { status: 500 });
  }
}
