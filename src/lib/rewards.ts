/**
 * Rewards calculation utilities for The Graph Protocol
 *
 * Key concepts:
 * - Delegation shares represent ownership of the delegation pool
 * - Exchange rate = delegatedTokens / delegatorShares
 * - Unrealized rewards = (shares * currentExchangeRate) - originalDelegation
 */

import { weiToGRT } from './utils';

/**
 * Calculate the current exchange rate for an indexer's delegation pool
 */
export function calculateExchangeRate(
  delegatedTokens: string,
  delegatorShares: string
): number {
  const tokens = weiToGRT(delegatedTokens);
  const shares = weiToGRT(delegatorShares);

  if (shares === 0) return 1;
  return tokens / shares;
}

/**
 * Calculate unrealized rewards for a delegation position
 *
 * @param stakedTokens - Original tokens delegated (wei)
 * @param shareAmount - Shares received for delegation (wei)
 * @param indexerDelegatedTokens - Total delegated to indexer (wei)
 * @param indexerDelegatorShares - Total shares issued by indexer (wei)
 */
export function calculateUnrealizedRewards(
  stakedTokens: string,
  shareAmount: string,
  indexerDelegatedTokens: string,
  indexerDelegatorShares: string,
  indexerDelegatedThawingTokens: string = '0'
): number {
  const originalStake = weiToGRT(stakedTokens);
  const shares = weiToGRT(shareAmount);
  const exchangeRate = calculatePoolExchangeRate(
    indexerDelegatedTokens,
    indexerDelegatedThawingTokens,
    indexerDelegatorShares
  );

  // Current value of shares
  const currentValue = shares * exchangeRate;

  // Unrealized = current value - original stake
  return Math.max(currentValue - originalStake, 0);
}

/**
 * Calculate estimated APR for a delegation (simple model)
 *
 * Reward distribution in The Graph protocol:
 *   1. Indexer takes indexingRewardCut of total rewards
 *   2. Remaining (1 - cut) goes entirely to delegators — self-stake does NOT
 *      participate in the delegation pool
 *
 * @param indexerRewardsPerYear - Estimated annual rewards for indexer (GRT)
 * @param protocolCutPPM - Indexer's reward cut in PPM
 * @param totalDelegated - Total delegated to indexer (GRT)
 * @param userDelegation - User's delegation amount (GRT)
 */
export function calculateEstimatedAPR(
  indexerRewardsPerYear: number,
  protocolCutPPM: number,
  totalDelegated: number,
  userDelegation: number
): number {
  if (userDelegation === 0 || totalDelegated === 0) return 0;

  const protocolCut = protocolCutPPM / 1000000;

  // After indexer cut, entire remainder goes to delegators
  const delegationPoolRewards = indexerRewardsPerYear * (1 - protocolCut);

  // User's share of delegation pool rewards
  const userRewards = delegationPoolRewards * (userDelegation / totalDelegated);

  // APR = rewards / principal * 100
  return (userRewards / userDelegation) * 100;
}

/**
 * Calculate delegator APR using per-allocation signal-weighted rewards
 *
 * For each allocation:
 *   reward = annualIssuance × (subgraphSignal / totalNetworkSignal) × (allocation / subgraphStake)
 *
 * Reward distribution in The Graph protocol:
 *   1. Indexer takes rawCut of total rewards
 *   2. Remaining (1 - rawCut) goes entirely to delegators — self-stake does NOT
 *      participate in the delegation pool
 *   delegatorAPR = sum(rewards) × (1 - rawCut) / delegated × 100
 *
 * @param allocations - Indexer's active allocations with subgraph signal data
 * @param protocolCutPPM - Indexer's reward cut in PPM
 * @param delegated - Total delegated to indexer (GRT)
 * @param totalNetworkSignal - Total signal across entire network (GRT)
 * @param annualIssuance - Annual GRT issuance (GRT)
 */
export function calculateDelegatorAPR(
  allocations: Array<{
    allocatedTokens: string;
    subgraphDeployment: {
      signalledTokens: string;
      stakedTokens: string;
    };
  }>,
  protocolCutPPM: number,
  delegated: number,
  totalNetworkSignal: number,
  annualIssuance: number
): number {
  if (delegated === 0 || totalNetworkSignal === 0 || allocations.length === 0) return 0;

  // Compute signal-to-stake ratio for each allocation and cap outliers at P95.
  // Subgraphs with anomalously high signal relative to stake (e.g. 100x the norm)
  // generate outsized theoretical rewards that skew the APR estimate.
  const allocData = allocations.map((alloc) => {
    const allocated = weiToGRT(alloc.allocatedTokens);
    const subgraphSignal = weiToGRT(alloc.subgraphDeployment.signalledTokens);
    const subgraphStake = weiToGRT(alloc.subgraphDeployment.stakedTokens);
    const signalToStake = subgraphStake > 0 ? subgraphSignal / subgraphStake : 0;
    return { allocated, subgraphSignal, subgraphStake, signalToStake };
  }).filter((a) => a.subgraphSignal > 0 && a.subgraphStake > 0);

  if (allocData.length === 0) return 0;

  // Find P95 signal-to-stake ratio as the cap
  const ratios = allocData.map((a) => a.signalToStake).sort((a, b) => a - b);
  const p95Idx = Math.min(Math.floor(ratios.length * 0.95), ratios.length - 1);
  const signalToStakeCap = ratios[p95Idx];

  let totalRewards = 0;
  for (const alloc of allocData) {
    // reward = issuance × (signal/totalSignal) × (allocated/stake)
    //        = issuance × signalToStake × allocated / totalSignal
    const cappedRatio = Math.min(alloc.signalToStake, signalToStakeCap);
    const reward = annualIssuance * cappedRatio * alloc.allocated / totalNetworkSignal;
    totalRewards += reward;
  }

  const rawCut = protocolCutPPM / 1000000;
  // After indexer cut, entire remainder goes to delegators
  const delegatorRewards = totalRewards * (1 - rawCut);

  return Math.min((delegatorRewards / delegated) * 100, 100);
}

/**
 * Calculate rolling delegator APY from closed allocations.
 *
 * Uses indexingDelegatorRewards from the subgraph, which already has the
 * reward cut applied at close time (more accurate than applying the current cut).
 *
 * NOTE: This is the legacy method — it divides rewards by the *current*
 * delegation pool size, so recent delegations/undelegations distort the result.
 * Prefer calculateExchangeRateAPY when historical exchange rates are available.
 *
 * @param closedAllocations - Closed allocations with pre-calculated delegator rewards
 * @param delegatedGRT - Total GRT delegated to this indexer
 * @param windowDays - Rolling window (30 or 90)
 */
export function calculateRollingAPY(
  closedAllocations: Array<{ delegator_rewards_grt: number; closed_at: number }>,
  delegatedGRT: number,
  windowDays: number
): number {
  if (delegatedGRT <= 0 || closedAllocations.length === 0) return 0;

  const cutoffUnix = Math.floor(Date.now() / 1000) - windowDays * 86400;

  let delegatorRewards = 0;
  for (const alloc of closedAllocations) {
    if (alloc.closed_at >= cutoffUnix) {
      delegatorRewards += alloc.delegator_rewards_grt;
    }
  }

  if (delegatorRewards <= 0) return 0;

  return (delegatorRewards / delegatedGRT) * (365 / windowDays) * 100;
}

/**
 * Calculate the delegation pool exchange rate, excluding thawing tokens.
 *
 * rate = (delegatedTokens - delegatedThawingTokens) / delegatorShares
 *
 * Thawing tokens are excluded because they no longer generate rewards
 * but remain in delegatedTokens until withdrawn.
 */
export function calculatePoolExchangeRate(
  delegatedTokens: string,
  delegatedThawingTokens: string,
  delegatorShares: string
): number {
  const tokens = weiToGRT(delegatedTokens);
  const thawing = weiToGRT(delegatedThawingTokens);
  const shares = weiToGRT(delegatorShares);

  if (shares === 0) return 1;
  return (tokens - thawing) / shares;
}

/**
 * Calculate APY from delegation pool exchange rate changes.
 *
 * APY = ((rate_now / rate_old) ^ (365/N) - 1) × 100
 *
 * This captures everything: indexing rewards, query fees, and slashing.
 * Immune to delegation/undelegation noise because the rate is per-share.
 *
 * Credit: Marc-André (EllipfraRole / IndexerDesignPartner)
 */
export function calculateExchangeRateAPY(
  currentRate: number,
  historicalRate: number,
  windowDays: number
): number {
  if (historicalRate <= 0 || currentRate <= 0 || windowDays <= 0) return 0;

  const ratio = currentRate / historicalRate;
  if (ratio <= 1) return 0;

  return (Math.pow(ratio, 365 / windowDays) - 1) * 100;
}

/**
 * Calculate delegation capacity metrics
 */
export function calculateDelegationCapacity(
  selfStake: number,
  delegated: number,
  delegationRatio: number
): {
  maxCapacity: number;
  usedCapacity: number;
  availableCapacity: number;
  utilizationPercent: number;
} {
  const maxCapacity = selfStake * delegationRatio;
  const usedCapacity = delegated;
  const availableCapacity = Math.max(maxCapacity - delegated, 0);
  const utilizationPercent = maxCapacity > 0 ? (delegated / maxCapacity) * 100 : 100;

  return {
    maxCapacity,
    usedCapacity,
    availableCapacity,
    utilizationPercent: Math.min(utilizationPercent, 100),
  };
}

/**
 * Calculate thawing time remaining
 */
export function calculateThawingRemaining(lockedUntil: number): {
  totalSeconds: number;
  days: number;
  hours: number;
  minutes: number;
  isComplete: boolean;
  percentComplete: number;
} {
  const now = Math.floor(Date.now() / 1000);
  const remaining = Math.max(lockedUntil - now, 0);

  const days = Math.floor(remaining / 86400);
  const hours = Math.floor((remaining % 86400) / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);

  // Assume 28-day thawing period for percent calculation
  const thawingPeriod = 28 * 86400;
  const elapsed = thawingPeriod - remaining;
  const percentComplete = Math.min((elapsed / thawingPeriod) * 100, 100);

  return {
    totalSeconds: remaining,
    days,
    hours,
    minutes,
    isComplete: remaining === 0,
    percentComplete: Math.max(percentComplete, 0),
  };
}

/**
 * Format thawing time for display
 */
export function formatThawingTime(lockedUntil: number): string {
  const { days, hours, minutes, isComplete } = calculateThawingRemaining(lockedUntil);

  if (isComplete) return 'Ready to withdraw';
  if (days > 0) return `${days}d ${hours}h remaining`;
  if (hours > 0) return `${hours}h ${minutes}m remaining`;
  return `${minutes}m remaining`;
}

/**
 * Generate CSV data for tax reporting
 */
export function generateRewardsCSV(
  delegations: Array<{
    indexerName: string;
    indexerAddress: string;
    stakedTokens: number;
    realizedRewards: number;
    unrealizedRewards: number;
    createdAt: number;
  }>,
  grtPrice: number
): string {
  const headers = [
    'Indexer Name',
    'Indexer Address',
    'Delegated (GRT)',
    'Delegated (USD)',
    'Realized Rewards (GRT)',
    'Realized Rewards (USD)',
    'Unrealized Rewards (GRT)',
    'Unrealized Rewards (USD)',
    'Delegation Date',
  ];

  const rows = delegations.map((d) => [
    d.indexerName,
    d.indexerAddress,
    d.stakedTokens.toFixed(2),
    (d.stakedTokens * grtPrice).toFixed(2),
    d.realizedRewards.toFixed(2),
    (d.realizedRewards * grtPrice).toFixed(2),
    d.unrealizedRewards.toFixed(2),
    (d.unrealizedRewards * grtPrice).toFixed(2),
    new Date(d.createdAt * 1000).toISOString().split('T')[0],
  ]);

  const totalStaked = delegations.reduce((sum, d) => sum + d.stakedTokens, 0);
  const totalRealized = delegations.reduce((sum, d) => sum + d.realizedRewards, 0);
  const totalUnrealized = delegations.reduce((sum, d) => sum + d.unrealizedRewards, 0);

  rows.push([
    'TOTAL',
    '',
    totalStaked.toFixed(2),
    (totalStaked * grtPrice).toFixed(2),
    totalRealized.toFixed(2),
    (totalRealized * grtPrice).toFixed(2),
    totalUnrealized.toFixed(2),
    (totalUnrealized * grtPrice).toFixed(2),
    '',
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}
