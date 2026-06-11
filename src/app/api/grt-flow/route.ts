import { NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { subgraphQuery, hasSubgraphAccess } from '@/lib/subgraph';
import { weiToGRT, ppmToPercent } from '@/lib/utils';
import { annualIssuancePercent, L1_BLOCKS_PER_YEAR } from '@/lib/network-math';
import { fetchGrtSupplyBreakdown } from '@/lib/grt-supply';
import { CIRCULATING_SUPPLY_APPROX } from '@/lib/grt-flow-data';
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
      const [resp, supplyBreakdown] = await Promise.all([
        subgraphQuery<RawResp>(GRT_FLOW_QUERY),
        fetchGrtSupplyBreakdown(),
      ]);
      const n = resp.graphNetwork;
      if (!n) throw new Error('graphNetwork entity missing');

      // The network subgraph's totalSupply tracks L2 net mint−burn (~3.6B) only — useful as an L2
      // footprint, but NOT the denominator for issuance. The honest rate is per-block issuance over
      // the *global* supply (L1 + L2 − bridge escrow ≈ 11.5B), read on-chain. If those reads fail we
      // fall back to the static circulating-supply approximation — never to the L2-only basis, which
      // overstates the rate ~3× (the 8.6% confusion).
      const supply = grt(n.totalSupply);
      const globalSupply = supplyBreakdown?.globalSupply ?? CIRCULATING_SUPPLY_APPROX;
      const supplyBasis: 'onchain' | 'approx' = supplyBreakdown ? 'onchain' : 'approx';
      const issuancePerBlock = grt(n.networkGRTIssuancePerBlock);
      const annualIssuance = issuancePerBlock * L1_BLOCKS_PER_YEAR;
      const issuanceRatePct = annualIssuancePercent(issuancePerBlock, globalSupply);

      return {
        blockNumber: resp._meta?.block?.number ?? null,
        supply,
        globalSupply,
        supplyBasis,
        supplyBreakdown,
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
