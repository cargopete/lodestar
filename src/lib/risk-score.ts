/**
 * Composite Indexer Risk Score
 *
 * Seven dimensions, each scored 0–100, combined with transparent weights
 * into a single 0–100 composite score. Higher = better for delegators.
 *
 * Dimensions & weights:
 *   REO compliance     25%  — gates rewards; most critical signal
 *   Self-stake ratio   20%  — skin in the game
 *   Cut stability      15%  — trust / predictability
 *   Allocation efficiency 15% — operational competence
 *   Over-delegation    10%  — delegation safety margin
 *   Transparency       10%  — presence and accountability
 *   Delegation trend    5%  — crowd signal (noisy, low weight)
 */

export interface ScoreBreakdown {
  reo: number;
  selfStake: number;
  cutStability: number;
  allocationEfficiency: number;
  overDelegation: number;
  transparency: number;
  delegationTrend: number;
}

export interface IndexerScore {
  composite: number;         // 0–100 weighted score
  breakdown: ScoreBreakdown; // per-dimension scores (each 0–100)
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
}

export const SCORE_WEIGHTS: Record<keyof ScoreBreakdown, number> = {
  reo: 25,
  selfStake: 20,
  cutStability: 15,
  allocationEfficiency: 15,
  overDelegation: 10,
  transparency: 10,
  delegationTrend: 5,
};

export const SCORE_LABELS: Record<keyof ScoreBreakdown, string> = {
  reo: 'REO Compliance',
  selfStake: 'Self-Stake',
  cutStability: 'Cut Stability',
  allocationEfficiency: 'Allocation Efficiency',
  overDelegation: 'Delegation Safety',
  transparency: 'Transparency',
  delegationTrend: 'Delegation Trend',
};

// --- Individual dimension scorers ---

/**
 * REO compliance: eligible with plenty of renewal runway = 100, ineligible = 0
 */
function scoreREO(
  status: 'eligible' | 'ineligible' | 'unknown',
  daysRemaining: number | null,
  source: 'oracle' | 'heuristic',
): number {
  if (status === 'ineligible') return 0;

  if (source === 'oracle' && status === 'eligible' && daysRemaining !== null) {
    if (daysRemaining >= 7) return 100;
    if (daysRemaining >= 3) return 80;
    if (daysRemaining > 0) return 60;
    return 20; // eligible but overdue renewal — oracle lag?
  }

  // Heuristic or unknown — partial credit
  if (status === 'eligible') return 50;
  return 25;
}

/**
 * Self-stake ratio: higher own-stake proportion = more skin in the game.
 * Scaled so ~10% = 50, ~25% = 80, 50%+ = 100.
 */
function scoreSelfStake(ownStakeRatio: number | null, selfStakeGRT: number): number {
  if (selfStakeGRT === 0) return 0;

  // ownStakeRatio is already 0–100 percentage from subgraph
  const ratio = ownStakeRatio ?? 0;
  if (ratio >= 50) return 100;
  if (ratio >= 25) return 80;
  if (ratio >= 10) return Math.round(50 + ((ratio - 10) / 15) * 30); // 50–80 linear
  if (ratio >= 1) return Math.round(10 + ((ratio - 1) / 9) * 40);    // 10–50 linear
  return 5;
}

/**
 * Cut stability: how long since last parameter change.
 * Longer = more predictable for delegators. Cooldown set = bonus signal.
 */
function scoreCutStability(
  lastUpdate: number,
  cooldown: number,
): number {
  const now = Math.floor(Date.now() / 1000);
  const daysSinceChange = (now - lastUpdate) / 86400;

  let score: number;
  if (daysSinceChange >= 180) score = 100;
  else if (daysSinceChange >= 90) score = 85;
  else if (daysSinceChange >= 30) score = 65;
  else if (daysSinceChange >= 7) score = 35;
  else score = 10;

  // Bonus: having a cooldown set shows good faith
  if (cooldown > 0) score = Math.min(score + 10, 100);

  return score;
}

/**
 * Allocation efficiency: how well the indexer uses provisioned stake.
 * allocated / provisioned ratio — higher utilisation = more competent operations.
 */
function scoreAllocationEfficiency(
  allocationCount: number,
  allocatedTokens: string,
  provisionedGRT: number | null,
): number {
  if (allocationCount === 0) return 0;
  if (!provisionedGRT || provisionedGRT === 0) return 40; // allocating but no provision data

  const allocated = Number(BigInt(allocatedTokens.split('.')[0] || '0')) / 1e18;
  const ratio = Math.min(allocated / provisionedGRT, 1);

  if (ratio >= 0.8) return 100;
  if (ratio >= 0.6) return 80;
  if (ratio >= 0.4) return 60;
  if (ratio >= 0.2) return 40;
  return 20;
}

/**
 * Over-delegation risk: how close to max capacity.
 * Lower utilisation = more room for new delegators without dilution.
 */
function scoreOverDelegation(utilizationPercent: number): number {
  if (utilizationPercent >= 100) return 0;
  if (utilizationPercent >= 95) return 15;
  if (utilizationPercent >= 85) return 35;
  if (utilizationPercent >= 70) return 55;
  if (utilizationPercent >= 50) return 75;
  return 100;
}

/**
 * Transparency & presence: has the indexer bothered to be identifiable?
 */
function scoreTransparency(
  hasENS: boolean,
  hasURL: boolean,
  hasDisplayName: boolean,
): number {
  let score = 0;
  if (hasENS) score += 40;
  if (hasURL) score += 30;
  if (hasDisplayName) score += 30;
  return score;
}

/**
 * Delegation trend: net flow relative to total delegated.
 * Positive inflow = crowd confidence. Neutral = baseline. Outflow = warning.
 */
function scoreDelegationTrend(
  netFlowGRT: number,
  totalDelegatedGRT: number,
): number {
  if (totalDelegatedGRT === 0) return 50; // no delegation history = neutral

  const flowPercent = (netFlowGRT / totalDelegatedGRT) * 100;

  // Strong inflow (>2% of total delegated in 7d)
  if (flowPercent >= 2) return 100;
  if (flowPercent >= 0.5) return 80;
  if (flowPercent >= 0) return 60;
  // Outflow
  if (flowPercent >= -1) return 40;
  if (flowPercent >= -3) return 20;
  return 0;
}

// --- Composite scorer ---

function gradeFromScore(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (score >= 80) return 'A';
  if (score >= 65) return 'B';
  if (score >= 50) return 'C';
  if (score >= 35) return 'D';
  return 'F';
}

export interface ScoreInput {
  reoStatus: 'eligible' | 'ineligible' | 'unknown';
  reoDaysRemaining: number | null;
  reoSource: 'oracle' | 'heuristic';
  ownStakeRatio: number | null;
  selfStakeGRT: number;
  lastDelegationParameterUpdate: number;
  delegatorParameterCooldown: number;
  allocationCount: number;
  allocatedTokens: string;
  provisionedGRT: number | null;
  delegationUtilization: number;
  ensName: string | null;
  url: string | null;
  name: string;
  id: string;
  netFlowGRT: number;
  delegatedGRT: number;
}

export function calculateIndexerScore(input: ScoreInput): IndexerScore {
  const breakdown: ScoreBreakdown = {
    reo: scoreREO(input.reoStatus, input.reoDaysRemaining, input.reoSource),
    selfStake: scoreSelfStake(input.ownStakeRatio, input.selfStakeGRT),
    cutStability: scoreCutStability(
      input.lastDelegationParameterUpdate,
      input.delegatorParameterCooldown,
    ),
    allocationEfficiency: scoreAllocationEfficiency(
      input.allocationCount,
      input.allocatedTokens,
      input.provisionedGRT,
    ),
    overDelegation: scoreOverDelegation(input.delegationUtilization),
    transparency: scoreTransparency(
      !!input.ensName,
      !!input.url,
      input.name !== input.id, // display name set if name !== raw address
    ),
    delegationTrend: scoreDelegationTrend(input.netFlowGRT, input.delegatedGRT),
  };

  // Weighted composite
  const composite = Math.round(
    Object.entries(SCORE_WEIGHTS).reduce(
      (sum, [key, weight]) => sum + breakdown[key as keyof ScoreBreakdown] * (weight / 100),
      0
    )
  );

  return {
    composite,
    breakdown,
    grade: gradeFromScore(composite),
  };
}
