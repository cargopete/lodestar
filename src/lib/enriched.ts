/**
 * Enriched indexer type — pre-computed by the cron job,
 * consumed by IndexerTable and individual indexer pages.
 */
export interface EnrichedIndexer {
  // Base indexer fields
  id: string;
  name: string;
  stakedTokens: string;
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
  reoStatus: 'eligible' | 'warning' | 'ineligible';
  recentActivity: {
    delegationsIn7d: number;
    netFlowGRT: number;
  };
  // Horizon metrics (from subgraph)
  effectiveCut: number | null;
  overDelegationDilution: number | null;
  ownStakeRatio: number | null;
  indexerRewardsOwnGenerationRatio: number | null;
  provisionedGRT: number | null;
  computedAt: number;
}
