import { NextResponse, type NextRequest } from 'next/server';
import { cached } from '@/lib/cache';
import { subgraphQuery, hasSubgraphAccess } from '@/lib/subgraph';
import { log } from '@/lib/logger';
import { hasNuthatch, nuthatchEnabled, nuthatchSqlReady } from '@/lib/nuthatch';
import { deploymentSignalsSql, type NestDeploymentSignalRow } from '@/lib/nest-queries';
import { ipfsHashToBytes32 } from '@/lib/studio/ipfs';

const ALLOC_BASE_PATH = process.env.NUTHATCH_ALLOCATIONS_BASE_PATH || '/alloc';

interface RawSignal {
  id: string;
  signalledTokens: string;
  unsignalledTokens: string;
  signal: string;
  lastSignalChange: number;
  realizedRewards: string;
}

interface RawDeployment {
  signalledTokens: string;
  queryFeesAmount: string;
  curatorSignals: RawSignal[];
}

const IPFS_HASH_RE = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ hash: string }> },
) {
  const { hash } = await params;

  if (!IPFS_HASH_RE.test(hash)) {
    return NextResponse.json({ error: 'Invalid deployment hash' }, { status: 400 });
  }

  // Behind NUTHATCH_SUBGRAPHS (nuthatch#1160, group B): curation for the deployment from
  // graph-allocations-nest's `lodestar_curator_signals`; the gateway is not consulted. Signal ids
  // keep the subgraph's `<curator>-<deployment>` shape, so `curatorAddress` splits as before.
  if (nuthatchEnabled('NUTHATCH_SUBGRAPHS') && hasNuthatch()) {
    try {
      const data = await cached(`lodestar:curation:${hash}:nuthatch:v1`, 300, async () => {
        const id = ipfsHashToBytes32(hash).toLowerCase();
        const r = await nuthatchSqlReady<NestDeploymentSignalRow>(deploymentSignalsSql(id, 100), ALLOC_BASE_PATH);
        if (!r.ok) throw Object.assign(new Error(r.error), { nest: r });
        const rows = r.data.rows;
        if (rows.length === 0) return { signals: [], totalSignalledTokens: '0', queryFeesAmount: '0' };
        return {
          signals: rows.map((s) => ({
            id: s.id, signalledTokens: s.signalled_tokens, unsignalledTokens: s.unsignalled_tokens, signal: s.signal,
            lastSignalChange: Number(s.last_signal_change ?? 0), realizedRewards: s.realized_rewards, curatorAddress: s.curator,
          })),
          totalSignalledTokens: rows[0].deployment_signalled_tokens,
          queryFeesAmount: rows[0].deployment_query_fees_amount ?? '0',
        };
      });
      return NextResponse.json({ data, source: 'nuthatch' }, {
        headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
      });
    } catch (error) {
      log.api.error({ err: error }, 'Subgraph curation from the nest failed');
      return NextResponse.json({ error: 'Failed to load curation data from Nuthatch' }, { status: 503 });
    }
  }
  if (!hasSubgraphAccess()) {
    return NextResponse.json({ error: 'No API key configured' }, { status: 503 });
  }

  const query = `{
    subgraphDeployments(where: { ipfsHash: "${hash}" }, first: 1) {
      signalledTokens
      queryFeesAmount
      curatorSignals(first: 100, orderBy: signalledTokens, orderDirection: desc) {
        id
        signalledTokens
        unsignalledTokens
        signal
        lastSignalChange
        realizedRewards
      }
    }
  }`;

  const cacheKey = `lodestar:curation:${hash}`;

  try {
    const data = await cached(cacheKey, 300, async () => {
      const result = await subgraphQuery<{ subgraphDeployments: RawDeployment[] }>(query);
      const deployment = result.subgraphDeployments[0];
      if (!deployment) return { signals: [], totalSignalledTokens: '0' };

      const signals = deployment.curatorSignals.map((s) => ({
        ...s,
        // Signal ID format: <curatorAddress>-<deploymentId>
        curatorAddress: s.id.split('-')[0],
      }));

      return {
        signals,
        totalSignalledTokens: deployment.signalledTokens,
        queryFeesAmount: deployment.queryFeesAmount ?? '0',
      };
    });

    return NextResponse.json({ data }, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
    });
  } catch (error) {
    log.api.error({ err: error }, 'Subgraph curation error');
    return NextResponse.json({ error: 'Failed to fetch curation data' }, { status: 500 });
  }
}
