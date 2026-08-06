'use client';

import { use, useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useAccount, useConnect } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { useGRTPrice, useNetworkStats, useREOStatus, useEnrichedIndexers, useENSName } from '@/hooks/useNetworkStats';
import { useGRTBalance } from '@/hooks/useGRTBalance';
import { DelegatePanel } from '@/components/ui/DelegatePanel';
import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { ProgressBar } from '@/components/ui/ProgressBar';
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
import { calculateIndexerScore, SCORE_WEIGHTS, SCORE_LABELS, type IndexerScore } from '@/lib/risk-score';

interface IndexerDetail {
  id: string;
  account: {
    id: string;
    defaultDisplayName: string | null;
    metadata?: { displayName?: string | null } | null;
  };
  stakedTokens: string;
  lockedTokens?: string;
  delegatedTokens: string;
  delegatedThawingTokens?: string;
  allocatedTokens: string;
  allocationCount: number;
  indexingRewardCut: number;
  queryFeeCut: number;
  rewardsEarned: string;
  queryFeesCollected: string;
  delegatorShares: string;
  delegatorParameterCooldown: number;
  lastDelegationParameterUpdate: number;
  url: string | null;
  provisionedTokens?: string;
  ownStakeRatio?: string;
  indexingRewardEffectiveCut?: string;
  allocations: Array<{
    allocatedTokens: string;
    subgraphDeployment: {
      signalledTokens: string;
      stakedTokens: string;
    };
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

export default function DelegatePage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = use(params);
  const { data: indexer, isLoading, error } = useIndexerDetails(address);
  const { data: priceData } = useGRTPrice();
  const { data: networkData } = useNetworkStats();
  const { data: reoData } = useREOStatus(address);
  const { data: ensData } = useENSName(address);
  const { data: enrichedData } = useEnrichedIndexers();
  const { isConnected } = useAccount();
  const { connect } = useConnect();
  const { balance } = useGRTBalance();

  const enrichedIndexer = enrichedData?.indexers?.find(
    (e) => e.id.toLowerCase() === address.toLowerCase()
  );

  const grtPrice = priceData?.price ?? 0;
  const network = networkData?.graphNetwork;
  const delegationRatio = network?.delegationRatio ?? 16;
  const totalNetworkSignal = network?.totalTokensSignalled ? weiToGRT(network.totalTokensSignalled) : 0;
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
        <Link
          href="/indexers"
          className="text-sm text-[var(--accent-text)] hover:underline"
        >
          Back to Directory
        </Link>
      </div>
    );
  }

  const name = ensData?.ensName || resolveIndexerName(indexer.account, indexer.id);
  const selfStake = weiToGRT(indexer.stakedTokens) - weiToGRT(indexer.lockedTokens ?? '0');
  const delegated = weiToGRT(indexer.delegatedTokens) - weiToGRT(indexer.delegatedThawingTokens ?? '0');
  const capacity = calculateDelegationCapacity(selfStake, delegated, delegationRatio);
  const rawCut = indexer.indexingRewardCut / 1_000_000;

  // Risk score
  const provisionedGRT = indexer.provisionedTokens ? weiToGRT(indexer.provisionedTokens) : null;
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
    effectiveCutPercent: indexer.indexingRewardEffectiveCut
      ? parseFloat(indexer.indexingRewardEffectiveCut) * 100
      : null,
    queryFeesCollectedGRT: weiToGRT(indexer.queryFeesCollected ?? '0'),
    netFlowGRT: 0,
    delegatedGRT: delegated,
    rollingAPY30d: enrichedIndexer?.rollingAPY30d ?? null,
    delegatorAPR: enrichedIndexer?.delegatorAPR ?? 0,
  }) : null;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Back link */}
      <Link
        href={`/indexers/${address}`}
        className="inline-flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--accent-text)] transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
        </svg>
        Back to {name}
      </Link>

      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-xl bg-[var(--accent-dim)] flex items-center justify-center flex-shrink-0">
          <span className="text-xl font-bold text-[var(--accent-text)]">
            {name.slice(0, 2).toUpperCase()}
          </span>
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-[var(--text)]">Delegate to {name}</h1>
          <p className="text-sm text-[var(--text-faint)] font-mono">{indexer.id}</p>
        </div>
      </div>

      {/* Indexer summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3 rounded-lg bg-[var(--bg-elevated)]">
          <p className="text-[10px] text-[var(--text-faint)]">Reward Cut</p>
          <p className={cn(
            'text-lg font-mono font-semibold mt-0.5',
            isGreedyCut(indexer.indexingRewardCut) ? 'text-[var(--red-text)]' : 'text-[var(--text)]'
          )}>
            {formatPPM(indexer.indexingRewardCut)}
          </p>
        </div>
        <div className="p-3 rounded-lg bg-[var(--bg-elevated)]">
          <p className="text-[10px] text-[var(--text-faint)]">APR</p>
          <p className={cn(
            'text-lg font-mono font-semibold mt-0.5',
            (enrichedIndexer?.delegatorAPR ?? 0) >= 3 ? 'text-[var(--green)]' : 'text-[var(--text)]'
          )}>
            {enrichedIndexer?.delegatorAPR?.toFixed(1) ?? '—'}%
          </p>
        </div>
        <div className="p-3 rounded-lg bg-[var(--bg-elevated)]">
          <p className="text-[10px] text-[var(--text-faint)]">Score</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <p className={cn(
              'text-lg font-mono font-semibold',
              indexerScore ? (
                indexerScore.composite >= 80 ? 'text-[var(--green)]' :
                indexerScore.composite >= 50 ? 'text-[var(--amber)]' : 'text-[var(--red-text)]'
              ) : 'text-[var(--text)]'
            )}>
              {indexerScore?.composite ?? '—'}
            </p>
            {indexerScore && (
              <Badge variant={
                indexerScore.grade === 'A' ? 'success' :
                indexerScore.grade === 'B' ? 'accent' :
                indexerScore.grade === 'C' ? 'warning' : 'error'
              }>
                {indexerScore.grade}
              </Badge>
            )}
          </div>
        </div>
        <div className="p-3 rounded-lg bg-[var(--bg-elevated)]">
          <p className="text-[10px] text-[var(--text-faint)]">REO</p>
          <div className="mt-0.5">
            {reoData?.status?.status === 'eligible' ? (
              <Badge variant="success">Eligible</Badge>
            ) : reoData?.status?.status === 'ineligible' ? (
              <Badge variant="error">Ineligible</Badge>
            ) : (
              <p className="text-lg font-mono text-[var(--text-faint)]">—</p>
            )}
          </div>
        </div>
      </div>

      {/* Capacity bar */}
      <div className="p-4 rounded-lg bg-[var(--bg-elevated)]">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm text-[var(--text-muted)]">Delegation Capacity</span>
          <span className="text-sm font-mono text-[var(--green)]">
            {formatGRT(capacity.availableCapacity)} GRT available
          </span>
        </div>
        <ProgressBar
          value={capacity.utilizationPercent}
          max={100}
          variant={capacity.utilizationPercent > 90 ? 'orange' : 'teal'}
          size="md"
        />
        <div className="flex justify-between mt-1.5 text-[11px] text-[var(--text-faint)]">
          <span>{capacity.utilizationPercent.toFixed(1)}% utilized</span>
          <span>Max: {formatGRT(capacity.maxCapacity)} GRT ({delegationRatio}x ratio)</span>
        </div>
      </div>

      {/* Connect wallet prompt OR delegate panel */}
      {!isConnected ? (
        <Card>
          <CardContent className="py-12 text-center">
            <div className="w-16 h-16 rounded-full bg-[var(--accent-dim)] flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-[var(--accent-text)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 013 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 013 6v3" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-[var(--text)] mb-2">Connect Your Wallet</h3>
            <p className="text-sm text-[var(--text-muted)] max-w-md mx-auto mb-6">
              Connect your wallet to delegate GRT to this indexer. You&apos;ll need GRT tokens on Arbitrum One.
            </p>
            <button
              onClick={() => connect({ connector: injected() })}
              className={cn(
                'px-6 py-3 text-sm font-semibold rounded-lg',
                'bg-[var(--accent)] text-white hover:opacity-90 transition-opacity'
              )}
            >
              Connect Wallet
            </button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* GRT balance header */}
          {balance > 0 && (
            <div className="flex items-center justify-between px-4 py-3 rounded-lg bg-[var(--bg-elevated)]">
              <span className="text-sm text-[var(--text-muted)]">Your GRT Balance</span>
              <div className="text-right">
                <span className="text-base font-mono font-semibold text-[var(--text)]">
                  {formatGRTFull(balance)} GRT
                </span>
                <span className="text-xs font-mono text-[var(--text-faint)] ml-2">
                  ({formatUSD(balance * grtPrice)})
                </span>
              </div>
            </div>
          )}

          {/* The delegation panel */}
          <DelegatePanel
            indexer={{
              id: indexer.id,
              name,
              stakedTokens: indexer.stakedTokens,
              lockedTokens: indexer.lockedTokens,
              delegatedTokens: indexer.delegatedTokens,
              indexingRewardCut: indexer.indexingRewardCut,
              allocations: indexer.allocations,
            }}
            riskGrade={indexerScore?.grade ?? null}
            reoEligible={reoData?.status?.status === 'eligible' ? true : reoData?.status?.status === 'ineligible' ? false : null}
            delegationRatio={delegationRatio}
            totalNetworkSignal={totalNetworkSignal}
            annualIssuance={annualIssuance}
          />
        </div>
      )}

      {/* What happens next */}
      <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]">
        <p className="text-xs font-semibold text-[var(--text-muted)] mb-3">How delegation works</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="flex gap-3">
            <span className="w-6 h-6 rounded-full bg-[var(--accent-dim)] flex items-center justify-center flex-shrink-0 text-xs font-bold text-[var(--accent-text)]">1</span>
            <div>
              <p className="text-sm font-medium text-[var(--text)]">Approve &amp; Delegate</p>
              <p className="text-[11px] text-[var(--text-faint)]">Approve GRT spend, then delegate to the indexer. No protocol tax since Horizon.</p>
            </div>
          </div>
          <div className="flex gap-3">
            <span className="w-6 h-6 rounded-full bg-[var(--accent-dim)] flex items-center justify-center flex-shrink-0 text-xs font-bold text-[var(--accent-text)]">2</span>
            <div>
              <p className="text-sm font-medium text-[var(--text)]">Earn Rewards</p>
              <p className="text-[11px] text-[var(--text-faint)]">Rewards accrue automatically as the indexer earns from allocations.</p>
            </div>
          </div>
          <div className="flex gap-3">
            <span className="w-6 h-6 rounded-full bg-[var(--accent-dim)] flex items-center justify-center flex-shrink-0 text-xs font-bold text-[var(--accent-text)]">3</span>
            <div>
              <p className="text-sm font-medium text-[var(--text)]">Undelegate</p>
              <p className="text-[11px] text-[var(--text-faint)]">28-day thawing period to withdraw. Manage positions from your portfolio.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
