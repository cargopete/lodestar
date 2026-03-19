'use client';

import { useState, useMemo } from 'react';
import { useAccount } from 'wagmi';
import { useQuery } from '@tanstack/react-query';
import { GraphQLClient } from 'graphql-request';
import {
  DELEGATOR_PORTFOLIO_QUERY,
  CURATOR_PORTFOLIO_QUERY,
  type DelegatorPortfolioResponse,
  type CuratorPortfolioResponse,
  type DelegatedStake,
} from '@/lib/queries';
import { useGRTPrice } from '@/hooks/useNetworkStats';
import { useWalletStore } from '@/hooks/useWalletStore';
import {
  weiToGRT,
  formatGRT,
  formatUSD,
  formatPPM,
  shortenAddress,
  cn,
} from '@/lib/utils';
import {
  calculateUnrealizedRewards,
  calculateThawingRemaining,
  formatThawingTime,
  generateRewardsCSV,
} from '@/lib/rewards';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { StatCard, StatGrid } from '@/components/ui/StatCard';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { RewardsBreakdown } from '@/components/ui/RewardsBreakdown';
import { ExportButton } from '@/components/ui/ExportButton';
import { WalletManager } from '@/components/ui/WalletManager';
import { PortfolioChart, generateMockPortfolioHistory } from '@/components/charts/PortfolioChart';

const client = new GraphQLClient('/api/subgraph');

function useDelegatorPortfolio(address: string | undefined) {
  return useQuery({
    queryKey: ['delegatorPortfolio', address],
    queryFn: async () => {
      if (!address) return null;
      const data = await client.request<DelegatorPortfolioResponse>(
        DELEGATOR_PORTFOLIO_QUERY,
        { id: address.toLowerCase() }
      );
      return data.delegator;
    },
    enabled: !!address,
    staleTime: 60 * 1000,
  });
}

function useCuratorPortfolio(address: string | undefined) {
  return useQuery({
    queryKey: ['curatorPortfolio', address],
    queryFn: async () => {
      if (!address) return null;
      const data = await client.request<CuratorPortfolioResponse>(
        CURATOR_PORTFOLIO_QUERY,
        { id: address.toLowerCase() }
      );
      return data.curator;
    },
    enabled: !!address,
    staleTime: 60 * 1000,
  });
}

function ConnectPrompt() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <div className="w-16 h-16 rounded-full bg-[var(--accent-dim)] flex items-center justify-center mb-6">
        <svg className="w-8 h-8 text-[var(--accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
        </svg>
      </div>
      <h2 className="text-xl font-semibold text-[var(--text)] mb-2">Connect Your Wallet</h2>
      <p className="text-[var(--text-muted)] max-w-md mb-6">
        Connect your wallet to view your delegation portfolio, track rewards, and manage your positions.
      </p>
      <p className="text-sm text-[var(--text-faint)]">
        Use the &quot;Connect Wallet&quot; button in the top right corner
      </p>
    </div>
  );
}

function DelegationCard({
  stake,
  grtPrice,
}: {
  stake: DelegatedStake;
  grtPrice: number;
}) {
  const stakedGRT = weiToGRT(stake.stakedTokens);
  const lockedGRT = weiToGRT(stake.lockedTokens);
  const realizedGRT = weiToGRT(stake.realizedRewards);
  const indexer = stake.indexer;
  const indexerName = indexer.account?.defaultName?.name || shortenAddress(indexer.id);

  // Calculate unrealized rewards
  const unrealizedGRT = calculateUnrealizedRewards(
    stake.stakedTokens,
    stake.shareAmount,
    indexer.delegatedTokens,
    indexer.delegatorShares
  );

  // Calculate share of indexer's delegation pool
  const totalDelegated = weiToGRT(indexer.delegatedTokens);
  const sharePercent = totalDelegated > 0 ? (stakedGRT / totalDelegated) * 100 : 0;

  // Check if thawing
  const isThawing = lockedGRT > 0;
  const thawingInfo = isThawing ? calculateThawingRemaining(stake.lockedUntil) : null;

  return (
    <Card hover className="relative">
      {isThawing && (
        <div className="absolute top-3 right-3">
          <Badge variant="warning">Thawing</Badge>
        </div>
      )}

      <div className="flex items-start gap-4">
        {/* Indexer avatar */}
        <div className="w-12 h-12 rounded-lg bg-[var(--accent-dim)] flex items-center justify-center flex-shrink-0">
          <span className="text-lg font-semibold text-[var(--accent)]">
            {indexerName.slice(0, 2).toUpperCase()}
          </span>
        </div>

        <div className="flex-1 min-w-0">
          {/* Indexer info */}
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-[var(--text)] truncate">{indexerName}</h3>
            {indexer.isLegacyIndexer && <Badge variant="default">Legacy</Badge>}
          </div>
          <p className="text-xs text-[var(--text-faint)] font-mono mb-3">
            {shortenAddress(indexer.id)}
          </p>

          {/* Delegation stats */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-[var(--text-faint)]">Delegated</p>
              <p className="text-sm font-mono text-[var(--text)]">{formatGRT(stakedGRT)} GRT</p>
              <p className="text-xs text-[var(--text-faint)]">{formatUSD(stakedGRT * grtPrice)}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--text-faint)]">Unrealized Rewards</p>
              <p className="text-sm font-mono text-[var(--green)]">+{formatGRT(unrealizedGRT)} GRT</p>
              <p className="text-xs text-[var(--text-faint)]">{formatUSD(unrealizedGRT * grtPrice)}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--text-faint)]">Reward Cut</p>
              <p className="text-sm font-mono text-[var(--text)]">{formatPPM(indexer.indexingRewardCut)}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--text-faint)]">Pool Share</p>
              <p className="text-sm font-mono text-[var(--text)]">{sharePercent.toFixed(4)}%</p>
            </div>
          </div>

          {/* Thawing progress */}
          {isThawing && thawingInfo && (
            <div className="mt-4">
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs text-[var(--text-muted)]">
                  {formatGRT(lockedGRT)} GRT thawing
                </span>
                <span className="text-xs font-mono text-[var(--amber)]">
                  {formatThawingTime(stake.lockedUntil)}
                </span>
              </div>
              <ProgressBar
                value={thawingInfo.percentComplete}
                max={100}
                variant="orange"
                size="sm"
              />
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

export default function ProfilePage() {
  const { address: connectedAddress, isConnected } = useAccount();
  const { wallets } = useWalletStore();
  const { data: priceData } = useGRTPrice();

  // Allow viewing any wallet (connected or watched)
  const [selectedWallet, setSelectedWallet] = useState<string | undefined>(undefined);
  const activeWallet = selectedWallet || connectedAddress;

  const { data: delegator, isLoading: delegatorLoading } = useDelegatorPortfolio(activeWallet);
  const { data: curator, isLoading: curatorLoading } = useCuratorPortfolio(activeWallet);

  const grtPrice = priceData?.price ?? 0;
  const isLoading = delegatorLoading || curatorLoading;

  // Calculate totals
  const { totalStaked, totalRealized, totalUnrealized, delegationData } = useMemo(() => {
    if (!delegator) {
      return { totalStaked: 0, totalRealized: 0, totalUnrealized: 0, delegationData: [] };
    }

    let staked = 0;
    let realized = 0;
    let unrealized = 0;
    const data: Array<{
      indexerName: string;
      indexerAddress: string;
      stakedTokens: number;
      realizedRewards: number;
      unrealizedRewards: number;
      createdAt: number;
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

      staked += stakedGRT;
      realized += realizedGRT;
      unrealized += unrealizedGRT;

      data.push({
        indexerName: stake.indexer.account?.defaultName?.name || shortenAddress(stake.indexer.id),
        indexerAddress: stake.indexer.id,
        stakedTokens: stakedGRT,
        realizedRewards: realizedGRT,
        unrealizedRewards: unrealizedGRT,
        createdAt: stake.createdAt,
      });
    }

    return { totalStaked: staked, totalRealized: realized, totalUnrealized: unrealized, delegationData: data };
  }, [delegator]);

  const totalSignalled = curator ? weiToGRT(curator.totalSignalledTokens) : 0;
  const totalCuratorRealized = curator ? weiToGRT(curator.realizedRewards) : 0;

  // Determine roles
  const isDelegator = delegator && delegator.stakesCount > 0;
  const isCurator = curator && curator.signalCount > 0;

  // Generate mock historical data
  const portfolioHistory = useMemo(() => {
    const totalValue = totalStaked + totalUnrealized;
    const totalRewards = totalRealized + totalUnrealized;
    return generateMockPortfolioHistory(totalValue, totalRewards, 90);
  }, [totalStaked, totalRealized, totalUnrealized]);

  // CSV export handler
  const handleExportCSV = () => {
    return generateRewardsCSV(delegationData, grtPrice);
  };

  // Show connect prompt if no wallet connected and no wallet selected
  if (!isConnected && !selectedWallet) {
    return <ConnectPrompt />;
  }

  return (
    <div className="space-y-6">
      {/* Action bar */}
      <div className="flex items-center justify-end gap-3">
        {isDelegator && delegationData.length > 0 && (
          <ExportButton
            onExport={handleExportCSV}
            filename={`lodestar-rewards-${activeWallet?.slice(0, 8)}-${new Date().toISOString().split('T')[0]}`}
            label="Export CSV"
          />
        )}
        <div className="flex items-center gap-2">
          {isDelegator && <Badge variant="accent">Delegator</Badge>}
          {isCurator && <Badge variant="warning">Curator</Badge>}
          {!isDelegator && !isCurator && !isLoading && (
            <Badge variant="default">No Positions</Badge>
          )}
        </div>
      </div>

      {/* Two column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Main content - 3 cols */}
        <div className="lg:col-span-3 space-y-6">
          {/* Loading state */}
          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {/* Portfolio content */}
          {!isLoading && (isDelegator || isCurator) && (
            <>
              {/* Stat cards */}
              <StatGrid>
                <StatCard
                  label="Total Delegated"
                  value={`${formatGRT(totalStaked)} GRT`}
                  delta={{
                    value: formatUSD(totalStaked * grtPrice),
                    positive: true,
                  }}
                />
                <StatCard
                  label="Unrealized Rewards"
                  value={`${formatGRT(totalUnrealized)} GRT`}
                  delta={{
                    value: formatUSD(totalUnrealized * grtPrice),
                    positive: true,
                  }}
                />
                <StatCard
                  label="Realized Rewards"
                  value={`${formatGRT(totalRealized)} GRT`}
                  delta={{
                    value: formatUSD(totalRealized * grtPrice),
                    positive: true,
                  }}
                />
                <StatCard
                  label="Portfolio Value"
                  value={`${formatGRT(totalStaked + totalUnrealized)} GRT`}
                  delta={{
                    value: formatUSD((totalStaked + totalUnrealized) * grtPrice),
                    positive: true,
                  }}
                />
              </StatGrid>

              {/* Charts row */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <PortfolioChart
                  data={portfolioHistory}
                  grtPrice={grtPrice}
                  showUSD={false}
                />
                <RewardsBreakdown
                  pending={0}
                  unrealized={totalUnrealized}
                  realized={totalRealized}
                  grtPrice={grtPrice}
                />
              </div>

              {/* Delegations */}
              {isDelegator && delegator && (
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle>Delegations</CardTitle>
                      <span className="text-sm text-[var(--text-muted)]">
                        {delegator.activeStakesCount} active / {delegator.stakesCount} total
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-4 md:grid-cols-2">
                      {delegator.stakes.map((stake) => (
                        <DelegationCard key={stake.id} stake={stake} grtPrice={grtPrice} />
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Curation positions */}
              {isCurator && curator && (
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle>Signal Positions</CardTitle>
                      <span className="text-sm text-[var(--text-muted)]">
                        {curator.activeSignalCount} active / {curator.signalCount} total
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {curator.signals.map((signal) => (
                        <div
                          key={signal.id}
                          className="flex items-center justify-between p-4 rounded-lg bg-[var(--bg-elevated)]"
                        >
                          <div>
                            <p className="text-sm font-mono text-[var(--text)]">
                              {shortenAddress(signal.subgraphDeployment.ipfsHash)}
                            </p>
                            <p className="text-xs text-[var(--text-faint)]">
                              {formatGRT(weiToGRT(signal.signalledTokens))} GRT signalled
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-mono text-[var(--green)]">
                              +{formatGRT(weiToGRT(signal.realizedRewards))} GRT
                            </p>
                            <p className="text-xs text-[var(--text-faint)]">realized</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}

          {/* Empty state */}
          {!isLoading && !isDelegator && !isCurator && (
            <Card>
              <CardContent className="py-12 text-center">
                <div className="w-16 h-16 rounded-full bg-[var(--bg-elevated)] flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-[var(--text-faint)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-[var(--text)] mb-2">No Positions Found</h3>
                <p className="text-[var(--text-muted)] max-w-md mx-auto">
                  This wallet has no delegations or signal positions on the network.
                  Visit the Indexer Directory to delegate GRT.
                </p>
                <a
                  href="/indexers"
                  className={cn(
                    'inline-flex items-center gap-2 mt-6 px-4 py-2 text-sm font-medium',
                    'rounded-[var(--radius-button)] bg-[var(--accent)] text-white',
                    'hover:opacity-90 transition-opacity'
                  )}
                >
                  Browse Indexers
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </a>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar - 1 col */}
        <div className="space-y-6">
          <WalletManager
            selectedWallet={activeWallet}
            onSelectWallet={(addr) => setSelectedWallet(addr)}
          />
        </div>
      </div>
    </div>
  );
}
