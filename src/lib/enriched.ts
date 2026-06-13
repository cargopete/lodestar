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
  delegatedGRT: number;          // active delegation only (excl. thawing tokens)
  delegatedThawingGRT: number;   // tokens thawing (incl. fully-thawed-not-withdrawn)
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
  // Query fees collected (cumulative, from subgraph)
  queryFeesCollectedGRT: number;
  // Delegation pool exchange rate (excl. thawing tokens)
  delegationExchangeRate: number | null;
  // Rolling APY (exchange-rate-based when available, else closed-allocation fallback)
  rollingAPY30d: number | null;
  rollingAPY90d: number | null;
  // Distinct Horizon data services this indexer is provisioned to
  distinctDataServices: number;
  // Composite risk score (computed from all dimensions above)
  score: number;               // 0–100 composite
  scoreGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  scoreBreakdown: {
    reo: number;
    selfStake: number;
    queryVolume: number;
    cutStability: number;
    allocationEfficiency: number;
    overDelegation: number;
    transparency: number;
    delegationTrend: number;
    delegatorAPY: number;
    dataServiceDiversity: number;
  };
  computedAt: number;
}
