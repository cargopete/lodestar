import { NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { weiToGRT, ppmToPercent } from '@/lib/utils';
import { annualIssuancePercent, L1_BLOCKS_PER_YEAR } from '@/lib/network-math';
import { fetchGrtSupplyBreakdown } from '@/lib/grt-supply';
import { CIRCULATING_SUPPLY_APPROX } from '@/lib/grt-flow-data';
import { log } from '@/lib/logger';
import { hasNuthatch } from '@/lib/nuthatch';
import { networkFromNest } from '@/app/api/network-stats/route';

const grt = (v: string | null | undefined) => weiToGRT(v ?? '0');

// GET /api/grt-flow — live GRT supply / issuance / burn aggregates from the network subgraph.
export async function GET() {
  // From the nest, always (nuthatch#1160). The gateway path this once fell back to left with the key.
  if (!hasNuthatch()) {
    return NextResponse.json({ error: 'Nuthatch is not configured' }, { status: 503 });
  }
  try {
    const data = await cached('lodestar:grt-flow:aggregates:nuthatch:v1', 1800, async () => {
      const [net, supplyBreakdown] = await Promise.all([networkFromNest(), fetchGrtSupplyBreakdown()]);
      const n = net.graphNetwork; const p = net.params;
      const supply = grt(n.totalSupply ?? null);
      const globalSupply = supplyBreakdown?.globalSupply ?? CIRCULATING_SUPPLY_APPROX;
      const supplyBasis: 'onchain' | 'approx' = supplyBreakdown ? 'onchain' : 'approx';
      const issuancePerBlock = grt(n.networkGRTIssuancePerBlock ?? null);
      const annualIssuance = issuancePerBlock * L1_BLOCKS_PER_YEAR;
      const issuanceRatePct = annualIssuancePercent(issuancePerBlock, globalSupply);
      const bridgeMinted = BigInt(net.raw.bridge_minted ?? '0'); const bridgeBurned = BigInt(net.raw.bridge_burned ?? '0');
      const minted = (bridgeMinted + BigInt(n.totalIndexingRewards)).toString();
      const burned = (bridgeBurned + BigInt(p.total_curation_tax ?? '0') + BigInt(p.total_protocol_tax ?? '0')).toString();
      return {
        blockNumber: net.asOf,
        supply, globalSupply, supplyBasis, supplyBreakdown,
        minted: grt(minted),
        burned: grt(burned),
        indexingRewards: grt(n.totalIndexingRewards),
        queryFees: grt(n.totalQueryFees),
        staked: grt(n.totalTokensStaked),
        delegated: grt(n.totalDelegatedTokens),
        signalled: grt(n.totalTokensSignalled),
        allocated: grt(n.totalTokensAllocated),
        issuancePerBlock, annualIssuance, issuanceRatePct,
        counts: {
          indexers: n.indexerCount, stakedIndexers: n.stakedIndexersCount, delegators: n.delegatorCount,
          curators: n.curatorCount, currentEpoch: n.currentEpoch,
        },
        params: {
          protocolFeePct: ppmToPercent(n.protocolFeePercentage),
          curationTaxPct: ppmToPercent(Number(p.curation_tax_percentage ?? 0)),
          delegationTaxPct: 0,
          delegationRatio: n.delegationRatio,
        },
        source: 'nuthatch',
      };
    });
    return NextResponse.json({ data }, {
      headers: { 'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=3600' },
    });
  } catch (error) {
    log.api.error({ err: error }, 'GRT flow from the nest failed');
    return NextResponse.json({ error: 'Failed to load GRT flow from Nuthatch' }, { status: 503 });
  }
}
