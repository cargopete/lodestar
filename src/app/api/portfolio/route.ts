import { NextRequest, NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { subgraphQuery, ensQuery, hasSubgraphAccess } from '@/lib/subgraph';
import type { DelegatorPortfolioResponse, CuratorPortfolioResponse } from '@/lib/queries';
import { log } from '@/lib/logger';

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get('address')?.toLowerCase();
  const type = request.nextUrl.searchParams.get('type'); // 'delegator' or 'curator'

  if (!address) {
    return NextResponse.json({ error: 'address parameter required' }, { status: 400 });
  }
  if (!/^0x[0-9a-f]{40}$/.test(address)) {
    return NextResponse.json({ error: 'Invalid address format' }, { status: 400 });
  }
  if (type !== 'delegator' && type !== 'curator') {
    return NextResponse.json({ error: 'type must be delegator or curator' }, { status: 400 });
  }

  if (!hasSubgraphAccess()) {
    return NextResponse.json({ error: 'No API key configured' }, { status: 503 });
  }

  try {
    if (type === 'delegator') {
      const data = await cached(`lodestar:portfolio:delegator:${address}`, 120, () =>
        subgraphQuery<DelegatorPortfolioResponse>(`{
          delegator(id: "${address}") {
            id
            totalStakedTokens
            totalUnstakedTokens
            totalRealizedRewards
            stakesCount
            activeStakesCount
            stakes(first: 100, orderBy: stakedTokens, orderDirection: desc) {
              id
              stakedTokens
              shareAmount
              lockedTokens
              lockedUntil
              realizedRewards
              unstakedTokens
              createdAt
              lastUndelegatedAt
              indexer {
                id
                account {
                  id
                  defaultDisplayName
                  metadata {
                    displayName
                    description
                  }
                }
                stakedTokens
                delegatedTokens
                delegatorShares
                indexingRewardCut
                queryFeeCut
                delegatorParameterCooldown
                allocationCount
                indexingRewardEffectiveCut
              }
            }
          }
        }`)
      );

      // ENS enrichment: fill in names for indexers the subgraph has no metadata for
      const nameless = (data?.delegator?.stakes ?? [])
        .map((s) => s.indexer)
        .filter((ix) => !ix.account?.defaultDisplayName && !ix.account?.metadata?.displayName);

      if (nameless.length > 0) {
        const ensResults = await Promise.allSettled(
          nameless.map((ix) =>
            cached(`ens:${ix.id}`, 86400, async () => {
              const result = await ensQuery<{ domains: Array<{ name: string }> }>(`{
                domains(first: 5, where: { resolvedAddress: "${ix.id}", name_not: null }) {
                  name
                }
              }`);
              const names = result.domains.map((d) => d.name).sort((a, b) => a.length - b.length);
              return { ensName: names[0] ?? null };
            })
          )
        );

        nameless.forEach((ix, i) => {
          const result = ensResults[i];
          if (result.status === 'fulfilled' && result.value?.ensName) {
            if (!ix.account) ix.account = { id: ix.id, defaultDisplayName: null };
            ix.account.defaultDisplayName = result.value.ensName;
          }
        });
      }

      return NextResponse.json({ data }, {
        headers: {
          'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=300',
        },
      });
    }

    // Curator
    const data = await cached(`lodestar:portfolio:curator:${address}`, 120, () =>
      subgraphQuery<CuratorPortfolioResponse>(`{
        curator(id: "${address}") {
          id
          totalSignalledTokens
          totalUnsignalledTokens
          totalNameSignalledTokens
          totalNameUnsignalledTokens
          totalWithdrawnTokens
          realizedRewards
          signalCount
          activeSignalCount
          signals(first: 100, orderBy: signalledTokens, orderDirection: desc) {
            id
            signalledTokens
            unsignalledTokens
            signal
            lastSignalChange
            realizedRewards
            subgraphDeployment {
              id
              ipfsHash
              signalledTokens
              queryFeesAmount
              stakedTokens
            }
          }
        }
      }`)
    );

    return NextResponse.json({ data }, {
      headers: {
        'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=300',
      },
    });
  } catch (error) {
    log.api.error({ err: error }, 'Portfolio error');
    return NextResponse.json({ error: 'Failed to fetch portfolio' }, { status: 500 });
  }
}
