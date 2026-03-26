/**
 * Individual scoring components for the leaderboard (RFC-003).
 * Each function is pure — takes raw metrics + percentile bounds, returns points.
 */

import { normalize, normalizeInverted } from './normalize';

// ── Component 1: Network Contribution (35 pts) ───────────

/** Query Fees Earned — 20 pts. Percentile-normalised. */
export function scoreQueryFees(
  feesGrt: number,
  p10: number,
  p90: number
): number {
  return normalize(feesGrt, p10, p90, 20);
}

/** Allocation Efficiency — 15 pts. Fees-to-allocated ratio, percentile-normalised. */
export function scoreAllocationEfficiency(
  ratio: number,
  p10: number,
  p90: number
): number {
  return normalize(ratio, p10, p90, 15);
}

// ── Component 2: Economics (25 pts) ───────────────────────

/** Delegator APR — 10 pts. Percentile-normalised. */
export function scoreDelegatorApr(
  apr: number,
  p10: number,
  p90: number
): number {
  return normalize(apr, p10, p90, 10);
}

/** Effective Cut Fairness — 10 pts. Lower cut = higher score. */
export function scoreEffectiveCut(
  effectiveCutPct: number,
  p10: number,
  p90: number
): number {
  return normalizeInverted(effectiveCutPct, p10, p90, 10);
}

/** Delegation Capacity Health — 5 pts. Bucket scoring. */
export function scoreDelegationCapacity(capacityUsedPct: number): number {
  if (capacityUsedPct >= 100) return 0;
  if (capacityUsedPct >= 90) return 1;
  if (capacityUsedPct >= 70) return 3;
  return 5;
}

// ── Component 3: Trust & Stability (20 pts) ───────────────

/**
 * Reward Cut Stability — 12 pts.
 * Looks at net reward cut changes over 12 months.
 * Increases are bad, decreases are fine.
 * @param netChangePpm - net change in reward cut (PPM). Positive = increases outweigh decreases.
 */
export function scoreCutStability(netChangePpm: number): number {
  if (netChangePpm <= 0) return 12;       // Stable or lowered — full marks
  if (netChangePpm <= 50000) return 8;    // Small increase (~5%)
  if (netChangePpm <= 100000) return 4;   // Moderate increase (~10%)
  return 0;                                // Large increase (>10%)
}

/**
 * Tenure Bonus — 5 pts.
 * @param monthsActive - months since indexer creation
 */
export function scoreTenure(monthsActive: number): number {
  if (monthsActive >= 24) return 5;
  if (monthsActive >= 12) return 3;
  if (monthsActive >= 6) return 2;
  if (monthsActive >= 3) return 1;
  return 0;
}

/**
 * Delegation Retention — 3 pts.
 * Net delegation flow over 30 days.
 * @param netFlowGrt - positive = inflow, negative = outflow
 */
export function scoreRetention(netFlowGrt: number): number {
  if (netFlowGrt > 0) return 3;
  if (netFlowGrt >= -10000) return 2;
  if (netFlowGrt >= -100000) return 1;
  return 0;
}

// ── Component 4: Protocol Health (10 pts) ─────────────────

/** REO Eligibility — 4 pts. */
export function scoreReo(status: string): number {
  if (status === 'eligible') return 4;
  if (status === 'warning') return 2;
  return 0; // ineligible or unknown
}

/**
 * POI Consensus Rate — 4 pts.
 * @param consensusRate - fraction (0–1) of allocations matching consensus POI
 */
export function scorePoiConsensus(consensusRate: number | null): number {
  if (consensusRate === null) return 2; // No data — neutral score
  if (consensusRate >= 0.99) return 4;
  if (consensusRate >= 0.95) return 3;
  if (consensusRate >= 0.90) return 2;
  if (consensusRate >= 0.80) return 1;
  return 0;
}

/**
 * Active Allocation Breadth — 2 pts.
 * @param distinctDeployments - number of distinct subgraph deployments with active allocations
 */
export function scoreAllocationBreadth(distinctDeployments: number): number {
  if (distinctDeployments >= 10) return 2;
  if (distinctDeployments >= 5) return 1;
  return 0;
}
