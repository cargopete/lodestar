'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useGRTPrice, useNetworkStats, useIndexerProvisions, useREOStatus, useRecentDelegations, useENSName, useEnrichedIndexers, useIndexerStatus, useIndexerPayments } from '@/hooks/useNetworkStats';
import {
  weiToGRT,
  formatGRT,
  formatGRTFull,
  formatUSD,
  formatPPM,
  shortenAddress,
  resolveIndexerName,
  isGreedyCut,
  cn,
} from '@/lib/utils';
import { calculateDelegationCapacity } from '@/lib/rewards';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { StatCard, StatGrid } from '@/components/ui/StatCard';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { DelegationCalculator } from '@/components/ui/DelegationCalculator';
import { ProvisionsPanel } from '@/components/ui/ProvisionsPanel';
import { DelegationFeed } from '@/components/feed/DelegationFeed';
import dynamic from 'next/dynamic';

const IndexerTrendsChart = dynamic(() => import('@/components/charts/IndexerTrendsChart').then(m => ({ default: m.IndexerTrendsChart })), { ssr: false });
const StakeHistoryChart = dynamic(() => import('@/components/charts/StakeHistoryChart').then(m => ({ default: m.StakeHistoryChart })), { ssr: false });
const IndexerQoSChart = dynamic(() => import('@/components/charts/IndexerQoSChart').then(m => ({ default: m.IndexerQoSChart })), { ssr: false });
import { ParameterHistory } from '@/components/ParameterHistory';
import { calculateIndexerScore, SCORE_WEIGHTS, SCORE_LABELS, type IndexerScore } from '@/lib/risk-score';

interface IndexerDetail {
  id: string;
  account: {
    id: string;
    defaultDisplayName: string | null;
    metadata?: { displayName?: string | null; description?: string | null; website?: string | null } | null;
  };
  stakedTokens: string;
  lockedTokens?: string;
  delegatedTokens: string;
  delegatedThawingTokens?: string;
  allocatedTokens: string;
  tokenCapacity: string;
  allocationCount: number;
  indexingRewardCut: number;
  queryFeeCut: number;
  rewardsEarned: string;
  queryFeesCollected: string;
  delegatorShares: string;
  delegatorParameterCooldown: number;
  lastDelegationParameterUpdate: number;
  url: string | null;
  geoHash: string | null;
  createdAt: number;
  // Horizon metrics
  indexingRewardEffectiveCut?: string;
  overDelegationDilution?: string;
  ownStakeRatio?: string;
  delegatedStakeRatio?: string;
  indexerRewardsOwnGenerationRatio?: string;
  provisionedTokens?: string;
  allocations: Array<{
    id: string;
    allocatedTokens: string;
    createdAtEpoch: number;
    subgraphDeployment: {
      id: string;
      ipfsHash: string;
      signalledTokens: string;
      stakedTokens: string;
      versions: Array<{ subgraph: { metadata: { displayName: string } | null } | null }>;
    };
  }>;
  delegators: Array<{
    id: string;
    stakedTokens: string;
    shareAmount: string;
    delegator: { id: string };
  }>;
}

function useIndexerDetails(address: string) {
  return useQuery<IndexerDetail | null>({
    queryKey: ['indexerDetails', address],
    queryFn: async () => {
      const response = await fetch(`/api/indexer/${encodeURIComponent(address.toLowerCase())}`);
      if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
      const json = await response.json();
      return json.data?.indexer ?? null;
    },
    staleTime: 5 * 60 * 1000,
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
  const { data: reoData } = useREOStatus(address);
  const { data: recentDelegations } = useRecentDelegations(address);
  const { data: ensData } = useENSName(address);
  const { data: enrichedData } = useEnrichedIndexers();
  const { data: statusData, isLoading: statusLoading, dataUpdatedAt: statusUpdatedAt } = useIndexerStatus(address);
  const { data: paymentsData } = useIndexerPayments(address);

  // Pull pre-computed fields from enriched cache (rolling APY, score)
  const enrichedIndexer = enrichedData?.indexers?.find(
    (e) => e.id.toLowerCase() === address.toLowerCase()
  );

  const [allocPage, setAllocPage] = useState(0);
  const ALLOC_PAGE_SIZE = 25;

  const grtPrice = priceData?.price ?? 0;
  const network = networkData?.graphNetwork;
  const delegationRatio = network?.delegationRatio ?? 16;

  // Derive annual issuance and total signal for APR calculation
  const totalNetworkSignal = network?.totalTokensSignalled ? weiToGRT(network.totalTokensSignalled) : 0;
  // Ethereum L1 ~12s blocks → ~2,628,000 blocks/year
  const annualIssuance = network?.networkGRTIssuancePerBlock
    ? weiToGRT(network.networkGRTIssuancePerBlock) * 2628000
    : 0;

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

  const name = ensData?.ensName || resolveIndexerName(indexer.account, indexer.id);
  const selfStake = weiToGRT(indexer.stakedTokens) - weiToGRT(indexer.lockedTokens ?? '0');
  const delegated = weiToGRT(indexer.delegatedTokens) - weiToGRT(indexer.delegatedThawingTokens ?? '0');
  const allocated = weiToGRT(indexer.allocatedTokens);
  const totalRewards = weiToGRT(indexer.rewardsEarned);
  const capacity = calculateDelegationCapacity(selfStake, delegated, delegationRatio);

  // Combine Subgraph data with other data service provisions (Dispatch, etc.)
  const SUBGRAPH_SERVICE = '0xb2bb92d0de618878e438b55d5846cfecd9301105';
  const nonSubgraphProvisions = (provisionsData?.provisions ?? []).filter(
    p => p.dataService.id.toLowerCase() !== SUBGRAPH_SERVICE
  );
  const extraAllocated = nonSubgraphProvisions.reduce((sum, p) => sum + weiToGRT(p.tokensAllocated), 0);
  const extraAllocationCount = nonSubgraphProvisions.reduce((sum, p) => sum + p.allocationCount, 0);
  const tapCollected = paymentsData?.totalCollected ? weiToGRT(paymentsData.totalCollected) : 0;
  const extraRewards = nonSubgraphProvisions.reduce(
    (sum, p) => sum + weiToGRT(p.rewardsEarned ?? '0') + weiToGRT(p.queryFeesCollected ?? '0'),
    0
  ) + tapCollected;
  const hasMultipleServices = nonSubgraphProvisions.length > 0;
  const totalAllocated = allocated + extraAllocated;
  const totalAllocationCount = indexer.allocationCount + extraAllocationCount;
  const totalRewardsCombined = totalRewards + extraRewards;

  // Check parameter lock status
  const createdDate = new Date(indexer.createdAt * 1000);

  // Compute risk score from available data
  const provisionedGRT = indexer.provisionedTokens ? weiToGRT(indexer.provisionedTokens) : null;
  const distinctDataServices = new Set(
    (provisionsData?.provisions ?? []).map((p) => p.dataService.id.toLowerCase())
  ).size;
  const ownStakeRatio = indexer.ownStakeRatio ? parseFloat(indexer.ownStakeRatio) * 100 : null;
  const netFlowGRT = recentDelegations?.reduce((sum, e) => {
    const tokens = weiToGRT(e.tokens);
    if (e.eventType === 'delegation') return sum + tokens;
    if (e.eventType === 'undelegation') return sum - tokens;
    return sum; // ignore withdrawals — already counted at undelegation time
  }, 0) ?? 0;

  const indexerScore: IndexerScore | null = reoData?.status ? calculateIndexerScore({
    reoStatus: reoData.status.status === 'unknown' ? 'unknown' : reoData.status.status,
    reoDaysRemaining: reoData.status.daysRemaining ?? null,
    reoSource: reoData.status.source ?? 'heuristic',
    selfStakeGRT: selfStake,
    lastDelegationParameterUpdate: indexer.lastDelegationParameterUpdate,
    delegatorParameterCooldown: indexer.delegatorParameterCooldown,
    allocationCount: indexer.allocationCount,
    allocatedTokens: indexer.allocatedTokens,
    provisionedGRT,
    delegationUtilization: capacity.utilizationPercent,
    ensName: ensData?.ensName ?? null,
    url: indexer.url,
    name,
    id: indexer.id,
    rewardCutPPM: indexer.indexingRewardCut,
    queryFeeCutPPM: indexer.queryFeeCut,
    effectiveCutPercent: (() => {
      const v = indexer.indexingRewardEffectiveCut ? parseFloat(indexer.indexingRewardEffectiveCut) : null;
      return v !== null && v >= 0 && v <= 1 ? v * 100 : null;
    })(),
    queryFeesCollectedGRT: weiToGRT(indexer.queryFeesCollected ?? '0'),
    netFlowGRT,
    delegatedGRT: delegated,
    rollingAPY30d: enrichedIndexer?.rollingAPY30d ?? null,
    delegatorAPR: enrichedIndexer?.delegatorAPR ?? 0,
    distinctDataServices,
  }) : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          {/* Avatar */}
          <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-xl bg-[var(--accent-dim)] flex items-center justify-center flex-shrink-0">
            <span className="text-xl sm:text-2xl font-bold text-[var(--accent)]">
              {name.slice(0, 2).toUpperCase()}
            </span>
          </div>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-semibold text-[var(--text)] truncate">{name}</h1>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-xs sm:text-sm text-[var(--text-faint)] font-mono truncate">{indexer.id}</p>
              <a
                href={`https://arbiscan.io/address/${indexer.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--accent)] hover:underline flex-shrink-0"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap flex-shrink-0">
          {(indexer.account.metadata?.website || indexer.url) && (
            <a
              href={indexer.account.metadata?.website || indexer.url!}
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
          {/* REO Status Badge with tooltip */}
          {reoData?.status?.status && reoData.status.status !== 'unknown' && (
            <div className="relative group">
              <Badge
                variant={reoData.status.status === 'eligible' ? 'success' : 'error'}
                className="cursor-help"
              >
                {reoData.status.status === 'eligible' ? 'Eligible' : 'Ineligible'}
              </Badge>
              <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 w-72 p-3 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)] shadow-xl opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity z-50">
                <p className="text-xs font-semibold text-[var(--text)] mb-2">Rewards Eligibility (GIP-0079)</p>
                {reoData.status.source === 'oracle' ? (
                  <>
                    <p className="text-[11px] text-[var(--text-muted)] mb-2">
                      Direct read from the on-chain REO oracle contract.
                    </p>
                    {reoData.status.daysRemaining !== undefined && (
                      <p className={cn(
                        'text-[11px] font-medium',
                        reoData.status.daysRemaining > 3 ? 'text-[var(--green)]' :
                        reoData.status.daysRemaining > 0 ? 'text-[var(--amber)]' : 'text-[var(--red)]'
                      )}>
                        {reoData.status.daysRemaining > 0
                          ? `Renewal in ${reoData.status.daysRemaining.toFixed(1)} days`
                          : 'Renewal overdue'}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-[11px] text-[var(--text-muted)]">
                    Estimate based on on-chain signals (oracle data pending).
                  </p>
                )}
              </div>
            </div>
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
          subtitle={formatUSD(selfStake * grtPrice)}
        />
        <StatCard
          label="Total Delegated"
          value={`${formatGRT(delegated)} GRT`}
          subtitle={formatUSD(delegated * grtPrice)}
        />
        <StatCard
          label="Allocated"
          tag={hasMultipleServices ? 'All Services' : 'Subgraph'}
          value={`${formatGRT(totalAllocated)} GRT`}
          subtitle={`${totalAllocationCount} allocation${totalAllocationCount !== 1 ? 's' : ''}`}
        />
        <StatCard
          label="Total Rewards Earned"
          tag={hasMultipleServices ? 'All Services' : 'Subgraph'}
          value={`${formatGRT(totalRewardsCombined)} GRT`}
          subtitle={formatUSD(totalRewardsCombined * grtPrice)}
        />
      </StatGrid>

      {/* Rolling APY from enriched data */}
      {enrichedIndexer && (enrichedIndexer.rollingAPY30d !== null || enrichedIndexer.rollingAPY90d !== null) && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {enrichedIndexer.rollingAPY90d !== null && (
            <Card>
              <CardContent className="py-4">
                <p className="text-[10px] text-[var(--text-faint)] mb-1">APY 90d</p>
                <p className={cn(
                  'text-xl font-semibold font-mono',
                  enrichedIndexer.rollingAPY90d >= 5 ? 'text-[var(--green)]' : 'text-[var(--text)]'
                )}>
                  {enrichedIndexer.rollingAPY90d.toFixed(2)}%
                </p>
                <p className="text-[10px] text-[var(--text-faint)] mt-1">From delegation pool share growth</p>
              </CardContent>
            </Card>
          )}
          {enrichedIndexer.rollingAPY30d !== null && (
            <Card>
              <CardContent className="py-4">
                <p className="text-[10px] text-[var(--text-faint)] mb-1">APY 30d</p>
                <p className={cn(
                  'text-xl font-semibold font-mono',
                  enrichedIndexer.rollingAPY30d >= 5 ? 'text-[var(--green)]' : 'text-[var(--text)]'
                )}>
                  {enrichedIndexer.rollingAPY30d.toFixed(2)}%
                </p>
                <p className="text-[10px] text-[var(--text-faint)] mt-1">From delegation pool share growth</p>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardContent className="py-4">
              <p className="text-[10px] text-[var(--text-faint)] mb-1">Instantaneous APR</p>
              <p className="text-xl font-semibold font-mono text-[var(--text)]">
                {enrichedIndexer.delegatorAPR.toFixed(2)}%
              </p>
              <p className="text-[10px] text-[var(--text-faint)] mt-1">Theoretical from active allocations · capped at 100%</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Greedy Indexer Warning */}
      {isGreedyCut(indexer.indexingRewardCut) && (
        <div className="flex items-start gap-3 p-4 rounded-lg border bg-[var(--red-dim)] border-[var(--red)]">
          <svg className="w-5 h-5 flex-shrink-0 mt-0.5 text-[var(--red)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <div>
            <p className="text-sm font-medium text-[var(--red)]">
              This indexer takes 100% of indexing rewards
            </p>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Delegating here earns 0% APR. All indexing rewards go to the indexer.
            </p>
          </div>
        </div>
      )}

      {/* Reward Cut Change Alert */}
      {(() => {
        const lastUpdate = indexer.lastDelegationParameterUpdate;
        const now = Math.floor(Date.now() / 1000);
        const daysSinceChange = (now - lastUpdate) / 86400;
        const cooldown = indexer.delegatorParameterCooldown;
        const cooldownDays = cooldown / 86400;
        const isLocked = cooldown > 0 && (now - lastUpdate) < cooldown;

        if (daysSinceChange <= 30) {
          return (
            <div className={cn(
              'flex items-start gap-3 p-4 rounded-lg border',
              daysSinceChange <= 7
                ? 'bg-[var(--red-dim)] border-[var(--red)]'
                : 'bg-[var(--amber-dim)] border-[var(--amber)]'
            )}>
              <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke={daysSinceChange <= 7 ? 'var(--red)' : 'var(--amber)'} strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              <div>
                <p className={cn('text-sm font-medium', daysSinceChange <= 7 ? 'text-[var(--red)]' : 'text-[var(--amber)]')}>
                  Parameters changed {Math.floor(daysSinceChange)} day{Math.floor(daysSinceChange) !== 1 ? 's' : ''} ago
                </p>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  Reward cut: {formatPPM(indexer.indexingRewardCut)} · Query fee cut: {formatPPM(indexer.queryFeeCut)}
                  {isLocked && ` · Locked for ${Math.ceil(cooldownDays - daysSinceChange)}d`}
                </p>
              </div>
            </div>
          );
        }
        return null;
      })()}

      {/* Delegate CTA */}
      <Link
        href={`/indexers/${address}/delegate`}
        className={cn(
          'flex items-center justify-between gap-4 px-6 py-5',
          'rounded-lg border border-[var(--accent)] bg-[var(--accent-dim)]',
          'hover:bg-[var(--accent)]/20 transition-colors group'
        )}
      >
        <div className="flex items-center gap-4">
          <div className="w-11 h-11 rounded-full bg-[var(--accent)] flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform">
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          </div>
          <div>
            <p className="text-base font-semibold text-[var(--text)]">Delegate to {name}</p>
            <p className="text-sm text-[var(--text-muted)]">
              {formatGRT(capacity.availableCapacity)} GRT capacity available · {enrichedIndexer?.delegatorAPR != null ? `${enrichedIndexer.delegatorAPR.toFixed(1)}% APR` : '—'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <svg className="w-5 h-5 text-[var(--accent)] group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
          </svg>
        </div>
      </Link>

      {/* Query Performance — full width, QoS oracle */}
      <IndexerQoSChart indexer={address} />

      {/* Main content */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left column - Calculator */}
        <DelegationCalculator
          indexer={{
            id: indexer.id,
            name,
            stakedTokens: indexer.stakedTokens,
            lockedTokens: indexer.lockedTokens,
            delegatedTokens: indexer.delegatedTokens,
            delegatedThawingTokens: indexer.delegatedThawingTokens,
            indexingRewardCut: indexer.indexingRewardCut,
            queryFeeCut: indexer.queryFeeCut,
            delegatorParameterCooldown: indexer.delegatorParameterCooldown,
            lastDelegationParameterUpdate: indexer.lastDelegationParameterUpdate,
            allocations: indexer.allocations,
          }}
          delegationRatio={delegationRatio}
          totalNetworkSignal={totalNetworkSignal}
          annualIssuance={annualIssuance}
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
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
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

          {/* REO Eligibility — direct oracle read */}
          {reoData?.status?.status && reoData.status.status !== 'unknown' && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Rewards Eligibility</CardTitle>
                  <Badge variant={reoData.status.status === 'eligible' ? 'success' : 'error'}>
                    {reoData.status.status === 'eligible' ? 'Eligible' : 'Ineligible'}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                {reoData.status.source === 'oracle' ? (
                  <div className="space-y-3">
                    {/* Renewal countdown */}
                    {reoData.status.daysRemaining !== undefined && reoData.status.renewalTimestamp > 0 && (
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-sm text-[var(--text-muted)]">Eligibility renewal</span>
                          <span className={cn(
                            'text-sm font-medium',
                            reoData.status.daysRemaining > 3 ? 'text-[var(--green)]' :
                            reoData.status.daysRemaining > 0 ? 'text-[var(--amber)]' : 'text-[var(--red)]'
                          )}>
                            {reoData.status.daysRemaining > 0
                              ? `${reoData.status.daysRemaining.toFixed(1)} days remaining`
                              : 'Renewal overdue'}
                          </span>
                        </div>
                        {reoData.status.eligibilityPeriod && reoData.status.daysRemaining > 0 && (
                          <ProgressBar
                            value={Math.max(0, (reoData.status.daysRemaining / (reoData.status.eligibilityPeriod / 86400)) * 100)}
                            variant={reoData.status.daysRemaining > 3 ? 'teal' : 'orange'}
                          />
                        )}
                      </div>
                    )}
                    {reoData.status.renewalTimestamp === 0 && (
                      <p className="text-sm text-[var(--text-muted)]">
                        No renewal on record — this indexer has not yet met the oracle&apos;s quality thresholds (HTTP 200, &lt;5s response, &lt;50K blocks behind chain head).
                      </p>
                    )}
                    {/* Timestamps */}
                    <div className="grid grid-cols-2 gap-3 text-[11px]">
                      {reoData.status.renewalTimestamp > 0 && (
                        <div>
                          <p className="text-[var(--text-faint)]">Last renewed</p>
                          <p className="text-[var(--text)] font-mono">
                            {new Date(reoData.status.renewalTimestamp * 1000).toLocaleDateString()}
                          </p>
                        </div>
                      )}
                      {reoData.status.renewalTimestamp > 0 && reoData.status.expiresAt > 0 && (
                        <div>
                          <p className="text-[var(--text-faint)]">Expires</p>
                          <p className="text-[var(--text)] font-mono">
                            {new Date(reoData.status.expiresAt * 1000).toLocaleDateString()}
                          </p>
                        </div>
                      )}
                    </div>
                    <p className="text-[10px] text-[var(--text-faint)] leading-relaxed">
                      Source: REO oracle contract (GIP-0079). The oracle evaluates indexer service quality — HTTP status, response speed, and data freshness — over 28-day windows with 14-day renewal cycles.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {/* Heuristic fallback — show basic checks */}
                    {reoData.status.checks && [
                      { label: 'Active allocations', pass: reoData.status.checks.hasAllocations },
                      { label: 'Recent POI activity', pass: reoData.status.checks.hasRecentPOIs },
                      { label: 'Sufficient self-stake (100K+)', pass: reoData.status.checks.hasSufficientStake },
                      { label: 'Horizon provisions', pass: reoData.status.checks.hasProvisions },
                    ].map((check) => (
                      <div key={check.label} className="flex items-center gap-2.5">
                        <div className={cn(
                          'w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0',
                          check.pass ? 'bg-[var(--green-dim)]' : 'bg-[var(--red-dim)]'
                        )}>
                          {check.pass ? (
                            <svg className="w-2.5 h-2.5 text-[var(--green)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          ) : (
                            <svg className="w-2.5 h-2.5 text-[var(--red)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          )}
                        </div>
                        <span className={cn('text-sm', check.pass ? 'text-[var(--text)]' : 'text-[var(--text-muted)]')}>
                          {check.label}
                        </span>
                      </div>
                    ))}
                    <p className="text-[10px] text-[var(--text-faint)] mt-3 leading-relaxed">
                      Estimate based on on-chain signals — oracle read unavailable.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Indexer Score Breakdown */}
          {indexerScore && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Indexer Score</CardTitle>
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      'text-2xl font-mono font-bold',
                      indexerScore.composite >= 80 ? 'text-[var(--green)]' :
                      indexerScore.composite >= 65 ? 'text-[var(--teal, var(--green))]' :
                      indexerScore.composite >= 50 ? 'text-[var(--amber)]' : 'text-[var(--red)]'
                    )}>
                      {indexerScore.composite}
                    </span>
                    <Badge variant={
                      indexerScore.grade === 'A' ? 'success' :
                      indexerScore.grade === 'B' ? 'accent' :
                      indexerScore.grade === 'C' ? 'warning' : 'error'
                    }>
                      {indexerScore.grade}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {(Object.keys(SCORE_WEIGHTS) as Array<keyof typeof SCORE_WEIGHTS>).map((key) => {
                    const dimScore = indexerScore.breakdown[key];
                    const weight = SCORE_WEIGHTS[key];
                    const label = SCORE_LABELS[key];
                    return (
                      <div key={key}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-[var(--text-muted)]">
                            {label}
                            <span className="text-[var(--text-faint)] ml-1">({weight}%)</span>
                          </span>
                          <span className={cn(
                            'text-xs font-mono font-medium',
                            dimScore >= 80 ? 'text-[var(--green)]' :
                            dimScore >= 50 ? 'text-[var(--amber)]' : 'text-[var(--red)]'
                          )}>
                            {dimScore}
                          </span>
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
                          <div
                            className={cn(
                              'h-full rounded-full transition-all duration-500',
                              dimScore >= 80 ? 'bg-[var(--green)]' :
                              dimScore >= 50 ? 'bg-[var(--amber)]' : 'bg-[var(--red)]'
                            )}
                            style={{ width: `${dimScore}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="text-[10px] text-[var(--text-faint)] mt-4 leading-relaxed">
                  Composite score from 11 on-chain dimensions. Weights reflect delegator priorities: REO compliance (20%), allocation efficiency (13%), self-stake (12%), delegator cut (10%), delegation safety (9%), transparency (8%), delegator APY (8%), data service coverage (5%), query volume (6%), cut stability (6%), delegation trend (3%). Higher = better for delegators.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Recent Delegation Activity — reusable feed component pre-filtered to this indexer */}
          <DelegationFeed indexerAddress={address} />

          {/* Stake History — self-stake vs delegated over 6 months */}
          <StakeHistoryChart indexer={address} />

          {/* Daily Reward & Query Fee Trends (supplementary — community subgraph) */}
          <IndexerTrendsChart indexer={address} />

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
                {(() => {
                  const v = indexer.indexingRewardEffectiveCut ? parseFloat(indexer.indexingRewardEffectiveCut) : null;
                  return v !== null && v >= 0 && v <= 1 ? (
                    <div className="flex justify-between items-center py-2 border-b border-[var(--border)]">
                      <span className="text-sm text-[var(--text-muted)]">Effective Cut</span>
                      <span className="font-mono text-[var(--text)]">{(v * 100).toFixed(2)}%</span>
                    </div>
                  ) : null;
                })()}
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

          {/* Parameter Change History */}
          <ParameterHistory address={address} />

          {/* Horizon Metrics */}
          {(indexer.overDelegationDilution || indexer.ownStakeRatio || indexer.provisionedTokens) && (
            <Card>
              <CardHeader>
                <CardTitle>Horizon Metrics</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {indexer.ownStakeRatio && (
                    <div className="flex justify-between items-center py-2 border-b border-[var(--border)]">
                      <span className="text-sm text-[var(--text-muted)]">Own Stake Ratio</span>
                      <span className="font-mono text-[var(--text)]">{(parseFloat(indexer.ownStakeRatio) * 100).toFixed(1)}%</span>
                    </div>
                  )}
                  {indexer.indexerRewardsOwnGenerationRatio && (
                    <div className="flex justify-between items-center py-2 border-b border-[var(--border)]">
                      <span className="text-sm text-[var(--text-muted)]">Rewards Own Generation</span>
                      <span className={cn(
                        'font-mono',
                        parseFloat(indexer.indexerRewardsOwnGenerationRatio) > 1 ? 'text-[var(--amber)]' : 'text-[var(--text)]'
                      )}>
                        {(parseFloat(indexer.indexerRewardsOwnGenerationRatio) * 100).toFixed(1)}%
                      </span>
                    </div>
                  )}
                  {indexer.overDelegationDilution && parseFloat(indexer.overDelegationDilution) > 0 && (
                    <div className="flex justify-between items-center py-2 border-b border-[var(--border)]">
                      <span className="text-sm text-[var(--amber)]">Overdelegation Dilution</span>
                      <span className="font-mono text-[var(--amber)]">{(parseFloat(indexer.overDelegationDilution) * 100).toFixed(1)}%</span>
                    </div>
                  )}
                  {indexer.provisionedTokens && (
                    <div className="flex justify-between items-center py-2">
                      <span className="text-sm text-[var(--text-muted)]">Provisioned Stake</span>
                      <span className="font-mono text-[var(--text)]">{formatGRT(weiToGRT(indexer.provisionedTokens))} GRT</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Allocations with Indexing Status */}
      {indexer.allocations.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Active Allocations</CardTitle>
              <div className="flex items-center gap-3 text-xs">
                {statusData && (
                  <>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-[var(--green)]" />
                      {statusData.syncedCount} synced
                    </span>
                    {statusData.syncingCount > 0 && (
                      <span className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-[var(--amber)]" />
                        {statusData.syncingCount} syncing
                      </span>
                    )}
                    {statusData.failedCount > 0 && (
                      <span className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-[var(--red)]" />
                        {statusData.failedCount} failed
                      </span>
                    )}
                    {statusData.unreachableCount > 0 && (
                      <span className="flex items-center gap-1.5 text-[var(--text-faint)]">
                        {statusData.unreachableCount} unreachable
                      </span>
                    )}
                    <span className="w-px h-3 bg-[var(--border)]" />
                  </>
                )}
                {statusUpdatedAt > 0 ? (
                  <span
                    className="flex items-center gap-1 text-[10px] text-[var(--text-faint)] tabular-nums"
                    title="Status fetched live from the indexer's own node · refreshes every 30s"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--green)] animate-pulse shrink-0" />
                    {new Date(statusUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                ) : statusLoading ? (
                  <span className="text-[10px] text-[var(--text-faint)]">Loading…</span>
                ) : null}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="px-4 py-2 text-left text-[11px] font-medium text-[var(--text-muted)]">Deployment</th>
                    <th className="px-4 py-2 text-left text-[11px] font-medium text-[var(--text-muted)]">Status</th>
                    <th className="px-4 py-2 text-right text-[11px] font-medium text-[var(--text-muted)] hidden sm:table-cell">Blocks Behind</th>
                    <th className="px-4 py-2 text-right text-[11px] font-medium text-[var(--text-muted)]">Allocated</th>
                    <th className="px-4 py-2 text-right text-[11px] font-medium text-[var(--text-muted)] hidden lg:table-cell">Signalled</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {(statusData?.deployments ?? indexer.allocations.map((a) => ({
                    deploymentId: a.subgraphDeployment.id,
                    ipfsHash: a.subgraphDeployment.ipfsHash ?? '',
                    displayName: a.subgraphDeployment.versions?.[0]?.subgraph?.metadata?.displayName ?? null,
                    allocatedTokens: a.allocatedTokens,
                    signalledTokens: a.subgraphDeployment.signalledTokens,
                    stakedTokens: a.subgraphDeployment.stakedTokens,
                    createdAtEpoch: a.createdAtEpoch,
                    status: 'unreachable' as const,
                    network: undefined as string | undefined,
                    syncProgress: undefined as number | undefined,
                    blocksBehind: undefined as number | undefined,
                    fatalError: undefined as string | undefined,
                  })))
                    .slice(allocPage * ALLOC_PAGE_SIZE, (allocPage + 1) * ALLOC_PAGE_SIZE)
                    .map((dep) => {
                    const statusColor = {
                      synced: 'var(--green)',
                      syncing: 'var(--amber)',
                      failed: 'var(--red)',
                      unreachable: 'var(--text-faint)',
                    }[dep.status];
                    const statusLabel = {
                      synced: 'Synced',
                      syncing: 'Syncing',
                      failed: 'Failed',
                      unreachable: statusLoading ? '...' : '—',
                    }[dep.status];

                    return (
                      <tr key={dep.deploymentId} className="hover:bg-[var(--bg-elevated)]">
                        <td className="px-4 py-3">
                          <div className="flex flex-col">
                            <Link
                              href={dep.ipfsHash ? `/subgraphs/${dep.ipfsHash}` : '#'}
                              className="text-sm text-[var(--text)] hover:text-[var(--accent)] transition-colors truncate max-w-[200px]"
                            >
                              {dep.displayName ?? shortenAddress(dep.deploymentId)}
                            </Link>
                            <span className="text-[10px] font-mono text-[var(--text-faint)]">
                              {dep.ipfsHash ? `${dep.ipfsHash.slice(0, 8)}...${dep.ipfsHash.slice(-6)}` : shortenAddress(dep.deploymentId)}
                            </span>
                            {dep.network && (
                              <span className="text-[10px] text-[var(--text-faint)]">{dep.network}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: statusColor }} />
                            <span className="text-sm" style={{ color: statusColor }}>
                              {statusLabel}
                            </span>
                          </div>
                          {dep.status === 'syncing' && dep.syncProgress != null && (
                            <div className="mt-1.5 w-24 h-1 rounded-full bg-[var(--bg)] overflow-hidden">
                              <div
                                className="h-full rounded-full bg-[var(--amber)] transition-all"
                                style={{ width: `${dep.syncProgress}%` }}
                              />
                            </div>
                          )}
                          {dep.status === 'failed' && dep.fatalError && (
                            <p className="text-[10px] text-[var(--red)] mt-0.5 max-w-[200px] truncate" title={dep.fatalError}>
                              {dep.fatalError}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right hidden sm:table-cell">
                          {dep.blocksBehind != null ? (
                            <span className={cn(
                              'font-mono text-sm',
                              dep.blocksBehind <= 50 ? 'text-[var(--green)]' : dep.blocksBehind <= 500 ? 'text-[var(--amber)]' : 'text-[var(--red)]'
                            )}>
                              {dep.blocksBehind === 0 ? 'At head' : dep.blocksBehind.toLocaleString()}
                            </span>
                          ) : (
                            <span className="text-sm text-[var(--text-faint)]">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="font-mono text-sm text-[var(--text)]">
                            {formatGRT(weiToGRT(dep.allocatedTokens))}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right hidden lg:table-cell">
                          <span className="font-mono text-sm text-[var(--green)]">
                            {formatGRT(weiToGRT(dep.signalledTokens))}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {(statusData?.totalAllocations ?? indexer.allocations.length) > ALLOC_PAGE_SIZE && (() => {
              const total = statusData?.totalAllocations ?? indexer.allocations.length;
              const totalPages = Math.ceil(total / ALLOC_PAGE_SIZE);
              return (
                <div className="flex items-center justify-between mt-4 pt-3 border-t border-[var(--border)]">
                  <span className="text-sm text-[var(--text-faint)]">
                    {allocPage * ALLOC_PAGE_SIZE + 1}–{Math.min((allocPage + 1) * ALLOC_PAGE_SIZE, total)} of {total}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setAllocPage((p) => Math.max(0, p - 1))}
                      disabled={allocPage === 0}
                      className={cn(
                        'px-3 py-1.5 text-sm rounded-[var(--radius-button)]',
                        'border border-[var(--border)]',
                        'disabled:opacity-50 disabled:cursor-not-allowed',
                        'hover:bg-[var(--bg-elevated)] transition-colors'
                      )}
                    >
                      Prev
                    </button>
                    <span className="text-sm text-[var(--text-muted)]">{allocPage + 1}/{totalPages}</span>
                    <button
                      onClick={() => setAllocPage((p) => Math.min(totalPages - 1, p + 1))}
                      disabled={allocPage >= totalPages - 1}
                      className={cn(
                        'px-3 py-1.5 text-sm rounded-[var(--radius-button)]',
                        'border border-[var(--border)]',
                        'disabled:opacity-50 disabled:cursor-not-allowed',
                        'hover:bg-[var(--bg-elevated)] transition-colors'
                      )}
                    >
                      Next
                    </button>
                  </div>
                </div>
              );
            })()}
          </CardContent>
        </Card>
      )}

      {/* Service Provisions */}
      <ProvisionsPanel
        provisions={provisionsData?.provisions ?? []}
        isLoading={provisionsLoading}
        selfStakeGRT={selfStake}
      />

      {/* Recent Delegation Activity — moved to right column above */}

      {/* Top Delegators */}
      {indexer.delegators.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Top Delegators</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {[...indexer.delegators].sort((a, b) => { const ba = BigInt(b.stakedTokens), aa = BigInt(a.stakedTokens); return ba > aa ? 1 : ba < aa ? -1 : 0; }).slice(0, 10).map((del, i) => {
                const delStake = weiToGRT(del.stakedTokens);
                const sharePercent = delegated > 0 ? (delStake / delegated) * 100 : 0;

                return (
                  <div
                    key={del.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-elevated)]"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-sm text-[var(--text-faint)] flex-shrink-0">#{i + 1}</span>
                      <Link
                        href={`/delegators/${del.delegator.id}`}
                        className="font-mono text-sm text-[var(--text)] hover:text-[var(--accent)] transition-colors truncate"
                      >
                        {del.delegator.id}
                      </Link>
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
