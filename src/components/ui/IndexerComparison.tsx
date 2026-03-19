'use client';

import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from './Card';
import { Badge } from './Badge';
import { ProgressBar } from './ProgressBar';
import { weiToGRT, formatGRT, formatPPM, shortenAddress, cn } from '@/lib/utils';
import { calculateDelegationCapacity, calculateEstimatedAPR } from '@/lib/rewards';

interface IndexerForComparison {
  id: string;
  name: string;
  stakedTokens: string;
  delegatedTokens: string;
  allocatedTokens: string;
  indexingRewardCut: number;
  queryFeeCut: number;
  allocationCount: number;
  rewardsEarned: string;
  delegatorParameterCooldown: number;
  lastDelegationParameterUpdate: number;
}

interface IndexerComparisonProps {
  indexers: IndexerForComparison[];
  delegationRatio?: number;
  networkRewardsPerYear?: number;
  delegationAmount?: number;
}

const METRICS = [
  { key: 'selfStake', label: 'Self-Stake', format: 'grt', highlight: 'higher' },
  { key: 'delegated', label: 'Total Delegated', format: 'grt', highlight: 'lower' },
  { key: 'capacityUsed', label: 'Capacity Used', format: 'percent', highlight: 'lower' },
  { key: 'capacityAvailable', label: 'Available Capacity', format: 'grt', highlight: 'higher' },
  { key: 'rewardCut', label: 'Reward Cut', format: 'ppm', highlight: 'lower' },
  { key: 'queryCut', label: 'Query Fee Cut', format: 'ppm', highlight: 'lower' },
  { key: 'estimatedAPR', label: 'Est. APR', format: 'percent', highlight: 'higher' },
  { key: 'allocations', label: 'Allocations', format: 'number', highlight: 'higher' },
  { key: 'totalRewards', label: 'Total Rewards Earned', format: 'grt', highlight: 'higher' },
  { key: 'isLocked', label: 'Parameters Locked', format: 'boolean', highlight: 'true' },
] as const;

type MetricKey = typeof METRICS[number]['key'];

export function IndexerComparison({
  indexers,
  delegationRatio = 16,
  networkRewardsPerYear = 300000000,
  delegationAmount = 10000,
}: IndexerComparisonProps) {
  const [sortMetric, setSortMetric] = useState<MetricKey | null>(null);

  // Process indexer data
  const processedIndexers = indexers.map((indexer) => {
    const selfStake = weiToGRT(indexer.stakedTokens);
    const delegated = weiToGRT(indexer.delegatedTokens);
    const allocated = weiToGRT(indexer.allocatedTokens);
    const totalRewards = weiToGRT(indexer.rewardsEarned);

    const capacity = calculateDelegationCapacity(selfStake, delegated, delegationRatio);
    const totalStake = selfStake + delegated;
    const indexerRewardsPerYear = (totalStake / 3000000000) * networkRewardsPerYear;

    const estimatedAPR = calculateEstimatedAPR(
      indexerRewardsPerYear,
      indexer.indexingRewardCut,
      selfStake,
      delegated,
      delegationAmount
    );

    const now = Math.floor(Date.now() / 1000);
    const cooldownEnd = indexer.lastDelegationParameterUpdate + indexer.delegatorParameterCooldown;
    const isLocked = cooldownEnd > now;

    return {
      ...indexer,
      selfStake,
      delegated,
      allocated,
      totalRewards,
      capacityUsed: capacity.utilizationPercent,
      capacityAvailable: capacity.availableCapacity,
      estimatedAPR,
      allocations: indexer.allocationCount,
      rewardCut: indexer.indexingRewardCut,
      queryCut: indexer.queryFeeCut,
      isLocked,
    };
  });

  // Find best value for each metric
  const bestValues: Record<string, number | boolean> = {};
  METRICS.forEach((metric) => {
    const values = processedIndexers.map((i) => i[metric.key as keyof typeof i]);
    if (metric.format === 'boolean') {
      bestValues[metric.key] = true;
    } else {
      const numericValues = values.filter((v): v is number => typeof v === 'number');
      if (numericValues.length > 0) {
        bestValues[metric.key] = metric.highlight === 'higher'
          ? Math.max(...numericValues)
          : Math.min(...numericValues);
      }
    }
  });

  const formatValue = (value: unknown, format: string) => {
    if (format === 'grt') return `${formatGRT(value as number)} GRT`;
    if (format === 'ppm') return formatPPM(value as number);
    if (format === 'percent') return `${(value as number).toFixed(2)}%`;
    if (format === 'boolean') return (value as boolean) ? 'Yes' : 'No';
    if (format === 'number') return String(value);
    return String(value);
  };

  const isBestValue = (metric: typeof METRICS[number], value: unknown) => {
    if (metric.format === 'boolean') {
      return value === true;
    }
    return value === bestValues[metric.key];
  };

  if (indexers.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-[var(--text-muted)]">Select indexers to compare</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Indexer Comparison</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-[var(--bg-elevated)]">
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider sticky left-0 bg-[var(--bg-elevated)] z-10">
                  Metric
                </th>
                {processedIndexers.map((indexer) => (
                  <th
                    key={indexer.id}
                    className="px-4 py-3 text-center text-xs font-medium text-[var(--text)] min-w-[160px]"
                  >
                    <div className="flex flex-col items-center gap-1">
                      <span className="font-semibold">{indexer.name}</span>
                      <span className="text-[var(--text-faint)] font-mono text-xs">
                        {shortenAddress(indexer.id)}
                      </span>
                      {indexer.isLocked && (
                        <Badge variant="success">Locked</Badge>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {METRICS.map((metric) => (
                <tr key={metric.key} className="hover:bg-[var(--bg-elevated)] transition-colors">
                  <td className="px-4 py-3 text-sm text-[var(--text-muted)] sticky left-0 bg-[var(--bg-surface)] z-10">
                    {metric.label}
                  </td>
                  {processedIndexers.map((indexer) => {
                    const value = indexer[metric.key as keyof typeof indexer];
                    const isBest = isBestValue(metric, value);

                    return (
                      <td
                        key={`${indexer.id}-${metric.key}`}
                        className={cn(
                          'px-4 py-3 text-center font-mono text-sm',
                          isBest ? 'text-[var(--green)] font-semibold' : 'text-[var(--text)]'
                        )}
                      >
                        <div className="flex items-center justify-center gap-2">
                          {formatValue(value, metric.format)}
                          {isBest && (
                            <svg className="w-4 h-4 text-[var(--green)]" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                            </svg>
                          )}
                        </div>
                        {/* Capacity bar for visual */}
                        {metric.key === 'capacityUsed' && (
                          <div className="mt-1 w-full max-w-[100px] mx-auto">
                            <ProgressBar
                              value={value as number}
                              max={100}
                              size="sm"
                              variant={(value as number) > 90 ? 'orange' : 'teal'}
                            />
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Legend */}
        <div className="px-4 py-3 border-t border-[var(--border)] bg-[var(--bg-elevated)]">
          <div className="flex items-center gap-4 text-xs text-[var(--text-faint)]">
            <div className="flex items-center gap-1">
              <svg className="w-4 h-4 text-[var(--green)]" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span>Best value for metric</span>
            </div>
            <div className="flex items-center gap-1">
              <Badge variant="success">Locked</Badge>
              <span>Parameters cannot change during cooldown</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
