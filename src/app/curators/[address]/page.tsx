'use client';

import { use, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { type Signal, type Curator } from '@/lib/queries';
import {
  weiToGRT,
  formatGRT,
  shortenAddress,
  cn,
} from '@/lib/utils';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { StatCard, StatGrid } from '@/components/ui/StatCard';

function useCuratorPortfolio(address: string) {
  return useQuery<Curator | null>({
    queryKey: ['curatorPortfolio', address],
    queryFn: async () => {
      const query = `
        query CuratorPortfolio {
          curator(id: "${address.toLowerCase()}") {
            id
            totalSignalledTokens
            totalUnsignalledTokens
            totalNameSignalledTokens
            totalNameUnsignalledTokens
            totalWithdrawnTokens
            realizedRewards
            signalCount
            activeSignalCount
            signals(first: 100, orderBy: signalledTokens, orderDirection: desc) {
              id
              signalledTokens
              unsignalledTokens
              signal
              lastSignalChange
              realizedRewards
              subgraphDeployment {
                id
                ipfsHash
                signalledTokens
                queryFeesAmount
                stakedTokens
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
      return json.data?.curator ?? null;
    },
    staleTime: 60 * 1000,
  });
}

interface SignalWithMetrics extends Signal {
  signalledGRT: number;
  realizedGRT: number;
  queryFees: number;
  stakedTokensGRT: number;
  queryFeeToSignalRatio: number;
  activeIndexers: number;
  signalStakeRatio: number;
}

function computeSignalMetrics(signal: Signal): SignalWithMetrics {
  const signalledGRT = weiToGRT(signal.signalledTokens);
  const realizedGRT = weiToGRT(signal.realizedRewards);
  const queryFees = weiToGRT(signal.subgraphDeployment.queryFeesAmount);
  const stakedTokensGRT = weiToGRT(signal.subgraphDeployment.stakedTokens);
  const deploymentSignal = weiToGRT(signal.subgraphDeployment.signalledTokens);

  // Query fees to signal ratio - higher means the signal is earning well relative to what's signalled
  const queryFeeToSignalRatio = signalledGRT > 0 ? queryFees / signalledGRT : 0;

  // Signal to stake ratio on the deployment
  const signalStakeRatio = stakedTokensGRT > 0 ? deploymentSignal / stakedTokensGRT : 0;

  // Rough proxy for active indexers: stake > 0 suggests indexers are allocated
  // We don't have indexer count directly, so we use a heuristic based on stake magnitude
  const activeIndexers = stakedTokensGRT > 0 ? Math.max(1, Math.round(stakedTokensGRT / 100000)) : 0;

  return {
    ...signal,
    signalledGRT,
    realizedGRT,
    queryFees,
    stakedTokensGRT,
    queryFeeToSignalRatio,
    activeIndexers,
    signalStakeRatio,
  };
}

export default function CuratorProfilePage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = use(params);
  const { data: curator, isLoading } = useCuratorPortfolio(address);

  const { totalSignalled, totalRealized, activeCount, signalMetrics, opportunities } = useMemo(() => {
    if (!curator) {
      return { totalSignalled: 0, totalRealized: 0, activeCount: 0, signalMetrics: [], opportunities: [] };
    }

    const metrics = curator.signals.map(computeSignalMetrics);
    const totalSig = weiToGRT(curator.totalSignalledTokens);
    const totalReal = weiToGRT(curator.realizedRewards);
    const totalReturn = totalSig > 0 ? ((totalReal / totalSig) * 100) : 0;

    // Sort by query-fee-to-signal ratio descending for opportunities
    const sorted = [...metrics].sort((a, b) => b.queryFeeToSignalRatio - a.queryFeeToSignalRatio);

    return {
      totalSignalled: totalSig,
      totalRealized: totalReal,
      totalReturn,
      activeCount: curator.activeSignalCount,
      signalMetrics: metrics,
      opportunities: sorted,
    };
  }, [curator]);

  const totalReturn = useMemo(() => {
    if (!curator) return 0;
    const totalSig = weiToGRT(curator.totalSignalledTokens);
    const totalReal = weiToGRT(curator.realizedRewards);
    return totalSig > 0 ? ((totalReal / totalSig) * 100) : 0;
  }, [curator]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!curator) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
        <div className="w-16 h-16 rounded-full bg-[var(--bg-elevated)] flex items-center justify-center mb-4">
          <svg className="w-8 h-8 text-[var(--text-faint)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-[var(--text)] mb-2">Curator Not Found</h2>
        <p className="text-[var(--text-muted)] max-w-md">
          No curation data found for address <span className="font-mono">{shortenAddress(address)}</span>.
          The address may not have any signal positions.
        </p>
        <a
          href="/curators"
          className="mt-6 px-4 py-2 text-sm font-medium rounded-[var(--radius-button)] bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
        >
          Try Another Address
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header badges */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--text-muted)] font-mono">{shortenAddress(address)}</p>
        <div className="flex items-center gap-2">
          <Badge variant="warning">Curator</Badge>
          <Badge variant="default">{curator.activeSignalCount} active</Badge>
        </div>
      </div>

      {/* Stat cards */}
      <StatGrid>
        <StatCard
          label="Total Signalled"
          value={`${formatGRT(totalSignalled)} GRT`}
        />
        <StatCard
          label="Total Return"
          value={`${totalReturn.toFixed(2)}%`}
          delta={{
            value: `${formatGRT(totalRealized)} GRT realized`,
            positive: totalReturn > 0,
          }}
        />
        <StatCard
          label="Realized Rewards"
          value={`${formatGRT(totalRealized)} GRT`}
        />
        <StatCard
          label="Active Signals"
          value={`${activeCount}`}
          delta={{
            value: `${curator.signalCount} total`,
            positive: true,
          }}
        />
      </StatGrid>

      {/* Signal positions table */}
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
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="text-left text-[11px] uppercase tracking-[0.06em] text-[var(--text-muted)] pb-3 pr-4">Subgraph</th>
                  <th className="text-right text-[11px] uppercase tracking-[0.06em] text-[var(--text-muted)] pb-3 px-4">Signalled</th>
                  <th className="text-right text-[11px] uppercase tracking-[0.06em] text-[var(--text-muted)] pb-3 px-4">Realized Rewards</th>
                  <th className="text-right text-[11px] uppercase tracking-[0.06em] text-[var(--text-muted)] pb-3 px-4">Query Fees</th>
                  <th className="text-right text-[11px] uppercase tracking-[0.06em] text-[var(--text-muted)] pb-3 px-4">Active Indexers</th>
                  <th className="text-right text-[11px] uppercase tracking-[0.06em] text-[var(--text-muted)] pb-3 pl-4">Signal/Stake</th>
                </tr>
              </thead>
              <tbody>
                {signalMetrics.map((signal) => (
                  <tr
                    key={signal.id}
                    className="border-b border-[var(--border-mid)] last:border-b-0 hover:bg-[var(--bg-elevated)] transition-colors"
                  >
                    <td className="py-3 pr-4">
                      <p className="text-sm font-mono text-[var(--text)]">
                        {shortenAddress(signal.subgraphDeployment.ipfsHash, 6)}
                      </p>
                    </td>
                    <td className="text-right py-3 px-4">
                      <p className="text-sm font-mono text-[var(--text)]">{formatGRT(signal.signalledGRT)} GRT</p>
                    </td>
                    <td className="text-right py-3 px-4">
                      <p className="text-sm font-mono text-[var(--green)]">+{formatGRT(signal.realizedGRT)} GRT</p>
                    </td>
                    <td className="text-right py-3 px-4">
                      <p className="text-sm font-mono text-[var(--text)]">{formatGRT(signal.queryFees)} GRT</p>
                    </td>
                    <td className="text-right py-3 px-4">
                      <p className="text-sm font-mono text-[var(--text)]">{signal.activeIndexers}</p>
                    </td>
                    <td className="text-right py-3 pl-4">
                      <p className="text-sm font-mono text-[var(--text)]">{signal.signalStakeRatio.toFixed(4)}</p>
                    </td>
                  </tr>
                ))}
                {signalMetrics.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-[var(--text-muted)]">
                      No signal positions found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Signal opportunities */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Signal Performance</CardTitle>
            <span className="text-sm text-[var(--text-muted)]">
              Ranked by query-fees-to-signal ratio
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {opportunities.map((signal, idx) => {
              const isHighPerforming = signal.queryFeeToSignalRatio > 1.0;
              return (
                <div
                  key={signal.id}
                  className={cn(
                    'flex items-center justify-between p-4 rounded-lg transition-colors',
                    isHighPerforming
                      ? 'bg-[var(--green-dim)] border-[0.5px] border-[var(--green)]'
                      : 'bg-[var(--bg-elevated)]'
                  )}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono text-[var(--text-faint)] w-6">#{idx + 1}</span>
                    <div>
                      <p className="text-sm font-mono text-[var(--text)]">
                        {shortenAddress(signal.subgraphDeployment.ipfsHash, 6)}
                      </p>
                      <p className="text-xs text-[var(--text-faint)]">
                        {formatGRT(signal.signalledGRT)} GRT signalled
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-xs text-[var(--text-faint)]">Query Fees / Signal</p>
                      <p className={cn(
                        'text-sm font-mono font-medium',
                        isHighPerforming ? 'text-[var(--green)]' : 'text-[var(--text)]'
                      )}>
                        {signal.queryFeeToSignalRatio.toFixed(4)}
                      </p>
                    </div>
                    {isHighPerforming && (
                      <Badge variant="success">High</Badge>
                    )}
                  </div>
                </div>
              );
            })}
            {opportunities.length === 0 && (
              <div className="py-8 text-center text-[var(--text-muted)]">
                No signal positions to analyse.
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
