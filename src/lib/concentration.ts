/**
 * Network concentration + crowding-out analysis (pure, testable).
 *
 * Turns per-indexer (allocation, QoS quality) into:
 *  - concentration metrics: Gini, Nakamoto coefficient, top-N share
 *  - quality-tier capture: how much allocation each quality band holds
 *  - crowding-out: GRT captured by low-/zero-value indexers + counterfactual redistribution
 *
 * Reproduces the "indexing rewards" harm chart from live data instead of hand-estimates.
 */

export interface IndexerAllocation {
  /** GRT allocated (the reward-bearing weight). */
  allocated_grt: number;
  /** QoS quality 0–100, or null if the gateway never routed traffic (no QoS data). */
  q_score: number | null;
}

export type QualityTier = 'zero' | 'low' | 'fair' | 'good' | 'unscored';

export interface TierCapture {
  tier: QualityTier;
  label: string;
  indexers: number;
  alloc_grt: number;
  alloc_share: number; // 0..1 of total allocation
}

export interface Concentration {
  totalAllocatedGrt: number;
  indexerCount: number;
  gini: number; // 0 (equal) .. 1 (one entity holds all)
  nakamoto: number; // min entities to exceed 50% of allocation
  topNShare: number; // share held by the top N (default 6)
  topN: number;
  tiers: TierCapture[];
  /** Allocation held by zero+low-value (and unscored) indexers — the crowded-out slice. */
  lowValueGrt: number;
  lowValueShare: number;
  /** If low-value allocations were redistributed, productive indexers' rewards scale by this factor. */
  productiveUpliftFactor: number;
}

const TIER_LABELS: Record<QualityTier, string> = {
  zero: 'Providing ~0 value (Q<15)',
  low: 'Very low / narrow (Q 15–30)',
  fair: 'Fair (Q 30–60)',
  good: 'Good (Q≥60)',
  unscored: 'Unscored (no routed traffic)',
};

function tierOf(q: number | null): QualityTier {
  if (q == null) return 'unscored';
  if (q < 15) return 'zero';
  if (q < 30) return 'low';
  if (q < 60) return 'fair';
  return 'good';
}

/** Gini coefficient over non-negative values. 0 = perfectly equal, →1 = maximally concentrated. */
export function gini(values: number[]): number {
  const xs = values.filter((v) => v > 0).sort((a, b) => a - b);
  const n = xs.length;
  if (n === 0) return 0;
  const total = xs.reduce((s, v) => s + v, 0);
  if (total === 0) return 0;
  let cum = 0;
  for (let i = 0; i < n; i++) cum += (i + 1) * xs[i];
  return (2 * cum) / (n * total) - (n + 1) / n;
}

/** Nakamoto coefficient: min number of top holders whose combined share exceeds `threshold`. */
export function nakamoto(values: number[], threshold = 0.5): number {
  const xs = values.filter((v) => v > 0).sort((a, b) => b - a);
  const total = xs.reduce((s, v) => s + v, 0);
  if (total === 0) return 0;
  let cum = 0;
  for (let i = 0; i < xs.length; i++) {
    cum += xs[i];
    if (cum / total > threshold) return i + 1;
  }
  return xs.length;
}

export function computeConcentration(rows: IndexerAllocation[], topN = 6): Concentration {
  const allocs = rows.map((r) => r.allocated_grt).filter((v) => v > 0);
  const totalAllocatedGrt = allocs.reduce((s, v) => s + v, 0);

  // Tier capture.
  const tierAgg = new Map<QualityTier, { indexers: number; alloc: number }>();
  let lowValueGrt = 0;
  for (const r of rows) {
    if (r.allocated_grt <= 0) continue;
    const t = tierOf(r.q_score);
    const a = tierAgg.get(t) ?? { indexers: 0, alloc: 0 };
    a.indexers += 1;
    a.alloc += r.allocated_grt;
    tierAgg.set(t, a);
    if (t === 'zero' || t === 'low' || t === 'unscored') lowValueGrt += r.allocated_grt;
  }

  const order: QualityTier[] = ['zero', 'low', 'unscored', 'fair', 'good'];
  const tiers: TierCapture[] = order
    .filter((t) => tierAgg.has(t))
    .map((t) => {
      const a = tierAgg.get(t)!;
      return {
        tier: t,
        label: TIER_LABELS[t],
        indexers: a.indexers,
        alloc_grt: a.alloc,
        alloc_share: totalAllocatedGrt > 0 ? a.alloc / totalAllocatedGrt : 0,
      };
    });

  const sortedDesc = [...allocs].sort((a, b) => b - a);
  const topNShare = totalAllocatedGrt > 0
    ? sortedDesc.slice(0, topN).reduce((s, v) => s + v, 0) / totalAllocatedGrt
    : 0;

  const lowValueShare = totalAllocatedGrt > 0 ? lowValueGrt / totalAllocatedGrt : 0;
  const productiveUpliftFactor = lowValueShare < 1 ? 1 / (1 - lowValueShare) : Infinity;

  return {
    totalAllocatedGrt,
    indexerCount: allocs.length,
    gini: gini(allocs),
    nakamoto: nakamoto(allocs),
    topNShare,
    topN,
    tiers,
    lowValueGrt,
    lowValueShare,
    productiveUpliftFactor,
  };
}
