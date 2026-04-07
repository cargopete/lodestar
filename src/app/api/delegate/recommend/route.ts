import { NextRequest, NextResponse } from 'next/server';
import { cacheGet } from '@/lib/cache';
import { SCORE_WEIGHTS } from '@/lib/risk-score';
import type { EnrichedIndexer } from '@/lib/enriched';

export type RecommendResponse = {
  indexer: EnrichedIndexer;
  score: number;
  reasons: string[];
};

// Which score dimensions each preference slider amplifies
const PREF_DIMS: Record<string, (keyof typeof SCORE_WEIGHTS)[]> = {
  returns:   ['delegatorAPY', 'delegatorCut'],
  stability: ['cutStability'],
  safety:    ['overDelegation', 'selfStake'],
  network:   ['queryVolume', 'allocationEfficiency', 'reo'],
};

function buildWeights(prefs: Record<string, number>): Record<string, number> {
  const w: Record<string, number> = { ...SCORE_WEIGHTS };

  for (const [pref, dims] of Object.entries(PREF_DIMS)) {
    const mult = (prefs[pref] ?? 5) / 5; // 0→0, 5→1, 10→2
    for (const dim of dims) w[dim] = (w[dim] ?? 0) * mult;
  }

  // Normalize so weights still sum to 100
  const total = Object.values(w).reduce((s, v) => s + v, 0);
  if (total === 0) return w;
  const factor = 100 / total;
  return Object.fromEntries(Object.entries(w).map(([k, v]) => [k, v * factor]));
}

function computeScore(indexer: EnrichedIndexer, weights: Record<string, number>): number {
  const bd = indexer.scoreBreakdown as Record<string, number>;
  return Object.entries(weights).reduce(
    (sum, [dim, w]) => sum + ((bd[dim] ?? 0) * w) / 100,
    0,
  );
}

function buildReasons(indexer: EnrichedIndexer, weights: Record<string, number>): string[] {
  const bd = indexer.scoreBreakdown as Record<string, number>;

  // Top 3 contributing dimensions
  const top = Object.entries(weights)
    .map(([dim, w]) => ({ dim, contribution: ((bd[dim] ?? 0) * w) / 100 }))
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 3)
    .map(({ dim }) => dim);

  return top.map((dim) => {
    switch (dim) {
      case 'delegatorAPY': {
        const apy = indexer.rollingAPY30d ?? indexer.delegatorAPR;
        return `${apy.toFixed(1)}% estimated APR`;
      }
      case 'delegatorCut': {
        const share = ((1 - indexer.indexingRewardCut / 1_000_000) * 100).toFixed(0);
        return `${share}% delegator reward share`;
      }
      case 'cutStability': {
        const days = Math.floor((Date.now() / 1000 - indexer.lastDelegationParameterUpdate) / 86400);
        return days >= 180
          ? `Cut stable for ${Math.floor(days / 30)} months`
          : `Cut unchanged for ${days} days`;
      }
      case 'overDelegation':
        return `${indexer.delegationCapacity.utilizationPercent.toFixed(0)}% delegation capacity used`;
      case 'selfStake': {
        const k = Math.round(indexer.selfStakeGRT / 1000);
        return `${k >= 1000 ? `${(k / 1000).toFixed(1)}M` : `${k}K`} GRT self-staked`;
      }
      case 'reo':
        return 'REO eligible';
      case 'queryVolume': {
        const fees = indexer.queryFeesCollectedGRT;
        return fees >= 1000
          ? `${(fees / 1000).toFixed(0)}K GRT in query fees`
          : `${fees.toFixed(0)} GRT in query fees`;
      }
      case 'allocationEfficiency':
        return 'High allocation efficiency';
      case 'transparency':
        return indexer.ensName ? `ENS: ${indexer.ensName}` : 'Verified identity';
      case 'delegationTrend':
        return indexer.recentActivity.netFlowGRT > 0 ? 'Net delegation inflow (7d)' : 'Stable delegation (7d)';
      default:
        return '';
    }
  }).filter(Boolean);
}

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;

  const prefs = {
    returns:   Math.min(10, Math.max(0, Number(sp.get('returns')   ?? 5))),
    stability: Math.min(10, Math.max(0, Number(sp.get('stability') ?? 5))),
    safety:    Math.min(10, Math.max(0, Number(sp.get('safety')    ?? 5))),
    network:   Math.min(10, Math.max(0, Number(sp.get('network')   ?? 5))),
  };

  const indexers = await cacheGet<EnrichedIndexer[]>('lodestar:indexers-enriched');

  if (!indexers?.length) {
    return NextResponse.json({ error: 'Indexer data not yet available' }, { status: 503 });
  }

  const eligible = indexers.filter(
    (i) =>
      i.reoStatus === 'eligible' &&
      i.delegationCapacity.utilizationPercent < 90 &&
      i.indexingRewardCut < 900_000,
  );

  if (!eligible.length) {
    return NextResponse.json({ error: 'No eligible indexers found' }, { status: 404 });
  }

  const weights = buildWeights(prefs);
  const ranked = eligible
    .map((i) => ({ indexer: i, score: computeScore(i, weights) }))
    .sort((a, b) => b.score - a.score);

  const { indexer, score } = ranked[0];

  return NextResponse.json(
    { indexer, score: Math.round(score), reasons: buildReasons(indexer, weights) } satisfies RecommendResponse,
    { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } },
  );
}
