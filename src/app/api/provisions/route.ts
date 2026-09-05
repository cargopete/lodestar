import { NextRequest, NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { subgraphQuery, hasSubgraphAccess } from '@/lib/subgraph';
import { resolveEnsNames } from '@/lib/ens';
import type { IndexerProvisionsResponse, ServiceProvisionsResponse, Provision, ProvisionWithIndexer } from '@/lib/queries';
import { log } from '@/lib/logger';
import { hasNuthatch, nuthatchEnabled, nuthatchSqlReady } from '@/lib/nuthatch';
import {
  provisionsByIndexerSql, provisionsByServiceSql, dataServiceTotalsSql, networkParamsSql,
  type NestProvisionRow, type NestDataServiceTotalsRow, type NestNetworkParamsRow,
} from '@/lib/nest-queries';

const PROVISIONS_BASE_PATH = process.env.NUTHATCH_PROVISIONS_BASE_PATH || '/alloc';

/**
 * A `lodestar_provisions` row in the subgraph's `Provision` shape. The data service's thawing
 * range is the protocol's `getMaxThawingPeriod` for both ends: `SubgraphService.getThawingPeriodRange`
 * answered (2,419,200, 2,419,200) on 2026-09-05, and the nest samples the protocol ceiling rather
 * than a per-service range that no other service has set differently.
 */
export function provisionFromNest(r: NestProvisionRow, totals: Map<string, NestDataServiceTotalsRow>, maxThawing: string): Provision {
  const t = totals.get(r.data_service);
  return {
    id: r.id,
    tokensProvisioned: r.tokens_provisioned,
    tokensAllocated: r.tokens_allocated,
    tokensThawing: r.tokens_thawing,
    maxVerifierCut: String(r.max_verifier_cut ?? 0),
    thawingPeriod: String(r.thawing_period ?? 0),
    createdAt: String(r.created_at ?? 0),
    allocationCount: Number(r.allocation_count),
    rewardsEarned: r.rewards_earned,
    queryFeesCollected: r.query_fees_collected,
    dataService: {
      id: r.data_service,
      totalTokensProvisioned: t?.total_tokens_provisioned ?? '0',
      totalTokensAllocated: t?.total_tokens_allocated ?? '0',
      minimumThawingPeriod: maxThawing,
      maximumThawingPeriod: maxThawing,
    },
  };
}

export function provisionWithIndexerFromNest(r: NestProvisionRow): ProvisionWithIndexer {
  return {
    id: r.id,
    tokensProvisioned: r.tokens_provisioned,
    tokensAllocated: r.tokens_allocated,
    tokensThawing: r.tokens_thawing,
    maxVerifierCut: String(r.max_verifier_cut ?? 0),
    thawingPeriod: String(r.thawing_period ?? 0),
    createdAt: String(r.created_at ?? 0),
    allocationCount: Number(r.allocation_count),
    // names are ENS and IPFS: null until the group B work
    indexer: {
      id: r.indexer,
      account: { defaultDisplayName: null, metadata: null },
      stakedTokens: r.indexer_staked_tokens ?? '0',
      delegatedTokens: r.indexer_delegated_tokens ?? '0',
    },
  };
}

async function provisionsFromNest(indexer: string | null, service: string | null, first: number, skip: number) {
  const q = <T,>(sql: string) => nuthatchSqlReady<T>(sql, PROVISIONS_BASE_PATH);
  if (indexer) {
    const [rows, params] = await Promise.all([q<NestProvisionRow>(provisionsByIndexerSql(indexer)), q<NestNetworkParamsRow>(networkParamsSql())]);
    if (!rows.ok) throw Object.assign(new Error(rows.error), { nest: rows });
    if (!params.ok) throw Object.assign(new Error(params.error), { nest: params });
    const services = [...new Set(rows.data.rows.map((r) => r.data_service))];
    const totals = new Map<string, NestDataServiceTotalsRow>();
    if (services.length > 0) {
      const t = await q<NestDataServiceTotalsRow>(dataServiceTotalsSql(services));
      if (!t.ok) throw Object.assign(new Error(t.error), { nest: t });
      for (const row of t.data.rows) totals.set(row.data_service, row);
    }
    const maxThawing = String(params.data.rows[0]?.max_thawing_period_seconds ?? 0);
    const data: IndexerProvisionsResponse = { provisions: rows.data.rows.map((r) => provisionFromNest(r, totals, maxThawing)) };
    return data;
  }
  const rows = await q<NestProvisionRow>(provisionsByServiceSql(service!, first, skip));
  if (!rows.ok) throw Object.assign(new Error(rows.error), { nest: rows });
  const data: ServiceProvisionsResponse = { provisions: rows.data.rows.map(provisionWithIndexerFromNest) };
  return data;
}

export async function GET(request: NextRequest) {

  const indexer = request.nextUrl.searchParams.get('indexer');
  const service = request.nextUrl.searchParams.get('service');
  const first = parseInt(request.nextUrl.searchParams.get('first') ?? '50', 10);
  const skip = parseInt(request.nextUrl.searchParams.get('skip') ?? '0', 10);

  if (!indexer && !service) {
    return NextResponse.json({ error: 'indexer or service parameter required' }, { status: 400 });
  }

  const ETH_ADDRESS_RE = /^0x[0-9a-f]{40}$/;
  if (indexer && !ETH_ADDRESS_RE.test(indexer.toLowerCase())) {
    return NextResponse.json({ error: 'Invalid indexer address' }, { status: 400 });
  }
  if (service && !ETH_ADDRESS_RE.test(service.toLowerCase())) {
    return NextResponse.json({ error: 'Invalid service address' }, { status: 400 });
  }

  // Off by default (nuthatch#1160). On the nest path the gateway key is not consulted at all.
  if (nuthatchEnabled('NUTHATCH_PROVISIONS')) {
    if (!hasNuthatch()) {
      return NextResponse.json({ error: 'Nuthatch is not configured' }, { status: 503 });
    }
    const ix = indexer ? indexer.toLowerCase() : null; const sv = service ? service.toLowerCase() : null;
    try {
      const data = await cached(`lodestar:provisions:nuthatch:v1:${ix ?? ''}:${sv ?? ''}:${first}:${skip}`, 300, () => provisionsFromNest(ix, sv, first, skip));
      return NextResponse.json({ data, source: 'nuthatch' }, {
        headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
      });
    } catch (error) {
      log.api.error({ err: error }, 'Provisions from the nest failed');
      return NextResponse.json({ error: 'Failed to load provisions from Nuthatch' }, { status: 503 });
    }
  }

  if (!hasSubgraphAccess()) {
    return NextResponse.json({ error: 'No API key configured' }, { status: 503 });
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
            rewardsEarned
            queryFeesCollected
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
          // Primary names over a mainnet RPC (nuthatch#1160), not the ENS subgraph.
          const ensMap = await resolveEnsNames(missing);
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
