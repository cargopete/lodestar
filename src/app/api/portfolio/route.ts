import { NextRequest, NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { subgraphQuery, hasSubgraphAccess } from '@/lib/subgraph';
import { resolveEnsNames } from '@/lib/ens';
import type { DelegatorPortfolioResponse, CuratorPortfolioResponse, DelegatedStake, Signal } from '@/lib/queries';
import { log } from '@/lib/logger';
import { hasNuthatch, nuthatchEnabled, nuthatchSqlReady } from '@/lib/nuthatch';
import {
  delegatorSql, delegatorStakesSql, curatorSql, curatorSignalsSql,
  type NestDelegatorTotalsRow, type NestDelegatorStakeRow, type NestCuratorTotalsRow, type NestCuratorSignalRow,
} from '@/lib/nest-queries';
import { bytes32ToIpfsHash } from '@/lib/studio/ipfs';

const PORTFOLIO_BASE_PATH = process.env.NUTHATCH_PORTFOLIO_BASE_PATH || '/alloc';

/** A `lodestar_delegator_stakes` row in the subgraph's `DelegatedStake` shape; names null (ENS, group B). */
export function stakeFromNest(r: NestDelegatorStakeRow): DelegatedStake {
  return {
    id: r.id,
    stakedTokens: r.staked_tokens,
    shareAmount: r.share_amount,
    lockedTokens: r.locked_tokens,
    lockedUntil: Number(r.locked_until ?? 0),
    realizedRewards: r.realized_rewards,
    unstakedTokens: r.unstaked_tokens,
    createdAt: Number(r.created_at ?? 0),
    lastUndelegatedAt: r.last_undelegated_at,
    indexer: {
      id: r.indexer,
      account: { id: r.indexer, defaultDisplayName: null, metadata: null },
      stakedTokens: r.indexer_staked_tokens ?? '0',
      delegatedTokens: r.indexer_delegated_tokens ?? '0',
      delegatedThawingTokens: r.indexer_delegated_thawing_tokens ?? '0',
      delegatorShares: r.indexer_delegator_shares ?? '0',
      indexingRewardCut: Number(r.indexing_reward_cut ?? 0),
      queryFeeCut: Number(r.query_fee_cut ?? 0),
      delegatorParameterCooldown: 0,
      allocationCount: Number(r.allocation_count ?? 0),
    },
  };
}

export function signalFromNest(r: NestCuratorSignalRow): Signal {
  let ipfsHash = r.subgraph_deployment;
  try { ipfsHash = bytes32ToIpfsHash(r.subgraph_deployment); } catch { /* not a bytes32 id; keep as is */ }
  return {
    id: r.id,
    signalledTokens: r.signalled_tokens,
    unsignalledTokens: r.unsignalled_tokens,
    signal: r.signal,
    lastSignalChange: Number(r.last_signal_change ?? 0),
    realizedRewards: r.realized_rewards,
    subgraphDeployment: {
      id: r.subgraph_deployment, ipfsHash,
      signalledTokens: r.deployment_signalled_tokens, queryFeesAmount: r.deployment_query_fees_amount, stakedTokens: r.deployment_staked_tokens,
    },
  };
}

async function portfolioFromNest(address: string, type: 'delegator' | 'curator') {
  const q = <T,>(sql: string) => nuthatchSqlReady<T>(sql, PORTFOLIO_BASE_PATH);
  if (type === 'delegator') {
    const [d, st] = await Promise.all([q<NestDelegatorTotalsRow>(delegatorSql(address)), q<NestDelegatorStakeRow>(delegatorStakesSql(address, 100))]);
    if (!d.ok) throw Object.assign(new Error(d.error), { nest: d });
    if (!st.ok) throw Object.assign(new Error(st.error), { nest: st });
    const row = d.data.rows[0];
    const data: DelegatorPortfolioResponse = {
      delegator: row ? {
        id: row.id,
        totalStakedTokens: row.total_staked_tokens,
        totalUnstakedTokens: row.total_unstaked_tokens,
        totalRealizedRewards: row.total_realized_rewards,
        stakesCount: Number(row.stakes_count),
        activeStakesCount: Number(row.active_stakes_count),
        stakes: st.data.rows.map(stakeFromNest),
      } : null,
    };
    return data;
  }
  const [c, sg] = await Promise.all([q<NestCuratorTotalsRow>(curatorSql(address)), q<NestCuratorSignalRow>(curatorSignalsSql(address, 100))]);
  if (!c.ok) throw Object.assign(new Error(c.error), { nest: c });
  if (!sg.ok) throw Object.assign(new Error(sg.error), { nest: sg });
  const row = c.data.rows[0];
  // Name signal through GNS is the GNS contract's Curation position, not the curator's, so the four
  // name-signal totals are 0 here; the subgraph reports them from its own `NameSignal` entities,
  // which no Lodestar page reads.
  const data: CuratorPortfolioResponse = {
    curator: row ? {
      id: row.id,
      totalSignalledTokens: row.total_signalled_tokens,
      totalUnsignalledTokens: row.total_unsignalled_tokens,
      totalNameSignalledTokens: '0',
      totalNameUnsignalledTokens: '0',
      totalWithdrawnTokens: '0',
      realizedRewards: row.realized_rewards,
      signalCount: Number(row.signal_count),
      activeSignalCount: Number(row.active_signal_count),
      signals: sg.data.rows.map(signalFromNest),
    } : null,
  };
  return data;
}

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

  // Off by default (nuthatch#1160). On the nest path neither the gateway key nor the ENS subgraph is consulted.
  if (nuthatchEnabled('NUTHATCH_PORTFOLIO')) {
    if (!hasNuthatch()) {
      return NextResponse.json({ error: 'Nuthatch is not configured' }, { status: 503 });
    }
    try {
      const data = await cached(`lodestar:portfolio:${type}:${address}:nuthatch:v1`, 120, () => portfolioFromNest(address, type));
      return NextResponse.json({ data, source: 'nuthatch' }, {
        headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=300' },
      });
    } catch (error) {
      log.api.error({ err: error }, 'Portfolio from the nest failed');
      return NextResponse.json({ error: 'Failed to load portfolio from Nuthatch' }, { status: 503 });
    }
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
        // Primary names over a mainnet RPC (nuthatch#1160); a failed lookup leaves the address.
        const names = await resolveEnsNames(nameless.map((ix) => ix.id));
        for (const ix of nameless) {
          const ens = names[ix.id.toLowerCase()];
          if (ens) {
            if (!ix.account) ix.account = { id: ix.id, defaultDisplayName: null };
            ix.account.defaultDisplayName = ens;
          }
        }
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
