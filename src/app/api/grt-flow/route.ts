import { NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { subgraphQuery, hasSubgraphAccess } from '@/lib/subgraph';
import { weiToGRT, ppmToPercent } from '@/lib/utils';
import { BLOCKS_PER_YEAR } from '@/lib/grt-flow-data';
import { log } from '@/lib/logger';

// GraphNetwork singleton on graph-network-arbitrum — the authoritative aggregate.
const GRT_FLOW_QUERY = `
  {
    graphNetwork(id: "1") {
      totalSupply
      totalGRTMinted
      totalGRTBurned
      totalTokensStaked
      totalDelegatedTokens
      totalTokensSignalled
      totalTokensAllocated
      totalIndexingRewards
      totalQueryFees
      networkGRTIssuancePerBlock
      currentEpoch
      indexerCount
      stakedIndexersCount
      delegatorCount
      curatorCount
      protocolFeePercentage
      curationPercentage
      delegationTaxPercentage
      delegationRatio
    }
    _meta { block { number } }
  }
`;

interface RawGraphNetwork {
  totalSupply: string | null;
  totalGRTMinted: string | null;
  totalGRTBurned: string | null;
  totalTokensStaked: string | null;
  totalDelegatedTokens: string | null;
  totalTokensSignalled: string | null;
  totalTokensAllocated: string | null;
  totalIndexingRewards: string | null;
  totalQueryFees: string | null;
  networkGRTIssuancePerBlock: string | null;
  currentEpoch: number;
  indexerCount: number;
  stakedIndexersCount: number;
  delegatorCount: number;
  curatorCount: number;
  protocolFeePercentage: number;
  curationPercentage: number;
  delegationTaxPercentage: number;
  delegationRatio: number;
}

interface RawResp {
  graphNetwork: RawGraphNetwork | null;
  _meta?: { block?: { number?: number } };
}

const grt = (v: string | null | undefined) => weiToGRT(v ?? '0');

// GET /api/grt-flow — live GRT supply / issuance / burn aggregates from the network subgraph.
export async function GET() {
  if (!hasSubgraphAccess()) {
    return NextResponse.json({ error: 'GRAPH_API_KEY not configured' }, { status: 503 });
  }

  try {
    const data = await cached('lodestar:grt-flow:aggregates', 1800, async () => {
      const resp = await subgraphQuery<RawResp>(GRT_FLOW_QUERY);
      const n = resp.graphNetwork;
      if (!n) throw new Error('graphNetwork entity missing');

      const supply = grt(n.totalSupply);
      const issuancePerBlock = grt(n.networkGRTIssuancePerBlock);
      const annualIssuance = issuancePerBlock * BLOCKS_PER_YEAR;
      const issuanceRatePct = supply > 0 ? (annualIssuance / supply) * 100 : 0;

      return {
        blockNumber: resp._meta?.block?.number ?? null,
        supply,
        minted: grt(n.totalGRTMinted),
        burned: grt(n.totalGRTBurned),
        indexingRewards: grt(n.totalIndexingRewards),
        queryFees: grt(n.totalQueryFees),
        staked: grt(n.totalTokensStaked),
        delegated: grt(n.totalDelegatedTokens),
        signalled: grt(n.totalTokensSignalled),
        allocated: grt(n.totalTokensAllocated),
        issuancePerBlock,
        annualIssuance,
        issuanceRatePct,
        counts: {
          indexers: n.indexerCount ?? 0,
          stakedIndexers: n.stakedIndexersCount ?? 0,
          delegators: n.delegatorCount ?? 0,
          curators: n.curatorCount ?? 0,
          currentEpoch: n.currentEpoch ?? 0,
        },
        params: {
          // Protocol params are stored in PPM (10000 = 1%); ppmToPercent → percent.
          protocolFeePct: ppmToPercent(n.protocolFeePercentage ?? 0),
          curationTaxPct: ppmToPercent(n.curationPercentage ?? 0),
          delegationTaxPct: ppmToPercent(n.delegationTaxPercentage ?? 0),
          delegationRatio: n.delegationRatio ?? 0,
        },
      };
    });

    return NextResponse.json({ data }, {
      headers: { 'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=3600' },
    });
  } catch (error) {
    log.api.error({ err: error }, 'GRT flow aggregates error');
    return NextResponse.json({ error: 'Failed to fetch GRT flow aggregates' }, { status: 500 });
  }
}
