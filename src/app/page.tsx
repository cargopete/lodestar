'use client';

import Link from 'next/link';
import { useNetworkStats, useGRTPrice, useTVL, useEpochInfo, useSubgraphDeployments30d } from '@/hooks/useNetworkStats';
import { weiToGRT, formatGRT, formatUSD, formatNumber, formatPPM } from '@/lib/utils';
import { StatCard, StatGrid } from '@/components/ui/StatCard';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { HorizonParameters } from '@/components/ui/HorizonParameters';
import { HorizonActivity } from '@/components/ui/HorizonActivity';
import dynamic from 'next/dynamic';

const StakingTrendChart = dynamic(() => import('@/components/charts/StakingTrendChart').then(m => ({ default: m.StakingTrendChart })), { ssr: false });
const RewardSplitDonut = dynamic(() => import('@/components/charts/RewardSplitDonut').then(m => ({ default: m.RewardSplitDonut })), { ssr: false });
const QueryFeesChart = dynamic(() => import('@/components/charts/QueryFeesChart').then(m => ({ default: m.QueryFeesChart })), { ssr: false });
const TokenIssuanceChart = dynamic(() => import('@/components/charts/TokenIssuanceChart').then(m => ({ default: m.TokenIssuanceChart })), { ssr: false });
const DelegationFlowChart = dynamic(() => import('@/components/charts/DelegationFlowChart').then(m => ({ default: m.DelegationFlowChart })), { ssr: false });

export default function ProtocolOverview() {
  const { data: networkData, isLoading: networkLoading } = useNetworkStats();
  const { data: priceData, isLoading: priceLoading } = useGRTPrice();
  const { data: tvlData, isLoading: tvlLoading } = useTVL();
  const { data: subgraphs30d, isLoading: subgraphsLoading } = useSubgraphDeployments30d();

  const network = networkData?.graphNetwork;

  const totalStaked = network ? weiToGRT(network.totalTokensStaked) : 0;
  const totalDelegated = network ? weiToGRT(network.totalDelegatedTokens) : 0;
  const totalSignalled = network ? weiToGRT(network.totalTokensSignalled) : 0;
  const totalAllocated = network ? weiToGRT(network.totalTokensAllocated) : 0;
  const totalQueryFees = network ? weiToGRT(network.totalQueryFees) : 0;

  const { epoch: actualEpoch, progress: epochProgress, epochLength } = useEpochInfo();

  const topSubgraphs = (subgraphs30d ?? [])
    .slice()
    .sort((a, b) => {
      const diff = BigInt(b.queryFees30d) - BigInt(a.queryFees30d);
      return diff > 0n ? 1 : diff < 0n ? -1 : 0;
    })
    .slice(0, 10);

  return (
    <div className="space-y-6">

      {/* Page header */}
      <div className="pb-2 border-b border-[var(--border)]">
        <h1 className="text-2xl font-semibold text-[var(--text)]">The Graph Protocol</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          Decentralised indexing infrastructure — live network data
        </p>
      </div>

      {/* KPI stat cards */}
      <StatGrid>
        <StatCard
          label="Total Staked"
          value={networkLoading ? '—' : `${formatGRT(totalStaked)} GRT`}
          loading={networkLoading}
        />
        <StatCard
          label="Total Delegated"
          value={networkLoading ? '—' : `${formatGRT(totalDelegated)} GRT`}
          loading={networkLoading}
        />
        <StatCard
          label="Total Signalled"
          value={networkLoading ? '—' : `${formatGRT(totalSignalled)} GRT`}
          loading={networkLoading}
        />
        <StatCard
          label="GRT Price"
          value={priceLoading ? '—' : priceData?.price ? formatUSD(priceData.price, 4) : '—'}
          delta={
            priceData?.price && priceData.change24h != null
              ? {
                  value: `${priceData.change24h.toFixed(2)}%`,
                  positive: priceData.change24h >= 0,
                }
              : undefined
          }
          loading={priceLoading}
        />
        <StatCard
          label="Network TVL"
          value={tvlLoading ? '—' : formatUSD(tvlData?.tvl ?? 0)}
          loading={tvlLoading}
        />
        <StatCard
          label="Lifetime Query Fees"
          value={networkLoading ? '—' : `${formatGRT(totalQueryFees)} GRT`}
          loading={networkLoading}
        />
      </StatGrid>

      {/* Epoch progress */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 mb-3">
            <div className="flex items-center gap-3">
              <span className="text-sm text-[var(--text-muted)]">Current Epoch</span>
              <span className="text-lg font-mono font-semibold text-[var(--accent)]">
                {actualEpoch || '—'}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-[var(--text-muted)]">Epoch Length</span>
              <span className="text-sm font-mono text-[var(--text)]">
                {epochLength ? formatNumber(epochLength) : '—'} blocks
              </span>
            </div>
          </div>
          <ProgressBar
            value={epochProgress}
            max={100}
            label="Epoch Progress"
            showValue
            variant="accent"
            size="lg"
          />
        </CardContent>
      </Card>

      {/* Query fees — most important revenue chart, prominent position */}
      <QueryFeesChart />

      {/* Rewards per epoch + token distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <StakingTrendChart />
        <RewardSplitDonut />
      </div>

      {/* Token issuance & burn */}
      <TokenIssuanceChart />

      {/* Delegation flows */}
      <DelegationFlowChart />

      {/* Network participants + protocol parameters */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Network Participants</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-4 rounded-[var(--radius-button)] bg-[var(--bg-elevated)] border border-[var(--border)]">
                <p className="text-[13px] text-[var(--text-muted)]">Indexers</p>
                <p className="text-xl font-mono font-semibold text-[var(--accent)] mt-1">
                  {network?.stakedIndexersCount ?? '—'}
                </p>
                <p className="text-xs text-[var(--text-faint)] mt-0.5">
                  {network?.indexerCount ?? '—'} total
                </p>
              </div>
              <div className="p-4 rounded-[var(--radius-button)] bg-[var(--bg-elevated)] border border-[var(--border)]">
                <p className="text-[13px] text-[var(--text-muted)]">Delegators</p>
                <p className="text-xl font-mono font-semibold text-[var(--green)] mt-1">
                  {network?.activeDelegatorCount ? formatNumber(network.activeDelegatorCount) : '—'}
                </p>
              </div>
              <div className="p-4 rounded-[var(--radius-button)] bg-[var(--bg-elevated)] border border-[var(--border)]">
                <p className="text-[13px] text-[var(--text-muted)]">Curators</p>
                <p className="text-xl font-mono font-semibold text-[var(--amber)] mt-1">
                  {network?.activeCuratorCount ? formatNumber(network.activeCuratorCount) : '—'}
                </p>
              </div>
              <div className="p-4 rounded-[var(--radius-button)] bg-[var(--bg-elevated)] border border-[var(--border)]">
                <p className="text-[13px] text-[var(--text-muted)]">Active Subgraphs</p>
                <p className="text-xl font-mono font-semibold text-[var(--text)] mt-1">
                  {network?.activeSubgraphCount ? formatNumber(network.activeSubgraphCount) : '—'}
                </p>
                <p className="text-xs text-[var(--text-faint)] mt-0.5">
                  {network?.subgraphCount ? formatNumber(network.subgraphCount) : '—'} total
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Protocol Parameters</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-0">
              <div className="flex justify-between items-center py-3 border-b border-[var(--border)]">
                <span className="text-[13px] text-[var(--text-muted)]">Delegation Ratio</span>
                <span className="font-mono text-[var(--text)]">
                  {network?.delegationRatio ?? '—'}x
                </span>
              </div>
              <div className="flex justify-between items-center py-3 border-b border-[var(--border)]">
                <span className="text-[13px] text-[var(--text-muted)]">Protocol Fee %</span>
                <span className="font-mono text-[var(--text)]">
                  {network?.protocolFeePercentage
                    ? formatPPM(network.protocolFeePercentage)
                    : '—'}
                </span>
              </div>
              <div className="flex justify-between items-center py-3 border-b border-[var(--border)]">
                <span className="text-[13px] text-[var(--text-muted)]">Total Indexing Rewards</span>
                <span className="font-mono text-[var(--text)]">
                  {network?.totalIndexingRewards
                    ? `${formatGRT(weiToGRT(network.totalIndexingRewards))} GRT`
                    : '—'}
                </span>
              </div>
              <div className="flex justify-between items-center py-3 border-b border-[var(--border)]">
                <span className="text-[13px] text-[var(--text-muted)]">Fee-to-Inflation Ratio</span>
                <span className="font-mono text-[var(--text)]">
                  {network?.totalQueryFees && network?.totalIndexingRewards
                    ? (() => {
                        const fees = weiToGRT(network.totalQueryFees);
                        const rewards = weiToGRT(network.totalIndexingRewards);
                        return rewards > 0 ? `${((fees / rewards) * 100).toFixed(2)}%` : '—';
                      })()
                    : '—'}
                </span>
              </div>
              <div className="flex justify-between items-center py-3 border-b border-[var(--border)]">
                <span className="text-[13px] text-[var(--text-muted)]">Max Allocation Epochs</span>
                <span className="font-mono text-[var(--text)]">
                  {network?.maxAllocationEpochs ?? '—'}
                </span>
              </div>
              <div className="flex justify-between items-center py-3">
                <span className="text-[13px] text-[var(--text-muted)]">Total Allocated</span>
                <span className="font-mono text-[var(--text)]">
                  {formatGRT(totalAllocated)} GRT
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Top subgraphs by 30-day query fees */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Top Subgraphs by Revenue</CardTitle>
              <p className="text-sm text-[var(--text-muted)] mt-1">Ranked by query fees collected in the last 30 days</p>
            </div>
            <Link
              href="/subgraphs"
              className="text-xs text-[var(--accent)] hover:underline shrink-0"
            >
              View all →
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {subgraphsLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-10 shimmer rounded" />
              ))}
            </div>
          ) : topSubgraphs.length === 0 ? (
            <p className="text-sm text-[var(--text-faint)]">No data available</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="text-left py-2 pr-4 text-[11px] font-medium text-[var(--text-faint)] w-8">#</th>
                    <th className="text-left py-2 pr-4 text-[11px] font-medium text-[var(--text-faint)]">Subgraph</th>
                    <th className="text-right py-2 pr-4 text-[11px] font-medium text-[var(--text-faint)]">30d Fees</th>
                    <th className="text-right py-2 pr-4 text-[11px] font-medium text-[var(--text-faint)]">Signal</th>
                    <th className="text-right py-2 text-[11px] font-medium text-[var(--text-faint)]">Indexers</th>
                  </tr>
                </thead>
                <tbody>
                  {topSubgraphs.map((sg, i) => {
                    const fees30d = weiToGRT(sg.queryFees30d);
                    const signal = weiToGRT(sg.signalledTokens);
                    const name = sg.displayName ?? `${sg.ipfsHash.slice(0, 10)}…`;
                    return (
                      <tr
                        key={sg.id}
                        className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--bg-elevated)] transition-colors"
                      >
                        <td className="py-3 pr-4 text-[var(--text-faint)] font-mono text-xs">{i + 1}</td>
                        <td className="py-3 pr-4 max-w-[200px]">
                          <Link
                            href={`/subgraphs/${sg.ipfsHash}`}
                            className="text-[var(--text)] hover:text-[var(--accent)] transition-colors truncate block font-medium"
                            title={name}
                          >
                            {name}
                          </Link>
                        </td>
                        <td className="py-3 pr-4 text-right font-mono text-[var(--accent)]">
                          {formatGRT(fees30d)} GRT
                        </td>
                        <td className="py-3 pr-4 text-right font-mono text-[var(--text-muted)] text-xs">
                          {formatGRT(signal)}
                        </td>
                        <td className="py-3 text-right font-mono text-[var(--text-muted)] text-xs">
                          {sg.indexerAllocations.length}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Live activity feed */}
      <HorizonActivity />

      {/* Horizon Parameters */}
      <HorizonParameters />
    </div>
  );
}
