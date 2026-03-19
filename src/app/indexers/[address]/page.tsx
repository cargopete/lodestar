'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GraphQLClient } from 'graphql-request';
import { INDEXER_DETAILS_QUERY } from '@/lib/queries';
import { useGRTPrice, useNetworkStats, useIndexerProvisions } from '@/hooks/useNetworkStats';
import {
  weiToGRT,
  formatGRT,
  formatGRTFull,
  formatUSD,
  formatPPM,
  shortenAddress,
  cn,
} from '@/lib/utils';
import { calculateDelegationCapacity } from '@/lib/rewards';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { StatCard, StatGrid } from '@/components/ui/StatCard';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { EffectiveCutCalculator } from '@/components/ui/EffectiveCutCalculator';
import { ProvisionsPanel } from '@/components/ui/ProvisionsPanel';

const client = new GraphQLClient('/api/subgraph');

interface IndexerDetailsResponse {
  indexer: {
    id: string;
    account: {
      id: string;
      defaultDisplayName: string | null;
    };
    stakedTokens: string;
    delegatedTokens: string;
    allocatedTokens: string;
    tokenCapacity: string;
    allocationCount: number;
    indexingRewardCut: number;
    queryFeeCut: number;
    rewardsEarned: string;
    delegatorShares: string;
    url: string | null;
    geoHash: string | null;
    createdAt: number;
    allocations: Array<{
      id: string;
      allocatedTokens: string;
      createdAtEpoch: number;
      subgraphDeployment: {
        id: string;
        signalledTokens: string;
        stakedTokens: string;
      };
    }>;
    delegators: Array<{
      id: string;
      stakedTokens: string;
      shareAmount: string;
      delegator: { id: string };
    }>;
  } | null;
}

function useIndexerDetails(address: string) {
  return useQuery({
    queryKey: ['indexerDetails', address],
    queryFn: async () => {
      const data = await client.request<IndexerDetailsResponse>(INDEXER_DETAILS_QUERY, {
        id: address.toLowerCase(),
      });
      return data.indexer;
    },
    staleTime: 60 * 1000,
  });
}

export default function IndexerDetailPage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = use(params);
  const { data: indexer, isLoading, error } = useIndexerDetails(address);
  const { data: priceData } = useGRTPrice();
  const { data: networkData } = useNetworkStats();
  const { data: provisionsData, isLoading: provisionsLoading } = useIndexerProvisions(address);

  const grtPrice = priceData?.price ?? 0;
  const delegationRatio = networkData?.graphNetwork?.delegationRatio ?? 16;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !indexer) {
    return (
      <div className="text-center py-24">
        <h2 className="text-xl font-semibold text-[var(--text)] mb-2">Indexer Not Found</h2>
        <p className="text-[var(--text-muted)]">
          Could not find indexer with address {shortenAddress(address)}
        </p>
        <a
          href="/indexers"
          className={cn(
            'inline-flex items-center gap-2 mt-6 px-4 py-2 text-sm font-medium',
            'rounded-[var(--radius-button)] border border-[var(--border)]',
            'hover:border-[var(--accent-hover)] transition-colors'
          )}
        >
          Back to Directory
        </a>
      </div>
    );
  }

  const name = indexer.account?.defaultDisplayName || shortenAddress(indexer.id);
  const selfStake = weiToGRT(indexer.stakedTokens);
  const delegated = weiToGRT(indexer.delegatedTokens);
  const allocated = weiToGRT(indexer.allocatedTokens);
  const totalRewards = weiToGRT(indexer.rewardsEarned);
  const capacity = calculateDelegationCapacity(selfStake, delegated, delegationRatio);

  // Check parameter lock status
  const createdDate = new Date(indexer.createdAt * 1000);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          {/* Avatar */}
          <div className="w-16 h-16 rounded-xl bg-[var(--accent-dim)] flex items-center justify-center">
            <span className="text-2xl font-bold text-[var(--accent)]">
              {name.slice(0, 2).toUpperCase()}
            </span>
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-[var(--text)]">{name}</h1>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-sm text-[var(--text-faint)] font-mono">{indexer.id}</p>
              <a
                href={`https://arbiscan.io/address/${indexer.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--accent)] hover:underline"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {indexer.url && (
            <a
              href={indexer.url}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                'px-3 py-2 text-sm rounded-[var(--radius-button)]',
                'border border-[var(--border)] hover:border-[var(--accent-hover)]',
                'transition-colors'
              )}
            >
              Website
            </a>
          )}
          <Badge variant="accent">
            Active since {createdDate.toLocaleDateString()}
          </Badge>
        </div>
      </div>

      {/* Stats */}
      <StatGrid>
        <StatCard
          label="Self-Stake"
          value={`${formatGRT(selfStake)} GRT`}
          delta={{ value: formatUSD(selfStake * grtPrice), positive: true }}
        />
        <StatCard
          label="Total Delegated"
          value={`${formatGRT(delegated)} GRT`}
          delta={{ value: formatUSD(delegated * grtPrice), positive: true }}
        />
        <StatCard
          label="Allocated"
          value={`${formatGRT(allocated)} GRT`}
          delta={{ value: `${indexer.allocationCount} allocations`, positive: true }}
        />
        <StatCard
          label="Total Rewards Earned"
          value={`${formatGRT(totalRewards)} GRT`}
          delta={{ value: formatUSD(totalRewards * grtPrice), positive: true }}
        />
      </StatGrid>

      {/* Main content */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left column - Calculator */}
        <EffectiveCutCalculator
          indexer={{
            id: indexer.id,
            name,
            stakedTokens: indexer.stakedTokens,
            delegatedTokens: indexer.delegatedTokens,
            indexingRewardCut: indexer.indexingRewardCut,
            queryFeeCut: indexer.queryFeeCut,
            delegatorParameterCooldown: 0, // Mock - would need from subgraph
            lastDelegationParameterUpdate: indexer.createdAt,
          }}
          delegationRatio={delegationRatio}
        />

        {/* Right column - Details */}
        <div className="space-y-6">
          {/* Capacity */}
          <Card>
            <CardHeader>
              <CardTitle>Delegation Capacity</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-4">
                <ProgressBar
                  value={capacity.utilizationPercent}
                  max={100}
                  showValue
                  variant={capacity.utilizationPercent > 90 ? 'orange' : 'teal'}
                  size="lg"
                />
              </div>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-xs text-[var(--text-faint)]">Max Capacity</p>
                  <p className="text-sm font-mono text-[var(--text)]">{formatGRT(capacity.maxCapacity)}</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--text-faint)]">Used</p>
                  <p className="text-sm font-mono text-[var(--text)]">{formatGRT(capacity.usedCapacity)}</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--text-faint)]">Available</p>
                  <p className="text-sm font-mono text-[var(--green)]">{formatGRT(capacity.availableCapacity)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Parameters */}
          <Card>
            <CardHeader>
              <CardTitle>Parameters</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex justify-between items-center py-2 border-b border-[var(--border)]">
                  <span className="text-sm text-[var(--text-muted)]">Indexing Reward Cut</span>
                  <span className="font-mono text-[var(--text)]">{formatPPM(indexer.indexingRewardCut)}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-[var(--border)]">
                  <span className="text-sm text-[var(--text-muted)]">Query Fee Cut</span>
                  <span className="font-mono text-[var(--text)]">{formatPPM(indexer.queryFeeCut)}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-[var(--border)]">
                  <span className="text-sm text-[var(--text-muted)]">Delegation Ratio</span>
                  <span className="font-mono text-[var(--text)]">{delegationRatio}x</span>
                </div>
                <div className="flex justify-between items-center py-2">
                  <span className="text-sm text-[var(--text-muted)]">Active Allocations</span>
                  <span className="font-mono text-[var(--text)]">{indexer.allocationCount}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Allocations */}
      {indexer.allocations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Active Allocations</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="px-4 py-2 text-left text-xs font-medium text-[var(--text-muted)] uppercase">Subgraph</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-[var(--text-muted)] uppercase">Allocated</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-[var(--text-muted)] uppercase">Signalled</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-[var(--text-muted)] uppercase">Epoch</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {indexer.allocations.slice(0, 10).map((alloc) => (
                    <tr key={alloc.id} className="hover:bg-[var(--bg-elevated)]">
                      <td className="px-4 py-3">
                        <span className="font-mono text-sm text-[var(--text)]">
                          {shortenAddress(alloc.subgraphDeployment.id)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-mono text-sm text-[var(--text)]">
                          {formatGRT(weiToGRT(alloc.allocatedTokens))} GRT
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-mono text-sm text-[var(--green)]">
                          {formatGRT(weiToGRT(alloc.subgraphDeployment.signalledTokens))} GRT
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-mono text-sm text-[var(--text-muted)]">
                          {alloc.createdAtEpoch}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {indexer.allocations.length > 10 && (
              <p className="text-sm text-[var(--text-faint)] text-center mt-4">
                Showing 10 of {indexer.allocations.length} allocations
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Service Provisions */}
      <ProvisionsPanel
        provisions={provisionsData?.provisions ?? []}
        isLoading={provisionsLoading}
      />

      {/* Top Delegators */}
      {indexer.delegators.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Top Delegators</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {indexer.delegators.slice(0, 10).map((del, i) => {
                const delStake = weiToGRT(del.stakedTokens);
                const sharePercent = delegated > 0 ? (delStake / delegated) * 100 : 0;

                return (
                  <div
                    key={del.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-elevated)]"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-[var(--text-faint)]">#{i + 1}</span>
                      <span className="font-mono text-sm text-[var(--text)]">
                        {shortenAddress(del.delegator.id)}
                      </span>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-sm text-[var(--text)]">
                        {formatGRT(delStake)} GRT
                      </p>
                      <p className="text-xs text-[var(--text-faint)]">
                        {sharePercent.toFixed(2)}% of pool
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
