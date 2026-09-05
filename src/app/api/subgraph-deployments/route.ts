import { NextResponse, type NextRequest } from 'next/server';
import { cached } from '@/lib/cache';
import { subgraphQuery, hasSubgraphAccess } from '@/lib/subgraph';
import { log } from '@/lib/logger';
import { hasNuthatch, nuthatchEnabled, nuthatchSqlReady } from '@/lib/nuthatch';
import { deploymentsListSql, deploymentsByIdSql, DEPLOYMENTS_ORDER_BY, type NestDeploymentListRow } from '@/lib/nest-queries';
import { deploymentRowToApi, subgraphMetadataForDeployments } from '@/lib/subgraph-metadata';
import { ipfsHashToBytes32 } from '@/lib/studio/ipfs';

const ALLOC_BASE_PATH = process.env.NUTHATCH_ALLOCATIONS_BASE_PATH || '/alloc';

/** Rows off `lodestar_deployments` in the route's shape, named off graph-gns-nest and IPFS. */
async function shapeNestRows(rows: NestDeploymentListRow[]) {
  const meta = await subgraphMetadataForDeployments(rows.map((r) => r.id));
  return rows.map((r) => {
    const m = meta.get(r.id.toLowerCase());
    return deploymentRowToApi(r, { displayName: m?.metadata?.displayName ?? null, categories: m?.metadata?.categories ?? [] });
  });
}

interface DeploymentRaw {
  id: string;
  ipfsHash: string;
  signalledTokens: string;
  stakedTokens: string;
  queryFeesAmount: string;
  createdAt: number;
  indexerAllocations: { id: string }[];
  curatorSignals: { id: string }[];
  versions: { subgraph: { metadata: { displayName: string; categories: string[] | null } | null } }[];
}

const ALLOWED_ORDER_BY = new Set([
  'signalledTokens',
  'stakedTokens',
  'queryFeesAmount',
  'createdAt',
]);

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const hashParam = params.get('hash') ?? '';

  // Behind NUTHATCH_SUBGRAPHS (nuthatch#1160, group B): the list and the hash lookup both come from
  // graph-allocations-nest's `lodestar_deployments`; names come from graph-gns-nest + IPFS. The
  // gateway is not consulted. A CIDv1 hash cannot be looked up on chain (deployments are keyed by the
  // CIDv0 digest) and returns an empty list, which is what the gateway returned for an unknown hash.
  if (nuthatchEnabled('NUTHATCH_SUBGRAPHS') && hasNuthatch()) {
    try {
      if (hashParam.startsWith('Qm') || hashParam.startsWith('baf')) {
        let id: string | null = null;
        try { id = ipfsHashToBytes32(hashParam).toLowerCase(); } catch { id = null; }
        if (!id) return NextResponse.json({ data: [], source: 'nuthatch' });
        const r = await nuthatchSqlReady<NestDeploymentListRow>(deploymentsByIdSql([id]), ALLOC_BASE_PATH);
        if (!r.ok) throw Object.assign(new Error(r.error), { nest: r });
        return NextResponse.json({ data: await shapeNestRows(r.data.rows), source: 'nuthatch' });
      }
      const first = Math.min(Number(params.get('first')) || 25, 500);
      const skip = Math.max(Number(params.get('skip')) || 0, 0);
      const orderBy = params.get('orderBy') && DEPLOYMENTS_ORDER_BY[params.get('orderBy')!] ? params.get('orderBy')! : 'signalledTokens';
      const dir = params.get('orderDirection') === 'asc' ? 'asc' : 'desc';
      const data = await cached(`lodestar:deployments:${first}:${skip}:${orderBy}:${dir}:nuthatch:v1`, 300, async () => {
        const r = await nuthatchSqlReady<NestDeploymentListRow>(deploymentsListSql(first, skip, orderBy, dir), ALLOC_BASE_PATH);
        if (!r.ok) throw Object.assign(new Error(r.error), { nest: r });
        return shapeNestRows(r.data.rows);
      });
      return NextResponse.json({ data, source: 'nuthatch' }, {
        headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
      });
    } catch (error) {
      log.api.error({ err: error }, 'Subgraph deployments from the nest failed');
      return NextResponse.json({ error: 'Failed to load deployments from Nuthatch' }, { status: 503 });
    }
  }

  if (!hasSubgraphAccess()) {
    return NextResponse.json({ error: 'No API key configured' }, { status: 503 });
  }

  // Direct lookup by IPFS hash — bypasses top-N ordering
  if (hashParam.startsWith('Qm') || hashParam.startsWith('baf')) {
    const query = `{
      subgraphDeployments(where: { ipfsHash: "${hashParam}" }, first: 1) {
        id
        ipfsHash
        signalledTokens
        stakedTokens
        queryFeesAmount
        createdAt
        indexerAllocations(where: { status: Active }) { id }
        curatorSignals { id }
        versions(first: 1, orderBy: createdAt, orderDirection: desc) {
          subgraph { metadata { displayName categories } }
        }
      }
    }`;
    try {
      const result = await subgraphQuery<{ subgraphDeployments: DeploymentRaw[] }>(query);
      const data = result.subgraphDeployments.map((d) => ({
        ...d,
        displayName: d.versions?.[0]?.subgraph?.metadata?.displayName ?? null,
        categories: d.versions?.[0]?.subgraph?.metadata?.categories ?? [],
        versions: undefined,
      }));
      return NextResponse.json({ data });
    } catch (error) {
      log.api.error({ err: error }, 'Subgraph deployment lookup error');
      return NextResponse.json({ error: 'Failed to fetch deployment' }, { status: 500 });
    }
  }

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
      createdAt
      indexerAllocations(where: { status: Active }) {
        id
      }
      curatorSignals {
        id
      }
      versions(first: 1, orderBy: createdAt, orderDirection: desc) {
        subgraph {
          metadata { displayName categories }
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
        categories: d.versions?.[0]?.subgraph?.metadata?.categories ?? [],
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
