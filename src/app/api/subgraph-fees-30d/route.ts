import { NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { log } from '@/lib/logger';
import { hasNuthatch, nuthatchSqlReady } from '@/lib/nuthatch';
import { deploymentFeesSinceSql, deploymentsByIdSql, type NestDeploymentFeesRow, type NestDeploymentListRow } from '@/lib/nest-queries';
import { deploymentRowToApi, subgraphMetadataForDeployments } from '@/lib/subgraph-metadata';

const ALLOC_BASE_PATH = process.env.NUTHATCH_ALLOCATIONS_BASE_PATH || '/alloc';

interface AggregatedDeployment {
  id: string;
  ipfsHash: string;
  signalledTokens: string;
  stakedTokens: string;
  queryFeesAmount: string;
  queryFees30d: string;
  createdAt: number;
  indexerAllocations: { id: string }[];
  curatorSignals: { id: string }[];
  displayName: string | null;
  categories: string[];
}

/**
 * Fetches all allocations closed in the last 30 days and aggregates
 * query fees per subgraph deployment. Returns deployments sorted by
 * 30-day fees descending.
 *
 * Two-pass approach to avoid expensive nested queries:
 *   1. Lightweight allocation scan (id + fees + deployment id/hash only)
 *   2. Targeted deployment detail fetch for the top results
 */
export async function GET() {
  // From the nest, always (nuthatch#1160); the gateway path this once fell back to left with the key.
  if (!hasNuthatch()) {
    return NextResponse.json({ error: 'Nuthatch is not configured' }, { status: 503 });
  }
  try {
    const data = await cached('lodestar:deployments-fees-30d:nuthatch:v1', 300, async () => {
      const since = Math.floor(Date.now() / 1000) - 30 * 86400;
      const fees = await nuthatchSqlReady<NestDeploymentFeesRow>(deploymentFeesSinceSql(since, 200), ALLOC_BASE_PATH);
      if (!fees.ok) throw Object.assign(new Error(fees.error), { nest: fees });
      if (fees.data.rows.length === 0) return [] as AggregatedDeployment[];
      const ids = fees.data.rows.map((r) => r.id);
      const deps = await nuthatchSqlReady<NestDeploymentListRow>(deploymentsByIdSql(ids), ALLOC_BASE_PATH);
      if (!deps.ok) throw Object.assign(new Error(deps.error), { nest: deps });
      const byId = new Map(deps.data.rows.map((d) => [d.id.toLowerCase(), d]));
      const meta = await subgraphMetadataForDeployments(ids);
      const out: AggregatedDeployment[] = [];
      for (const f of fees.data.rows) {
        const d = byId.get(f.id.toLowerCase());
        if (!d) continue;
        if (BigInt(d.signalled_tokens) <= BigInt('1000000000000000000')) continue; // dust signal, as before
        const m = meta.get(f.id.toLowerCase());
        out.push({ ...deploymentRowToApi(d, { displayName: m?.metadata?.displayName ?? null, categories: m?.metadata?.categories ?? [] }), queryFees30d: f.query_fees });
      }
      return out;
    });
    return NextResponse.json({ data, source: 'nuthatch' }, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
    });
  } catch (error) {
    log.api.error({ err: error }, '30-day fees from the nest failed');
    return NextResponse.json({ error: 'Failed to load 30-day fees from Nuthatch' }, { status: 503 });
  }
}
