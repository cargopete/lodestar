import { NextResponse, type NextRequest } from 'next/server';
import { cached } from '@/lib/cache';
import { log } from '@/lib/logger';
import { hasNuthatch, nuthatchSqlReady } from '@/lib/nuthatch';
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

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const hashParam = params.get('hash') ?? '';

  // From the nest, always (nuthatch#1160); the gateway path this once fell back to left with the key.
  if (!hasNuthatch()) {
    return NextResponse.json({ error: 'Nuthatch is not configured' }, { status: 503 });
  }
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
