'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import {
  useNetworkStats,
  useEpochInfo,
  useSubgraphDeployments30d,
  usePayments,
} from '@/hooks/useNetworkStats';
import { weiToGRT, formatGRT, formatNumber } from '@/lib/utils';
import { StatCard, StatGrid } from '@/components/ui/StatCard';
import { SourceUnavailable } from '@/components/ui/SourceUnavailable';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';

const QueryFeesChart = dynamic(() => import('@/components/charts/QueryFeesChart').then(m => ({ default: m.QueryFeesChart })), { ssr: false });
const StakingTrendChart = dynamic(() => import('@/components/charts/StakingTrendChart').then(m => ({ default: m.StakingTrendChart })), { ssr: false });
const RewardSplitDonut = dynamic(() => import('@/components/charts/RewardSplitDonut').then(m => ({ default: m.RewardSplitDonut })), { ssr: false });
const DeveloperActivityChart = dynamic(() => import('@/components/charts/DeveloperActivityChart').then(m => ({ default: m.DeveloperActivityChart })), { ssr: false });

function SectionHeader({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div className="pt-2">
      <h2 className="text-lg font-semibold text-[var(--text)]">{title}</h2>
      <p className="text-sm text-[var(--text-muted)] mt-0.5">{blurb}</p>
    </div>
  );
}

export default function NetworkStatePage() {
  const { data: networkData, isLoading: networkLoading } = useNetworkStats();
  const { data: subgraphs30d, isLoading: subgraphsLoading } = useSubgraphDeployments30d();
  const { data: payments, isLoading: paymentsLoading } = usePayments();
  const { epoch } = useEpochInfo();

  const network = networkData?.graphNetwork;

  // See the note on the overview page: settled loading with no payload means the fetch failed, and
  // the zeros below are our fallbacks rather than the network's figures. Say so.
  const networkUnavailable = !networkLoading && !network;
  const paymentsUnavailable = !paymentsLoading && !payments;

  const totalStaked = network ? weiToGRT(network.totalTokensStaked) : 0;
  const totalDelegated = network ? weiToGRT(network.totalDelegatedTokens) : 0;
  const totalSignalled = network ? weiToGRT(network.totalTokensSignalled) : 0;
  const lifetimeQueryFees = network ? weiToGRT(network.totalQueryFees) : 0;
  const lifetimeRewards = network ? weiToGRT(network.totalIndexingRewards) : 0;
  const totalCollected = payments ? weiToGRT(payments.totalCollected) : 0;

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
        <h1 className="text-2xl font-semibold text-[var(--text)]">State of the Network</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          The health of The Graph Protocol at a glance: how heavily it&apos;s used, what developers
          are building, and the revenue flowing through it. Live on-chain data, no price speculation.
        </p>
      </div>

      {/* ===================== 1. UTILIZATION ===================== */}
      <SectionHeader
        title="Protocol utilization"
        blurb="Capital committed and participants active across the network right now."
      />
      {networkUnavailable && (
        <SourceUnavailable
          what="Live network data"
          detail="The indexer behind /api/network-stats did not answer."
        />
      )}
      <StatGrid>
        <StatCard label="Total Staked" value={`${formatGRT(totalStaked)} GRT`} loading={networkLoading} unavailable={networkUnavailable} />
        <StatCard label="Total Delegated" value={`${formatGRT(totalDelegated)} GRT`} loading={networkLoading} unavailable={networkUnavailable} />
        <StatCard label="Total Signalled" value={`${formatGRT(totalSignalled)} GRT`} loading={networkLoading} unavailable={networkUnavailable} />
        <StatCard label="Current Epoch" value={epoch ? formatNumber(epoch) : '—'} loading={networkLoading} />
        <StatCard
          label="Indexers"
          value={network?.stakedIndexersCount != null ? formatNumber(network.stakedIndexersCount) : '—'}
          subtitle={network?.indexerCount != null ? `${formatNumber(network.indexerCount)} total` : undefined}
          loading={networkLoading}
          unavailable={networkUnavailable}
        />
        <StatCard
          label="Delegators"
          value={network?.activeDelegatorCount != null ? formatNumber(network.activeDelegatorCount) : '—'}
          loading={networkLoading}
          unavailable={networkUnavailable}
        />
        <StatCard
          label="Curators"
          value={network?.activeCuratorCount != null ? formatNumber(network.activeCuratorCount) : '—'}
          loading={networkLoading}
          unavailable={networkUnavailable}
        />
        <StatCard
          label="Active Subgraphs"
          value={network?.activeSubgraphCount != null ? formatNumber(network.activeSubgraphCount) : '—'}
          subtitle={network?.subgraphCount != null ? `${formatNumber(network.subgraphCount)} total` : undefined}
          loading={networkLoading}
          unavailable={networkUnavailable}
        />
      </StatGrid>
      <QueryFeesChart />

      {/* ===================== 2. DEVELOPER ACTIVITY ===================== */}
      <SectionHeader
        title="Developer activity"
        blurb="New subgraphs published over time, the clearest signal of builders shipping on the network."
      />
      <DeveloperActivityChart />

      {/* ===================== 3. REVENUE ===================== */}
      <SectionHeader
        title="Revenue"
        blurb="Query fees and indexing rewards: what participants earn for serving data."
      />
      <StatGrid>
        <StatCard
          label="Lifetime Query Fees"
          value={`${formatGRT(lifetimeQueryFees)} GRT`}
          loading={networkLoading}
          unavailable={networkUnavailable}
        />
        <StatCard
          label="Lifetime Indexing Rewards"
          value={`${formatGRT(lifetimeRewards)} GRT`}
          loading={networkLoading}
          unavailable={networkUnavailable}
        />
        <StatCard
          label="Fees Collected (TAP)"
          value={`${formatGRT(totalCollected)} GRT`}
          subtitle="via GraphTally escrow"
          loading={paymentsLoading}
          unavailable={paymentsUnavailable}
        />
        <StatCard
          label="Active Payers"
          value={payments?.activePayers != null ? formatNumber(payments.activePayers) : '—'}
          subtitle={payments?.activeReceivers != null ? `${formatNumber(payments.activeReceivers)} receivers` : undefined}
          loading={paymentsLoading}
          unavailable={paymentsUnavailable}
        />
      </StatGrid>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <StakingTrendChart />
        <RewardSplitDonut />
      </div>

      {/* Top subgraphs by revenue */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Top Subgraphs by Revenue</CardTitle>
              <p className="text-sm text-[var(--text-muted)] mt-1">Ranked by query fees collected in the last 30 days</p>
            </div>
            <Link href="/subgraphs" className="text-xs text-[var(--accent-text)] hover:underline shrink-0">
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
                      <tr key={sg.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--bg-elevated)] transition-colors">
                        <td className="py-3 pr-4 text-[var(--text-faint)] font-mono text-xs">{i + 1}</td>
                        <td className="py-3 pr-4 max-w-[200px]">
                          <Link
                            href={`/subgraphs/${sg.ipfsHash}`}
                            className="text-[var(--text)] hover:text-[var(--accent-text)] transition-colors truncate block font-medium"
                            title={name}
                          >
                            {name}
                          </Link>
                        </td>
                        <td className="py-3 pr-4 text-right font-mono text-[var(--accent-text)]">{formatGRT(fees30d)} GRT</td>
                        <td className="py-3 pr-4 text-right font-mono text-[var(--text-muted)] text-xs">{formatGRT(signal)}</td>
                        <td className="py-3 text-right font-mono text-[var(--text-muted)] text-xs">{sg.indexerAllocations.length}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-[var(--text-faint)] text-center pt-2">
        Looking for more? See the full <Link href="/" className="text-[var(--accent-text)] hover:underline">Protocol Overview</Link>,{' '}
        <Link href="/payments" className="text-[var(--accent-text)] hover:underline">Payments</Link>, and{' '}
        <Link href="/grt-flow" className="text-[var(--accent-text)] hover:underline">GRT Flow</Link>.
      </p>
    </div>
  );
}
