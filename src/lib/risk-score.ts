/**
 * Composite Indexer Risk Score
 *
 * Nine dimensions, each scored 0–100, combined with transparent weights
 * into a single 0–100 composite score. Higher = better for delegators.
 *
 * Dimensions & weights:
 *   REO compliance       20%  — gates rewards; most critical signal
 *   Self-stake ratio     13%  — skin in the game
 *   Query volume         12%  — actual work served (query fees collected)
 *   Allocation efficiency 13% — operational competence
 *   Delegator cut        10%  — how much delegators keep (reward + query fee cuts)
 *   Cut stability         8%  — trust / predictability
 *   Over-delegation      10%  — delegation safety margin
 *   Transparency          9%  — presence and accountability
 *   Delegation trend      5%  — crowd signal (noisy, low weight)
 */

export interface ScoreBreakdown {
  reo: number;
  selfStake: number;
  queryVolume: number;
  delegatorCut: number;
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
  reo: 20,
  selfStake: 13,
  queryVolume: 12,
  allocationEfficiency: 13,
  delegatorCut: 10,
  cutStability: 8,
  overDelegation: 10,
  transparency: 9,
  delegationTrend: 5,
};

export const SCORE_LABELS: Record<keyof ScoreBreakdown, string> = {
  reo: 'REO Compliance',
  selfStake: 'Self-Stake',
  queryVolume: 'Query Volume',
  delegatorCut: 'Delegator Cut',
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
 * Self-stake: absolute GRT staked by the indexer — skin in the game.
 * Scored on absolute value, NOT ratio. Having more delegation does not
 * reduce this score. Linear interpolation between anchor points.
 *
 * Anchors (GRT → score):
 *   10M+ → 100,  5M → 95,  1M → 80,  500K → 65,
 *   200K → 50,  100K → 35 (protocol minimum),  0 → 5
 */
function scoreSelfStake(selfStakeGRT: number): number {
  if (selfStakeGRT <= 0) return 0;

  const anchors: [number, number][] = [
    [10_000_000, 100],
    [5_000_000,   95],
    [1_000_000,   80],
    [500_000,     65],
    [200_000,     50],
    [100_000,     35],
    [0,            5],
  ];

  if (selfStakeGRT >= anchors[0][0]) return anchors[0][1];

  for (let i = 0; i < anchors.length - 1; i++) {
    const [hi, hiScore] = anchors[i];
    const [lo, loScore] = anchors[i + 1];
    if (selfStakeGRT >= lo) {
      const t = (selfStakeGRT - lo) / (hi - lo);
      return Math.round(loScore + t * (hiScore - loScore));
    }
  }

  return 5;
}

/**
 * Cut stability: how long since last parameter change.
 * Longer = more predictable for delegators. Cooldown set = bonus signal.
 * Greedy cuts (>=100%) are hard-capped regardless of stability.
 */
function scoreCutStability(
  lastUpdate: number,
  cooldown: number,
  rewardCutPPM?: number,
): number {
  // Hard cap for greedy indexers — delegators earn nothing
  if (rewardCutPPM !== undefined) {
    if (rewardCutPPM >= 1_000_000) return 5;
    if (rewardCutPPM >= 900_000) return Math.min(30, scoreCutStabilityInner(lastUpdate, cooldown));
  }
  return scoreCutStabilityInner(lastUpdate, cooldown);
}

function scoreCutStabilityInner(
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
 * Query volume: cumulative query fees collected in GRT.
 * Indexers actually serving queries = doing real work. Higher fees = more useful.
 *
 * Anchors (GRT → score):
 *   100K+ → 100,  50K → 90,  10K → 70,  1K → 50,
 *   100 → 30,  >0 → 15,  0 → 0
 */
function scoreQueryVolume(queryFeesCollectedGRT: number): number {
  if (queryFeesCollectedGRT <= 0) return 0;

  const anchors: [number, number][] = [
    [100_000, 100],
    [50_000,   90],
    [10_000,   70],
    [1_000,    50],
    [100,      30],
    [0,        15],
  ];

  if (queryFeesCollectedGRT >= anchors[0][0]) return anchors[0][1];

  for (let i = 0; i < anchors.length - 1; i++) {
    const [hi, hiScore] = anchors[i];
    const [lo, loScore] = anchors[i + 1];
    if (queryFeesCollectedGRT >= lo) {
      const t = (queryFeesCollectedGRT - lo) / (hi - lo);
      return Math.round(loScore + t * (hiScore - loScore));
    }
  }

  return 0;
}

/**
 * Delegator cut: how much of the rewards delegators actually keep.
 * Uses the **effective cut** (what delegators actually experience) when available,
 * falling back to raw cut. Effective cut accounts for the indexer's own stake
 * ratio — indexers with low delegation ratios need higher raw cuts to earn a
 * reasonable return, but their effective cut is lower.
 *
 * Cut anchors (percentage → score):
 *   0%   → 100,  5%  → 95,  10% → 85,  15% → 75,  20% → 68,
 *   25%  → 60,  50% → 35,  75% → 15,  100% → 0
 *
 * Query fee cut penalty: up to -15 points (linear, 100% fee cut = -15).
 */
function scoreDelegatorCut(
  rewardCutPPM: number,
  queryFeeCutPPM: number,
  effectiveCutPercent?: number | null,
): number {
  // Prefer effective cut (what delegators actually experience) over raw cut
  const rewardCutPercent = effectiveCutPercent != null
    ? Math.min(Math.max(effectiveCutPercent, 0), 100)
    : Math.min(rewardCutPPM / 10_000, 100);

  const anchors: [number, number][] = [
    [0,   100],
    [5,    95],
    [10,   85],
    [15,   75],
    [20,   68],
    [25,   60],
    [50,   35],
    [75,   15],
    [100,   0],
  ];

  let rewardScore: number;
  if (rewardCutPercent <= anchors[0][0]) {
    rewardScore = anchors[0][1];
  } else if (rewardCutPercent >= anchors[anchors.length - 1][0]) {
    rewardScore = anchors[anchors.length - 1][1];
  } else {
    rewardScore = anchors[0][1]; // fallback
    for (let i = 0; i < anchors.length - 1; i++) {
      const [lo, loScore] = anchors[i];
      const [hi, hiScore] = anchors[i + 1];
      if (rewardCutPercent >= lo && rewardCutPercent <= hi) {
        const t = (rewardCutPercent - lo) / (hi - lo);
        rewardScore = Math.round(loScore + t * (hiScore - loScore));
        break;
      }
    }
  }

  // Query fee cut penalty: 0% cut = 0 penalty, 100% cut = -15
  const queryFeePercent = Math.min(queryFeeCutPPM / 10_000, 100);
  const queryPenalty = Math.round((queryFeePercent / 100) * 15);

  return Math.max(0, rewardScore - queryPenalty);
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
  rewardCutPPM: number;
  queryFeeCutPPM: number;
  effectiveCutPercent?: number | null;
  queryFeesCollectedGRT: number;
  netFlowGRT: number;
  delegatedGRT: number;
}

export function calculateIndexerScore(input: ScoreInput): IndexerScore {
  const breakdown: ScoreBreakdown = {
    reo: scoreREO(input.reoStatus, input.reoDaysRemaining, input.reoSource),
    selfStake: scoreSelfStake(input.selfStakeGRT),
    queryVolume: scoreQueryVolume(input.queryFeesCollectedGRT),
    delegatorCut: scoreDelegatorCut(input.rewardCutPPM, input.queryFeeCutPPM, input.effectiveCutPercent),
    cutStability: scoreCutStability(
      input.lastDelegationParameterUpdate,
      input.delegatorParameterCooldown,
      input.rewardCutPPM,
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
