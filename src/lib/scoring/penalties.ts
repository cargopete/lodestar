/**
 * Penalty multiplier calculation (RFC-003).
 *
 * Penalties are multiplicative — they stack.
 * An indexer can recover as penalties expire.
 */

export interface PenaltyInput {
  /** Active undecided dispute */
  hasActiveDispute: boolean;
  /** Accepted slashing within 12 months */
  hasRecentSlashing: boolean;
  /** Accepted slashing 12–24 months ago (lighter penalty) */
  hasOlderSlashing: boolean;
  /** 3+ reward cut increases in 12 months */
  hasRepeatedCutIncreases: boolean;
  /** POI consensus rate below 80% in last 30 days */
  hasLowPoiConsensus: boolean;
  /** Zero query fees in 30 days despite active allocations */
  hasZeroFees: boolean;
  /** Self-stake below 100K GRT (REO minimum) */
  hasBelowMinStake: boolean;
}

export interface PenaltyResult {
  multiplier: number;
  reasons: string[];
}

export function calculatePenalties(input: PenaltyInput): PenaltyResult {
  let multiplier = 1.0;
  const reasons: string[] = [];

  if (input.hasActiveDispute) {
    multiplier *= 0.50;
    reasons.push('Active slashing dispute (×0.50)');
  }

  if (input.hasRecentSlashing) {
    multiplier *= 0.60;
    reasons.push('Accepted slashing within 12 months (×0.60)');
  } else if (input.hasOlderSlashing) {
    multiplier *= 0.85;
    reasons.push('Accepted slashing 12–24 months ago (×0.85)');
  }

  if (input.hasRepeatedCutIncreases) {
    multiplier *= 0.75;
    reasons.push('3+ reward cut increases in 12 months (×0.75)');
  }

  if (input.hasLowPoiConsensus) {
    multiplier *= 0.80;
    reasons.push('POI consensus < 80% last 30 days (×0.80)');
  }

  if (input.hasZeroFees) {
    multiplier *= 0.85;
    reasons.push('Zero query fees in 30 days (×0.85)');
  }

  if (input.hasBelowMinStake) {
    multiplier *= 0.90;
    reasons.push('Self-stake below 100K GRT (×0.90)');
  }

  return { multiplier: Math.max(0.1, multiplier), reasons };
}
