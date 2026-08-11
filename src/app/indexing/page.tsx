'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSubgraphDeployments } from '@/hooks/useNetworkStats';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { cn, weiToGRT, formatGRT, shortenAddress } from '@/lib/utils';
import type { ChainLagData } from '@/app/api/cron/refresh-chain-health/route';
import { formatStallDuration, type ChainLiveness } from '@/lib/chain-liveness';

// ---------------------------------------------------------------------------
// Types for subgraph name search
// ---------------------------------------------------------------------------

interface SubgraphSearchResult {
  id: string;
  metadata: { displayName: string; description: string | null } | null;
  currentVersion: {
    subgraphDeployment: {
      ipfsHash: string;
      signalledTokens: string;
      stakedTokens: string;
    };
  } | null;
}

// ---------------------------------------------------------------------------
// Chain name mapping — graph-node network IDs → human-readable labels
// ---------------------------------------------------------------------------

const CHAIN_LABELS: Record<string, string> = {
  mainnet: 'Ethereum',
  'arbitrum-one': 'Arbitrum',
  'bsc': 'BSC',
  matic: 'Polygon',
  gnosis: 'Gnosis',
  avalanche: 'Avalanche',
  optimism: 'Optimism',
  base: 'Base',
  celo: 'Celo',
  fantom: 'Fantom',
  moonbeam: 'Moonbeam',
  moonriver: 'Moonriver',
  'arbitrum-goerli': 'Arb Goerli',
  'matic-testnet': 'Mumbai',
  'goerli': 'Goerli',
  'sepolia': 'Sepolia',
};

function chainLabel(network: string): string {
  return CHAIN_LABELS[network] ?? network;
}

// ---------------------------------------------------------------------------
// Chain health hook
// ---------------------------------------------------------------------------

function useChainLag() {
  const [data, setData] = useState<ChainLagData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/chain-lag')
      .then((r) => r.json())
      .then((json) => setData(json.data ?? null))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return { data, loading };
}

// ---------------------------------------------------------------------------
// Chain health panel
// ---------------------------------------------------------------------------

function ChainHealthPanel() {
  const { data, loading } = useChainLag();
  // Mount-stable "now" (ms) — keeps render pure (no Date.now() during render).
  const [nowMs] = useState(() => Date.now());

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Chain Sync Health</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-6">
            <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Chain Sync Health</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[var(--text-muted)] py-2">
            No chain data yet. The cron job populates this every 30 minutes.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Sort chains: dead heads first, then most-lagging, then by indexer count.
  // A chain that has stopped outranks any amount of lag, because lag is only
  // meaningful when the thing you are lagging behind is still moving.
  const livenessRank = (l: ChainLiveness) => (l === 'halted' ? 0 : l === 'stalled' ? 1 : 2);
  const sorted = Object.entries(data.chains).sort((a, b) => {
    const liveDiff = livenessRank(a[1].liveness) - livenessRank(b[1].liveness);
    if (liveDiff !== 0) return liveDiff;
    const lagDiff = b[1].medianBlocksBehind - a[1].medianBlocksBehind;
    if (lagDiff !== 0) return lagDiff;
    return b[1].sampledIndexers - a[1].sampledIndexers;
  });

  const age = Math.round((nowMs - data.computedAt) / 60_000);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Chain Sync Health</CardTitle>
          <span className="text-[10px] text-[var(--text-faint)]">
            updated {age < 2 ? 'just now' : `${age}m ago`}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-[var(--text-muted)] mb-4">
          Median blocks behind across active indexers per chain. Red chains may indicate a node-side infrastructure issue.
          A chain whose head has stopped advancing is shown as frozen rather than caught up: every indexer sits exactly at a
          head that no longer moves, so blocks-behind reads zero and means nothing.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {sorted.map(([network, stats]) => {
            const lag = Math.round(stats.medianBlocksBehind);
            // A frozen head outranks lag entirely: "0 blocks behind" on a dead
            // chain is the failure this whole panel used to render as a tick.
            const halted = stats.liveness === 'halted';
            const stalled = stats.liveness === 'stalled';
            const isRed = halted || lag > 50;
            const isAmber = !isRed && (stalled || lag > 5);
            const laggingPct = stats.sampledIndexers > 0
              ? Math.round((stats.laggingCount / stats.sampledIndexers) * 100)
              : 0;

            return (
              <div
                key={network}
                className={cn(
                  'flex flex-col gap-1 px-3 py-2.5 rounded-lg border',
                  isRed
                    ? 'border-red-500/30 bg-red-500/5'
                    : isAmber
                    ? 'border-amber-500/30 bg-amber-500/5'
                    : 'border-[var(--border)] bg-[var(--bg-elevated)]',
                )}
                title={
                  halted || stalled
                    ? `Head stuck at block ${stats.observedHead?.toLocaleString() ?? '?'} for ${formatStallDuration(stats.headStalledForMs)}. Either the chain has stopped or every indexer we sample has.`
                    : undefined
                }
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-medium text-[var(--text)] truncate">
                    {chainLabel(network)}
                  </span>
                  <span
                    className={cn(
                      'text-[10px] font-mono font-semibold flex-shrink-0',
                      isRed ? 'text-red-400' : isAmber ? 'text-amber-400' : 'text-emerald-400',
                    )}
                  >
                    {halted || stalled
                      ? `frozen ${formatStallDuration(stats.headStalledForMs)}`
                      : lag === 0
                      ? '✓'
                      : `${lag.toLocaleString()}b`}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-[var(--text-faint)]">
                    {stats.sampledIndexers} indexers
                  </span>
                  {halted || stalled ? (
                    <span className="text-[10px] text-[var(--text-faint)]">
                      head {stats.observedHead?.toLocaleString() ?? '?'}
                    </span>
                  ) : stats.laggingCount > 0 ? (
                    <span className="text-[10px] text-[var(--text-faint)]">
                      {laggingPct}% lagging
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Search hook — queries the network subgraph for subgraphs by name
// ---------------------------------------------------------------------------

function useSubgraphSearch(query: string) {
  const [results, setResults] = useState<SubgraphSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = query.trim();
    if (trimmed.length < 2 || trimmed.startsWith('Qm') || trimmed.startsWith('bafy')) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- debounced async search — intentional
      setResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/subgraph-search?q=${encodeURIComponent(trimmed)}`);
        if (!res.ok) { setResults([]); return; }
        const json = await res.json();
        setResults(json.data ?? []);
      } catch {
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  return { results, isSearching };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function IndexingStatusPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const { results: searchResults, isSearching } = useSubgraphSearch(search);
  const { data: deployments, isLoading } = useSubgraphDeployments({
    first: 20,
    orderBy: 'stakedTokens',
    orderDirection: 'desc',
  });

  const isHash = search.trim().startsWith('Qm') || search.trim().startsWith('bafy');

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const value = search.trim();
      if (!value) return;
      if (isHash) {
        router.push(`/subgraphs/${encodeURIComponent(value)}`);
      }
    },
    [search, isHash, router],
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold text-[var(--text)] mb-1">
          Indexing Status
        </h1>
        <p className="text-sm text-[var(--text-muted)]">
          Check the sync health of any subgraph deployment across active indexers.
        </p>
      </div>

      {/* Chain sync health panel */}
      <ChainHealthPanel />

      {/* Search / Lookup */}
      <Card>
        <CardHeader>
          <CardTitle>Find a Subgraph</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex gap-3">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or paste IPFS hash (Qm... / bafy...)"
              className={cn(
                'flex-1 px-4 py-2.5 text-sm text-[var(--text)]',
                'placeholder-[var(--text-faint)] bg-[var(--bg-elevated)]',
                'border border-[var(--border)] rounded-[var(--radius-button)]',
                'outline-none focus:ring-1 focus:ring-[var(--accent)] focus:border-[var(--accent)]',
                'transition-shadow',
                isHash && 'font-mono',
              )}
            />
            {isHash && (
              <button
                type="submit"
                disabled={!search.trim()}
                className={cn(
                  'px-5 py-2.5 text-sm font-medium rounded-[var(--radius-button)]',
                  'bg-[var(--accent)] text-white',
                  'hover:bg-[var(--accent-hover)] transition-colors',
                  'disabled:opacity-40 disabled:cursor-not-allowed',
                )}
              >
                Check Status
              </button>
            )}
          </form>

          {/* Search results */}
          {!isHash && search.trim().length >= 2 && (
            <div className="mt-3">
              {isSearching ? (
                <div className="flex items-center gap-2 py-3 px-1">
                  <div className="w-4 h-4 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs text-[var(--text-muted)]">Searching...</span>
                </div>
              ) : searchResults.length > 0 ? (
                <div className="space-y-1">
                  {searchResults.map((sg) => {
                    const dep = sg.currentVersion?.subgraphDeployment;
                    if (!dep) return null;
                    return (
                      <Link
                        key={sg.id}
                        href={`/subgraphs/${dep.ipfsHash}`}
                        className={cn(
                          'flex items-center justify-between px-3 py-2.5 rounded-lg',
                          'hover:bg-[var(--bg-elevated)] transition-colors group',
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-[var(--text)] group-hover:text-[var(--accent-text)] transition-colors">
                            {sg.metadata?.displayName ?? 'Unnamed'}
                          </p>
                          <p className="text-[10px] text-[var(--text-faint)] font-mono truncate">
                            {shortenAddress(dep.ipfsHash, 12)}
                          </p>
                        </div>
                        <div className="text-right flex-shrink-0 ml-4">
                          <p className="text-sm font-mono text-[var(--text)]">
                            {formatGRT(weiToGRT(dep.stakedTokens))}
                          </p>
                          <p className="text-[10px] text-[var(--text-faint)]">staked</p>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-[var(--text-faint)] py-2 px-1">
                  No subgraphs found matching &ldquo;{search.trim()}&rdquo;
                </p>
              )}
            </div>
          )}

          <p className="mt-2 text-xs text-[var(--text-faint)]">
            Queries each indexer&apos;s /status endpoint to show real-time sync progress, health, and errors.
          </p>
        </CardContent>
      </Card>

      {/* Top deployments by stake */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Top Deployments by Stake</CardTitle>
            <Badge variant="default">Quick access</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="space-y-1">
              {deployments?.map((dep) => (
                <Link
                  key={dep.id}
                  href={`/subgraphs/${dep.ipfsHash}`}
                  className={cn(
                    'flex items-center justify-between px-3 py-2.5 rounded-lg',
                    'hover:bg-[var(--bg-elevated)] transition-colors group',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-mono text-[var(--text)] group-hover:text-[var(--accent-text)] truncate transition-colors">
                      {shortenAddress(dep.ipfsHash, 12)}
                    </p>
                    <div className="flex gap-3 mt-0.5">
                      <span className="text-[10px] text-[var(--text-faint)]">
                        {dep.indexerAllocations.length} allocations
                      </span>
                      <span className="text-[10px] text-[var(--text-faint)]">
                        {dep.curatorSignals.length} curators
                      </span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0 ml-4">
                    <p className="text-sm font-mono text-[var(--text)]">
                      {formatGRT(weiToGRT(dep.stakedTokens))}
                    </p>
                    <p className="text-[10px] text-[var(--text-faint)]">staked</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
