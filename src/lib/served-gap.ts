// Split-invariant served-gap (RFC-006 D3).
//
// The enforcement-relevant number: per identity, how much of the query volume
// its allocation *implies* it should serve does it actually serve?
//
//   servedGap_{i,d} = allocShare_{i,d} − servedShare_{i,d}
//
// where allocShare is i's stake on d ÷ total stake on d, and servedShare is i's
// served queries on d ÷ total served on d. Aggregated per identity, stake-
// weighted across its deployments.
//
// Why it needs ZERO attribution (the whole point): splitting one operator's
// stake across N identities splits BOTH shares proportionally, so each fragment
// carries a service obligation it meets or doesn't — splitting neither helps nor
// hides. A high gap is damning for an identity whether it's a solo or one head
// of a hydra. Pure and deterministic.

export interface ServedGapRow {
  /** i's allocated stake on d ÷ total allocated on d (0..1) */
  allocShare: number;
  /** i's served queries on d ÷ total served on d (0..1) */
  servedShare: number;
  /** i's allocated stake on d (wei or GRT) — the aggregation weight */
  weight: number;
}

/** Per-deployment gap. Positive = under-serving relative to allocation. */
export function servedGap(allocShare: number, servedShare: number): number {
  return allocShare - servedShare;
}

/**
 * Stake-weighted mean served-gap for one identity across its deployments.
 * Returns null when the identity has no allocated weight (nothing to judge).
 */
export function aggregateServedGap(rows: ServedGapRow[]): number | null {
  let wSum = 0;
  let gapSum = 0;
  for (const r of rows) {
    const w = Math.max(r.weight, 0);
    if (w === 0) continue;
    wSum += w;
    gapSum += w * servedGap(r.allocShare, r.servedShare);
  }
  if (wSum === 0) return null;
  return gapSum / wSum;
}

// A small tolerance: serving slightly under your allocation share is normal
// (gateway routing is lumpy). Beyond it, the score ramps to zero at a total
// leech (allocated heavily, serves ~nothing).
const TOLERANCE = 0.05;

/**
 * Score a served-gap 0–100 (higher = healthier). gap ≤ tolerance → 100; a total
 * leech (gap → 1) → 0. Serving MORE than your allocation share (negative gap)
 * is fine, also 100. Replaces the old fee-volume score, which rewarded a
 * high-volume leech for the very volume it was failing to serve.
 */
export function scoreServedGap(gap: number): number {
  const over = (gap - TOLERANCE) / (1 - TOLERANCE);
  const clamped = Math.min(Math.max(over, 0), 1);
  return Math.round(100 * (1 - clamped));
}
