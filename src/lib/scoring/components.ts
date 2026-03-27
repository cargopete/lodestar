/**
 * Individual scoring components for the leaderboard (RFC-003).
 * Each function is pure — takes raw metrics + percentile bounds, returns points.
 *
 * The community leaderboard prioritises network service over economics.
 * Delegator-focused metrics (APR, effective cut) live on the Indexers table score.
 */

import { normalize } from './normalize';

// ── Component 1: Network Service (40 pts) ─────────────────

/** Subgraph Coverage — 20 pts. Distinct active deployments, percentile-normalised. */
export function scoreAllocationBreadth(
  distinctDeployments: number,
  p10: number,
  p90: number
): number {
  return normalize(distinctDeployments, p10, p90, 20);
}

/** Query Fees Earned — 10 pts. Percentile-normalised. */
export function scoreQueryFees(
  feesGrt: number,
  p10: number,
  p90: number
): number {
  return normalize(feesGrt, p10, p90, 10);
}

/** Allocation Efficiency — 10 pts. Fees-to-allocated ratio, percentile-normalised. */
export function scoreAllocationEfficiency(
  ratio: number,
  p10: number,
  p90: number
): number {
  return normalize(ratio, p10, p90, 10);
}

// ── Component 2: Community (25 pts) ───────────────────────
// Scored in compute.ts from vote tallies (proportional to max weighted votes).

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

// ── Component 4: Protocol Health (6 pts) ──────────────────

/** REO Eligibility — 6 pts. */
export function scoreReo(status: string): number {
  if (status === 'eligible') return 6;
  if (status === 'warning') return 3;
  return 0; // ineligible or unknown
}

// ── Component 5: Economics (5 pts) ────────────────────────

/** Delegation Capacity Health — 5 pts. Room for new delegators. */
export function scoreDelegationCapacity(capacityUsedPct: number): number {
  if (capacityUsedPct >= 100) return 0;
  if (capacityUsedPct >= 90) return 1;
  if (capacityUsedPct >= 70) return 3;
  return 5;
}
