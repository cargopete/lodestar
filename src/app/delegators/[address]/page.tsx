'use client';

import { use, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  type DelegatorPortfolioResponse,
  type DelegatedStake,
  type Indexer,
} from '@/lib/queries';
import { useGRTPrice, useIndexers } from '@/hooks/useNetworkStats';
import {
  weiToGRT,
  formatGRT,
  formatUSD,
  formatPPM,
  shortenAddress,
  resolveIndexerName,
  cn,
} from '@/lib/utils';
import {
  calculateUnrealizedRewards,
  calculateEffectiveCut,
} from '@/lib/rewards';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { StatCard, StatGrid } from '@/components/ui/StatCard';

function useDelegatorPortfolio(address: string | undefined) {
  return useQuery({
    queryKey: ['delegatorPortfolio', address],
    queryFn: async () => {
      if (!address) return null;
      const query = `
        {
          delegator(id: "${address.toLowerCase()}") {
            id
            totalStakedTokens
            totalUnstakedTokens
            totalRealizedRewards
            stakesCount
            activeStakesCount
            stakes(first: 100, orderBy: stakedTokens, orderDirection: desc) {
              id
              stakedTokens
              shareAmount
              lockedTokens
              lockedUntil
              realizedRewards
              unstakedTokens
              createdAt
              lastUndelegatedAt
              indexer {
                id
                account {
                  id
                  defaultDisplayName
                  metadata {
                    displayName
                    description
                  }
                }
                stakedTokens
                delegatedTokens
                delegatorShares
                indexingRewardCut
                queryFeeCut
                delegatorParameterCooldown
              }
            }
          }
        }
      `;
      const response = await fetch('/api/subgraph', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
      const json = await response.json();
      if (json.errors) throw new Error(JSON.stringify(json.errors));
      return json.data?.delegator ?? null;
    },
    enabled: !!address,
    staleTime: 60 * 1000,
  });
}

/** Estimate a simple APR from an indexer's rewards earned and total stake */
function estimateIndexerAPR(indexer: {
  rewardsEarned?: string;
  stakedTokens: string;
  delegatedTokens: string;
  indexingRewardCut: number;
}): number {
  const rewardsEarned = indexer.rewardsEarned ? weiToGRT(indexer.rewardsEarned) : 0;
  const selfStake = weiToGRT(indexer.stakedTokens);
  const delegated = weiToGRT(indexer.delegatedTokens);
  const totalStake = selfStake + delegated;

  if (totalStake === 0 || rewardsEarned === 0) return 0;

  // Rough annualised estimate — assume rewards earned represent ~1 year of activity
  // Delegator share after indexer cut
  const protocolCut = indexer.indexingRewardCut / 1000000;
  const delegatorPortion = delegated / totalStake;
  const delegatorRewards = rewardsEarned * delegatorPortion * (1 - protocolCut);

  if (delegated === 0) return 0;
  return (delegatorRewards / delegated) * 100;
}

/** Compute median of a number array */
function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

interface PositionInsight {
  positionAPR: number;
  medianAPR: number;
  belowMedianPercent: number;
  topAlternative: {
    name: string;
    address: string;
    apr: number;
    availableCapacity: number;
  } | null;
}

function getPositionInsight(
  stake: DelegatedStake,
  allIndexers: Indexer[],
  positionAPR: number,
  medianAPR: number
): PositionInsight | null {
  const belowMedianPercent = medianAPR > 0 ? ((medianAPR - positionAPR) / medianAPR) * 100 : 0;

  if (belowMedianPercent <= 20) return null;

  // Find top alternative indexer (not this one) with capacity
  const alternatives = allIndexers
    .filter((idx) => idx.id !== stake.indexer.id)
    .map((idx) => {
      const apr = estimateIndexerAPR(idx);
      const selfStake = weiToGRT(idx.stakedTokens);
      const delegated = weiToGRT(idx.delegatedTokens);
      // Assume delegation ratio of 16
      const capacity = Math.max(selfStake * 16 - delegated, 0);
      return {
        name: resolveIndexerName(idx.account, idx.id),
        address: idx.id,
        apr,
        availableCapacity: capacity,
      };
    })
    .filter((a) => a.apr > positionAPR && a.availableCapacity > 0)
    .sort((a, b) => b.apr - a.apr);

  return {
    positionAPR,
    medianAPR,
    belowMedianPercent,
    topAlternative: alternatives[0] || null,
  };
}

export default function DelegatorPortfolioPage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = use(params);
  const { data: delegator, isLoading, error } = useDelegatorPortfolio(address);
  const { data: priceData } = useGRTPrice();
  const { data: indexersData } = useIndexers({ first: 100, orderBy: 'stakedTokens', orderDirection: 'desc' });

  const grtPrice = priceData?.price ?? 0;
  const allIndexers = indexersData?.indexers ?? [];

  // Network median APR across top indexers
  const networkMedianAPR = useMemo(() => {
    if (allIndexers.length === 0) return 0;
    const aprs = allIndexers
      .map((idx) => estimateIndexerAPR(idx))
      .filter((apr) => apr > 0);
    return median(aprs);
  }, [allIndexers]);

  // Calculate totals and per-position data
  const { totalStaked, totalRealized, totalUnrealized, positions } = useMemo(() => {
    if (!delegator) {
      return { totalStaked: 0, totalRealized: 0, totalUnrealized: 0, positions: [] };
    }

    let staked = 0;
    let realized = 0;
    let unrealized = 0;
    const posData: Array<{
      stake: DelegatedStake;
      stakedGRT: number;
      currentValue: number;
      unrealizedGRT: number;
      realizedGRT: number;
      effectiveCut: number;
      apr: number;
      insight: PositionInsight | null;
      isActive: boolean;
    }> = [];

    for (const stake of delegator.stakes) {
      const stakedGRT = weiToGRT(stake.stakedTokens);
      const realizedGRT = weiToGRT(stake.realizedRewards);
      const unrealizedGRT = calculateUnrealizedRewards(
        stake.stakedTokens,
        stake.shareAmount,
        stake.indexer.delegatedTokens,
        stake.indexer.delegatorShares
      );
      const currentValue = stakedGRT + unrealizedGRT;
      const selfStake = weiToGRT(stake.indexer.stakedTokens);
      const delegated = weiToGRT(stake.indexer.delegatedTokens);
      const effectiveCut = calculateEffectiveCut(stake.indexer.indexingRewardCut, selfStake, delegated);
      const isActive = stakedGRT > 0;

      // Estimate APR for this position's indexer
      const posAPR = estimateIndexerAPR({
        rewardsEarned: (allIndexers.find((i) => i.id === stake.indexer.id) as Indexer | undefined)?.rewardsEarned ?? '0',
        stakedTokens: stake.indexer.stakedTokens,
        delegatedTokens: stake.indexer.delegatedTokens,
        indexingRewardCut: stake.indexer.indexingRewardCut,
      });

      const insight = getPositionInsight(stake, allIndexers, posAPR, networkMedianAPR);

      staked += stakedGRT;
      realized += realizedGRT;
      unrealized += unrealizedGRT;

      posData.push({
        stake,
        stakedGRT,
        currentValue,
        unrealizedGRT,
        realizedGRT,
        effectiveCut,
        apr: posAPR,
        insight,
        isActive,
      });
    }

    return { totalStaked: staked, totalRealized: realized, totalUnrealized: unrealized, positions: posData };
  }, [delegator, allIndexers, networkMedianAPR]);

  const portfolioValue = totalStaked + totalUnrealized;

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <Card className="max-w-lg mx-auto mt-12">
        <CardContent className="py-8 text-center">
          <p className="text-[var(--red)] mb-2">Failed to load delegator data</p>
          <p className="text-[11px] text-[var(--text-faint)] font-mono">{(error as Error).message}</p>
        </CardContent>
      </Card>
    );
  }

  // No delegator found
  if (!delegator || delegator.stakesCount === 0) {
    return (
      <Card className="max-w-lg mx-auto mt-12">
        <CardContent className="py-12 text-center">
          <div className="w-16 h-16 rounded-full bg-[var(--bg-elevated)] flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-[var(--text-faint)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-[var(--text)] mb-2">No Delegations Found</h3>
          <p className="text-[var(--text-muted)] max-w-md mx-auto">
            This address has no delegation positions on The Graph network.
          </p>
          <Link
            href="/indexers"
            className={cn(
              'inline-flex items-center gap-2 mt-6 px-4 py-2 text-sm font-medium',
              'rounded-[var(--radius-button)] bg-[var(--accent)] text-white',
              'hover:opacity-90 transition-opacity'
            )}
          >
            Browse Indexers
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <Badge variant="accent">Delegator</Badge>
          <p className="text-sm text-[var(--text-muted)] font-mono">{shortenAddress(address, 6)}</p>
        </div>
        <div className="text-right">
          <p className="text-[11px] text-[var(--text-muted)] uppercase tracking-[0.06em]">Portfolio Value</p>
          <p className="text-[22px] font-mono font-medium text-[var(--text)]">{formatGRT(portfolioValue)} GRT</p>
          <p className="text-[11px] font-mono text-[var(--text-faint)]">{formatUSD(portfolioValue * grtPrice)}</p>
        </div>
      </div>

      {/* Stat cards */}
      <StatGrid>
        <StatCard
          label="Total Delegated"
          value={`${formatGRT(totalStaked)} GRT`}
          delta={{ value: formatUSD(totalStaked * grtPrice), positive: true }}
        />
        <StatCard
          label="Unrealized Rewards"
          value={`${formatGRT(totalUnrealized)} GRT`}
          delta={{ value: formatUSD(totalUnrealized * grtPrice), positive: true }}
        />
        <StatCard
          label="Realized Rewards"
          value={`${formatGRT(totalRealized)} GRT`}
          delta={{ value: formatUSD(totalRealized * grtPrice), positive: true }}
        />
        <StatCard
          label="Portfolio Value"
          value={`${formatGRT(portfolioValue)} GRT`}
          delta={{ value: formatUSD(portfolioValue * grtPrice), positive: true }}
        />
      </StatGrid>

      {/* Positions table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Delegation Positions</CardTitle>
            <span className="text-sm text-[var(--text-muted)]">
              {delegator.activeStakesCount} active / {delegator.stakesCount} total
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="text-left text-[11px] uppercase tracking-[0.06em] text-[var(--text-muted)] pb-3 pr-4">Indexer</th>
                  <th className="text-right text-[11px] uppercase tracking-[0.06em] text-[var(--text-muted)] pb-3 px-4">Staked</th>
                  <th className="text-right text-[11px] uppercase tracking-[0.06em] text-[var(--text-muted)] pb-3 px-4">Current Value</th>
                  <th className="text-right text-[11px] uppercase tracking-[0.06em] text-[var(--text-muted)] pb-3 px-4">Unrealized P&amp;L</th>
                  <th className="text-right text-[11px] uppercase tracking-[0.06em] text-[var(--text-muted)] pb-3 px-4">Realized</th>
                  <th className="text-right text-[11px] uppercase tracking-[0.06em] text-[var(--text-muted)] pb-3 px-4">Eff. Cut</th>
                  <th className="text-right text-[11px] uppercase tracking-[0.06em] text-[var(--text-muted)] pb-3 pl-4">Status</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((pos) => {
                  const indexerName = resolveIndexerName(pos.stake.indexer.account, pos.stake.indexer.id);
                  const isThawing = weiToGRT(pos.stake.lockedTokens) > 0;

                  return (
                    <tr
                      key={pos.stake.id}
                      className="border-b border-[var(--border-mid)] last:border-b-0 hover:bg-[var(--bg-elevated)] transition-colors"
                    >
                      {/* Indexer */}
                      <td className="py-3 pr-4">
                        <Link
                          href={`/indexers/${pos.stake.indexer.id}`}
                          className="hover:text-[var(--accent)] transition-colors"
                        >
                          <p className="text-sm font-medium text-[var(--text)]">{indexerName}</p>
                          <p className="text-[11px] font-mono text-[var(--text-faint)]">{shortenAddress(pos.stake.indexer.id)}</p>
                        </Link>
                      </td>

                      {/* Staked */}
                      <td className="text-right py-3 px-4">
                        <p className="text-sm font-mono text-[var(--text)]">{formatGRT(pos.stakedGRT)}</p>
                        <p className="text-[11px] font-mono text-[var(--text-faint)]">{formatUSD(pos.stakedGRT * grtPrice)}</p>
                      </td>

                      {/* Current Value */}
                      <td className="text-right py-3 px-4">
                        <p className="text-sm font-mono text-[var(--text)]">{formatGRT(pos.currentValue)}</p>
                        <p className="text-[11px] font-mono text-[var(--text-faint)]">{formatUSD(pos.currentValue * grtPrice)}</p>
                      </td>

                      {/* Unrealized P&L */}
                      <td className="text-right py-3 px-4">
                        <p className={cn('text-sm font-mono', pos.unrealizedGRT > 0 ? 'text-[var(--green)]' : 'text-[var(--text)]')}>
                          {pos.unrealizedGRT > 0 ? '+' : ''}{formatGRT(pos.unrealizedGRT)}
                        </p>
                        <p className="text-[11px] font-mono text-[var(--text-faint)]">{formatUSD(pos.unrealizedGRT * grtPrice)}</p>
                      </td>

                      {/* Realized */}
                      <td className="text-right py-3 px-4">
                        <p className={cn('text-sm font-mono', pos.realizedGRT > 0 ? 'text-[var(--green)]' : 'text-[var(--text)]')}>
                          {pos.realizedGRT > 0 ? '+' : ''}{formatGRT(pos.realizedGRT)}
                        </p>
                      </td>

                      {/* Eff. Cut */}
                      <td className="text-right py-3 px-4">
                        <p className="text-sm font-mono text-[var(--text)]">{pos.effectiveCut.toFixed(2)}%</p>
                      </td>

                      {/* Status */}
                      <td className="text-right py-3 pl-4">
                        {isThawing ? (
                          <Badge variant="warning">Thawing</Badge>
                        ) : pos.isActive ? (
                          <Badge variant="success">Active</Badge>
                        ) : (
                          <Badge variant="default">Closed</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Rebalancing Insights */}
      {positions.some((p) => p.insight !== null) && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CardTitle>Rebalancing Insights</CardTitle>
              <Badge variant="warning">Action Suggested</Badge>
            </div>
            <p className="text-[11px] text-[var(--text-faint)] mt-1">
              Positions earning significantly below network median APR ({networkMedianAPR.toFixed(1)}%)
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {positions
              .filter((p) => p.insight !== null)
              .map((pos) => {
                const insight = pos.insight!;
                const indexerName = resolveIndexerName(pos.stake.indexer.account, pos.stake.indexer.id);

                return (
                  <div
                    key={pos.stake.id}
                    className="p-4 rounded-[var(--radius-button)] border-[0.5px] border-[var(--amber)] bg-[var(--amber-dim)]"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-[var(--text)]">
                          <span className="font-medium">{indexerName}</span>
                          {' '}earns ~{insight.positionAPR.toFixed(1)}% APR vs. network median of{' '}
                          {insight.medianAPR.toFixed(1)}%.
                        </p>
                        {insight.topAlternative && (
                          <p className="text-[13px] text-[var(--text-muted)] mt-1">
                            Top alternative:{' '}
                            <Link
                              href={`/indexers/${insight.topAlternative.address}`}
                              className="text-[var(--accent)] hover:underline font-medium"
                            >
                              {insight.topAlternative.name}
                            </Link>
                            {' '}&mdash; {insight.topAlternative.apr.toFixed(1)}% APR,{' '}
                            <span className="font-mono">{formatGRT(insight.topAlternative.availableCapacity)}</span> GRT capacity available.
                          </p>
                        )}
                      </div>
                      <div className="flex-shrink-0">
                        <span className="text-[11px] font-mono text-[var(--amber)]">
                          {insight.belowMedianPercent.toFixed(0)}% below median
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
