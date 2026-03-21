'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSubgraphDeployments } from '@/hooks/useNetworkStats';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { cn, weiToGRT, formatGRT, shortenAddress } from '@/lib/utils';

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
                          <p className="text-sm font-medium text-[var(--text)] group-hover:text-[var(--accent)] transition-colors">
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
                    <p className="text-sm font-mono text-[var(--text)] group-hover:text-[var(--accent)] truncate transition-colors">
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
