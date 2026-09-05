/**
 * The indexer shapes Lodestar reads, built from `lodestar_indexers` rows (nightswatchhq/nuthatch#1160).
 * Shared by `api/indexer/[address]`, `api/indexers` and the refresh cron, so one mapping exists.
 */
import type { NestIndexerDetailRow } from './nest-queries';

/**
 * The subgraph's derived indexer metrics, ported from its `helpers.ts` (`calculateOwnStakeRatio`,
 * `calculateDelegatedStakeRatio`, `calculateIndexingRewardEffectiveCut`,
 * `calculateOverdelegationDilution`, `calculateIndexerRewardOwnGenerationRatio`) so the page's
 * numbers mean what they meant, and `tokenCapacity`, which the contracts define as own stake plus
 * delegation up to the ratio. Ratios as decimal strings like the subgraph's BigDecimals.
 */
export function derivedIndexerMetrics(r: NestIndexerDetailRow, delegationRatio: number) {
  const staked = Number(r.staked_tokens) / 1e18;
  const locked = Number(r.locked_tokens) / 1e18;
  const delegated = Number(r.delegated_tokens) / 1e18;
  const usableOwn = staked - locked;
  const maxUsable = usableOwn + usableOwn * delegationRatio;
  const totalUsable = Math.min(maxUsable, usableOwn + delegated);
  const ownStakeRatio = totalUsable === 0 ? 0 : usableOwn / totalUsable;
  const delegatedStakeRatio = ownStakeRatio === 0 ? 0 : 1 - ownStakeRatio;
  const cut = Number(r.indexing_reward_cut ?? 0);
  const delegatorCut = (1_000_000 - cut) / 1_000_000;
  const indexingRewardEffectiveCut = delegatedStakeRatio === 0 ? 0 : 1 - delegatorCut / delegatedStakeRatio;
  const maxDelegated = staked * delegationRatio;
  const dilutionDenom = Math.max(maxDelegated, delegated);
  const overDelegationDilution = dilutionDenom === 0 ? 0 : 1 - maxDelegated / dilutionDenom;
  const indexerRewardsOwnGenerationRatio = ownStakeRatio === 0 ? 0 : cut / 1_000_000 / ownStakeRatio;
  const stakedWei = BigInt(r.staked_tokens); const delegatedWei = BigInt(r.delegated_tokens);
  const maxDelegatedWei = stakedWei * BigInt(delegationRatio);
  const capacity = stakedWei + (delegatedWei < maxDelegatedWei ? delegatedWei : maxDelegatedWei);
  return {
    tokenCapacity: capacity.toString(),
    ownStakeRatio: String(ownStakeRatio),
    delegatedStakeRatio: String(delegatedStakeRatio),
    indexingRewardEffectiveCut: String(indexingRewardEffectiveCut),
    overDelegationDilution: String(overDelegationDilution),
    indexerRewardsOwnGenerationRatio: String(indexerRewardsOwnGenerationRatio),
  };
}


/** The `SubgraphIndexer` shape the refresh cron enriches, from a nest row; names null (ENS/IPFS). */
export function refreshIndexerFromNest(r: NestIndexerDetailRow, delegationRatio: number) {
  return {
    id: r.id,
    account: { id: r.id, defaultDisplayName: null, metadata: null },
    stakedTokens: r.staked_tokens,
    lockedTokens: r.locked_tokens,
    delegatedTokens: r.delegated_tokens,
    allocatedTokens: r.allocated_tokens,
    allocationCount: Number(r.allocation_count),
    indexingRewardCut: Number(r.indexing_reward_cut ?? 0),
    queryFeeCut: Number(r.query_fee_cut ?? 0),
    delegatorParameterCooldown: 0,
    lastDelegationParameterUpdate: Number(r.last_delegation_parameter_update ?? r.created_at),
    rewardsEarned: r.rewards_earned,
    queryFeesCollected: r.query_fees_collected,
    delegatorShares: r.delegator_shares,
    delegatedThawingTokens: r.delegated_thawing_tokens,
    url: r.url,
    geoHash: r.geohash,
    createdAt: Number(r.created_at),
    provisionedTokens: r.provisioned_tokens,
    ...derivedIndexerMetrics(r, delegationRatio),
  };
}
