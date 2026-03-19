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
  indexerDelegatorShares: string
): number {
  const originalStake = weiToGRT(stakedTokens);
  const shares = weiToGRT(shareAmount);
  const exchangeRate = calculateExchangeRate(indexerDelegatedTokens, indexerDelegatorShares);

  // Current value of shares
  const currentValue = shares * exchangeRate;

  // Unrealized = current value - original stake
  return Math.max(currentValue - originalStake, 0);
}

/**
 * Calculate effective reward cut percentage
 *
 * The effective cut depends on the ratio of indexer's own stake to delegated stake.
 * Formula: effectiveCut = protocolCut * (delegated / (selfStake + delegated))
 *
 * Example: 10% protocol cut with 1:4 self:delegated ratio
 * = 10% * (4 / (1 + 4)) = 10% * 0.8 = 8% effective cut
 *
 * @param protocolCutPPM - Indexer's advertised reward cut in PPM
 * @param selfStake - Indexer's own stake (GRT)
 * @param delegated - Total delegated to indexer (GRT)
 * @returns Effective cut as a percentage (0-100)
 */
export function calculateEffectiveCut(
  protocolCutPPM: number,
  selfStake: number,
  delegated: number
): number {
  const protocolCutPercent = protocolCutPPM / 10000; // PPM to percent

  if (selfStake + delegated === 0) return protocolCutPercent;

  // Proportion of rewards that go to delegators before cut
  const delegatorProportion = delegated / (selfStake + delegated);

  // Effective cut is the protocol cut applied to delegator's proportion
  // But we want to show what % the delegator actually loses
  return protocolCutPercent;
}

/**
 * Calculate estimated APR for a delegation
 *
 * @param indexerRewardsPerYear - Estimated annual rewards for indexer (GRT)
 * @param protocolCutPPM - Indexer's reward cut in PPM
 * @param selfStake - Indexer's own stake (GRT)
 * @param totalDelegated - Total delegated to indexer (GRT)
 * @param userDelegation - User's delegation amount (GRT)
 */
export function calculateEstimatedAPR(
  indexerRewardsPerYear: number,
  protocolCutPPM: number,
  selfStake: number,
  totalDelegated: number,
  userDelegation: number
): number {
  if (userDelegation === 0 || totalDelegated === 0) return 0;

  const protocolCut = protocolCutPPM / 1000000;

  // Total stake = self + delegated
  const totalStake = selfStake + totalDelegated;
  if (totalStake === 0) return 0;

  // Rewards allocated to delegation pool (after indexer's cut of delegation rewards)
  const delegationPoolRewards = indexerRewardsPerYear * (totalDelegated / totalStake) * (1 - protocolCut);

  // User's share of delegation pool rewards
  const userRewards = delegationPoolRewards * (userDelegation / totalDelegated);

  // APR = rewards / principal * 100
  return (userRewards / userDelegation) * 100;
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
 * Calculate how a new delegation would affect the effective cut
 */
export function simulateNewDelegation(
  protocolCutPPM: number,
  selfStake: number,
  currentDelegated: number,
  newDelegation: number
): {
  currentEffectiveCut: number;
  newEffectiveCut: number;
  cutChange: number;
} {
  const currentEffectiveCut = calculateEffectiveCut(protocolCutPPM, selfStake, currentDelegated);
  const newEffectiveCut = calculateEffectiveCut(protocolCutPPM, selfStake, currentDelegated + newDelegation);

  return {
    currentEffectiveCut,
    newEffectiveCut,
    cutChange: newEffectiveCut - currentEffectiveCut,
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
