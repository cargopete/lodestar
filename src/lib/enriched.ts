/**
 * Enriched indexer type — pre-computed by the cron job,
 * consumed by IndexerTable and individual indexer pages.
 */
export interface EnrichedIndexer {
  // Base indexer fields
  id: string;
  name: string;
  stakedTokens: string;
  lockedTokens: string;
  delegatedTokens: string;
  allocatedTokens: string;
  allocationCount: number;
  indexingRewardCut: number;
  queryFeeCut: number;
  delegatorParameterCooldown: number;
  lastDelegationParameterUpdate: number;
  rewardsEarned: string;
  delegatorShares: string;
  url: string | null;
  geoHash: string | null;
  createdAt: number;

  // ENS name (resolved from ENS subgraph, highest priority for display)
  ensName: string | null;

  // Pre-computed fields
  selfStakeGRT: number;
  delegatedGRT: number;
  delegatorAPR: number;
  delegationCapacity: {
    maxCapacity: number;
    usedCapacity: number;
    availableCapacity: number;
    utilizationPercent: number;
  };
  reoStatus: 'eligible' | 'ineligible' | 'unknown';
  reoSource: 'oracle' | 'heuristic';
  reoRenewalTimestamp: number | null;   // unix seconds — last oracle renewal
  reoExpiresAt: number | null;          // unix seconds — when eligibility expires
  reoDaysRemaining: number | null;      // days until expiry (negative = expired)
  recentActivity: {
    delegationsIn7d: number;
    undelegationsIn7d: number;
    netFlowGRT: number;
  };
  // Horizon metrics (from subgraph)
  effectiveCut: number | null;
  overDelegationDilution: number | null;
  ownStakeRatio: number | null;
  indexerRewardsOwnGenerationRatio: number | null;
  provisionedGRT: number | null;
  // Composite risk score (computed from all dimensions above)
  score: number;               // 0–100 composite
  scoreGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  scoreBreakdown: {
    reo: number;
    selfStake: number;
    cutStability: number;
    allocationEfficiency: number;
    overDelegation: number;
    transparency: number;
    delegationTrend: number;
  };
  computedAt: number;
}
