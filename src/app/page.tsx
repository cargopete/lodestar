'use client';

import { useNetworkStats, useGRTPrice, useTVL, useEpochInfo } from '@/hooks/useNetworkStats';
import { weiToGRT, formatGRT, formatUSD, formatNumber, formatPPM } from '@/lib/utils';
import { StatCard, StatGrid } from '@/components/ui/StatCard';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { HorizonParameters } from '@/components/ui/HorizonParameters';
import { StakingTrendChart } from '@/components/charts/StakingTrendChart';
import { RewardSplitDonut } from '@/components/charts/RewardSplitDonut';

export default function ProtocolOverview() {
  const { data: networkData, isLoading: networkLoading } = useNetworkStats();
  const { data: priceData, isLoading: priceLoading } = useGRTPrice();
  const { data: tvlData, isLoading: tvlLoading } = useTVL();

  const network = networkData?.graphNetwork;

  const totalStaked = network ? weiToGRT(network.totalTokensStaked) : 0;
  const totalDelegated = network ? weiToGRT(network.totalDelegatedTokens) : 0;
  const totalSignalled = network ? weiToGRT(network.totalTokensSignalled) : 0;
  const totalAllocated = network ? weiToGRT(network.totalTokensAllocated) : 0;

  const { epoch: actualEpoch, progress: epochProgress, epochLength } = useEpochInfo();

  return (
    <div className="space-y-6">
      {/* Stat cards row */}
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

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <StakingTrendChart />
        <RewardSplitDonut />
      </div>

      {/* Bottom panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Participant counts */}
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

        {/* Protocol parameters */}
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

      {/* Horizon Parameters */}
      <HorizonParameters />
    </div>
  );
}
