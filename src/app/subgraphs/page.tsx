'use client';

import { useState, useMemo, useEffect, useRef, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { ChartSkeleton } from '@/components/ui/ChartSkeleton';
import { Badge } from '@/components/ui/Badge';
import { Pagination } from '@/components/ui/Pagination';
import { useSubgraphDeployments, useSubgraphDeployments30d, useManifestAnalysis } from '@/hooks/useNetworkStats';
import { weiToGRT, formatGRT, cn } from '@/lib/utils';
import type { ComplexityCategory } from '@/lib/manifest';

// ---------- constants ----------

const PAGE_SIZE = 25;

// Elite subgraph threshold: cumulative query fees above this are "Elite"
const ELITE_FEE_THRESHOLD_GRT = 1000;

// Map front-end sort keys to GraphQL field names
// NB: 'created' maps to the SubgraphDeployment.createdAt timestamp — the entity has no
// updatedAt, so only "Recently Created" is offered (not "Recently Updated").
const SORT_KEY_MAP: Record<string, string> = {
  signal: 'signalledTokens',
  stake: 'stakedTokens',
  queryFees: 'queryFeesAmount',
  created: 'createdAt',
};

type SortKey = 'signal' | 'stake' | 'queryFees' | 'created';

// ---------- per-row cells ----------

const CATEGORY_VARIANT: Record<ComplexityCategory, 'success' | 'default' | 'warning' | 'error'> = {
  Light: 'success',
  Moderate: 'default',
  Heavy: 'warning',
  Extreme: 'error',
};

function ComplexityCell({ hash, onComplexity }: { hash: string; onComplexity?: (hash: string, category: ComplexityCategory) => void }) {
  const { data, isLoading, isError } = useManifestAnalysis(hash);

  useEffect(() => {
    if (data?.category && onComplexity) onComplexity(hash, data.category);
  }, [hash, data?.category, onComplexity]);

  if (isLoading) return <div className="h-5 w-16 shimmer rounded" />;
  if (isError || !data) return <span className="text-[var(--text-faint)]">--</span>;

  return (
    <Badge variant={CATEGORY_VARIANT[data.category]}>
      {data.category}
    </Badge>
  );
}

function NetworkCell({ hash, onNetwork }: { hash: string; onNetwork?: (hash: string, network: string) => void }) {
  const { data, isLoading, isError } = useManifestAnalysis(hash);

  useEffect(() => {
    if (data?.network && onNetwork) onNetwork(hash, data.network);
  }, [hash, data?.network, onNetwork]);

  if (isLoading) return <div className="h-5 w-16 shimmer rounded" />;
  if (isError || !data) return <span className="text-[var(--text-faint)]">--</span>;

  if (!data.network) return <span className="text-[var(--text-faint)]">--</span>;

  const displayName = data.network;

  return (
    <Badge variant="accent" className="inline-flex items-center gap-1 whitespace-nowrap">
      <span className="truncate max-w-[80px]">{displayName}</span>
    </Badge>
  );
}

// ---------- component ----------

interface SearchResult {
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

export default function SubgraphDirectoryPage() {
  return (
    <Suspense fallback={<ChartSkeleton height="300px" />}>
      <SubgraphDirectory />
    </Suspense>
  );
}

function SubgraphDirectory() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Initialise state from URL search params (or defaults)
  const [page, setPage] = useState(() => Number(searchParams.get('page')) || 0);
  const [sortKey, setSortKey] = useState<SortKey>(() => {
    const v = searchParams.get('sort');
    return (v === 'signal' || v === 'stake' || v === 'queryFees' || v === 'created') ? v : 'queryFees';
  });
  const [sortDesc, setSortDesc] = useState(() => searchParams.get('dir') !== 'asc');
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('q') ?? '');
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [feeWindow, setFeeWindow] = useState<'allTime' | '30d'>(() =>
    searchParams.get('window') === 'allTime' ? 'allTime' : '30d'
  );
  const [eliteOnly, setEliteOnly] = useState(() => searchParams.get('elite') === '1');
  const [networkFilter, setNetworkFilter] = useState<string>(() => searchParams.get('network') ?? 'all');
  const [complexityFilter, setComplexityFilter] = useState<string>(() => searchParams.get('complexity') ?? 'all');
  const [categoryFilter, setCategoryFilter] = useState<string>(() => searchParams.get('category') ?? 'all');
  const [knownNetworks, setKnownNetworks] = useState<Set<string>>(new Set());
  const [rowNetworks, setRowNetworks] = useState<Record<string, string>>({});
  const [knownComplexities, setKnownComplexities] = useState<Set<string>>(new Set());
  const [rowComplexities, setRowComplexities] = useState<Record<string, string>>({});
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [selectedHashes, setSelectedHashes] = useState<Set<string>>(new Set());
  const toggleSelection = useCallback((hash: string) => {
    setSelectedHashes((prev) => {
      const next = new Set(prev);
      if (next.has(hash)) next.delete(hash);
      else next.add(hash);
      return next;
    });
  }, []);

  // Sync filter state → URL search params
  useEffect(() => {
    const params = new URLSearchParams();
    if (page > 0) params.set('page', String(page));
    if (sortKey !== 'queryFees') params.set('sort', sortKey);
    if (!sortDesc) params.set('dir', 'asc');
    if (searchQuery) params.set('q', searchQuery);
    if (feeWindow !== '30d') params.set('window', feeWindow);
    if (eliteOnly) params.set('elite', '1');
    if (networkFilter !== 'all') params.set('network', networkFilter);
    if (complexityFilter !== 'all') params.set('complexity', complexityFilter);
    if (categoryFilter !== 'all') params.set('category', categoryFilter);
    const qs = params.toString();
    const target = qs ? `/subgraphs?${qs}` : '/subgraphs';
    router.replace(target, { scroll: false });
  }, [page, sortKey, sortDesc, searchQuery, feeWindow, eliteOnly, networkFilter, complexityFilter, categoryFilter, router]);

  const handleNetwork = useCallback((hash: string, network: string) => {
    setKnownNetworks((prev) => {
      if (prev.has(network)) return prev;
      return new Set([...prev, network]);
    });
    setRowNetworks((prev) => {
      if (prev[hash] === network) return prev;
      return { ...prev, [hash]: network };
    });
  }, []);

  const handleComplexity = useCallback((hash: string, category: ComplexityCategory) => {
    setKnownComplexities((prev) => {
      if (prev.has(category)) return prev;
      return new Set([...prev, category]);
    });
    setRowComplexities((prev) => {
      if (prev[hash] === category) return prev;
      return { ...prev, [hash]: category };
    });
  }, []);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!searchQuery || searchQuery.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- debounced async search — intentional
      setSearchResults(null);
      return;
    }

    setSearchLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/subgraph-search?q=${encodeURIComponent(searchQuery)}`);
        const json = await res.json();
        setSearchResults(json.data ?? []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchQuery]);

  // --- All-time mode: server-side sort + pagination ---
  const queryParams = useMemo(() => ({
    first: PAGE_SIZE,
    skip: page * PAGE_SIZE,
    orderBy: SORT_KEY_MAP[sortKey],
    orderDirection: (sortDesc ? 'desc' : 'asc') as 'asc' | 'desc',
  }), [page, sortKey, sortDesc]);

  const is30d = feeWindow === '30d';
  const { data: raw, isLoading: loadingAllTime, isError: errorAllTime } = useSubgraphDeployments(queryParams);
  const { data: raw30d, isLoading: loading30d, isError: error30d } = useSubgraphDeployments30d(is30d);

  const isLoading = is30d ? loading30d : loadingAllTime;
  const isError = is30d ? error30d : errorAllTime;

  const allRows = useMemo(() => {
    if (is30d) {
      if (!raw30d) return [];
      // Client-side sort + pagination for 30d mode
      const mapped = raw30d.map((d) => {
        const signal = weiToGRT(d.signalledTokens);
        const stake = weiToGRT(d.stakedTokens);
        const queryFees = weiToGRT(d.queryFees30d);
        const queryFeesAllTime = weiToGRT(d.queryFeesAmount);
        return {
          id: d.id,
          ipfsHash: d.ipfsHash,
          displayName: d.displayName ?? null,
          categories: d.categories ?? [],
          createdAt: d.createdAt,
          signal,
          stake,
          queryFees,
          queryFeesAllTime,
          isElite: queryFeesAllTime >= ELITE_FEE_THRESHOLD_GRT,
          indexerCount: d.indexerAllocations.length,
          curatorCount: d.curatorSignals.length,
          signalStakeRatio: stake > 0 ? signal / stake : 0,
        };
      });
      // Sort client-side
      const sortFn = (a: typeof mapped[0], b: typeof mapped[0]) => {
        const field =
          sortKey === 'signal' ? 'signal'
          : sortKey === 'stake' ? 'stake'
          : sortKey === 'created' ? 'createdAt'
          : 'queryFees';
        const diff = a[field] - b[field];
        return sortDesc ? -diff : diff;
      };
      mapped.sort(sortFn);
      return mapped;
    }

    if (!raw) return [];
    return raw.map((d) => {
      const signal = weiToGRT(d.signalledTokens);
      const stake = weiToGRT(d.stakedTokens);
      const queryFees = weiToGRT(d.queryFeesAmount);
      return {
        id: d.id,
        ipfsHash: d.ipfsHash,
        displayName: d.displayName ?? null,
        categories: d.categories ?? [],
        createdAt: d.createdAt,
        signal,
        stake,
        queryFees,
        queryFeesAllTime: queryFees,
        isElite: queryFees >= ELITE_FEE_THRESHOLD_GRT,
        indexerCount: d.indexerAllocations.length,
        curatorCount: d.curatorSignals.length,
        signalStakeRatio: stake > 0 ? signal / stake : 0,
      };
    });
  }, [raw, raw30d, is30d, sortKey, sortDesc]);

  const rows = useMemo(() => {
    let filtered = allRows;
    if (eliteOnly) filtered = filtered.filter((r) => r.isElite);
    if (networkFilter !== 'all') filtered = filtered.filter((r) => !rowNetworks[r.ipfsHash] || rowNetworks[r.ipfsHash] === networkFilter);
    if (complexityFilter !== 'all') filtered = filtered.filter((r) => !rowComplexities[r.ipfsHash] || rowComplexities[r.ipfsHash] === complexityFilter);
    if (categoryFilter !== 'all') filtered = filtered.filter((r) => r.categories.includes(categoryFilter));
    // In 30d mode, paginate client-side
    if (is30d) {
      return filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    }
    return filtered;
  }, [allRows, eliteOnly, networkFilter, rowNetworks, complexityFilter, rowComplexities, categoryFilter, is30d, page]);

  // Categories discovered across the loaded rows (for the filter dropdown)
  const knownCategories = useMemo(() => {
    const s = new Set<string>();
    for (const r of allRows) for (const c of r.categories) if (c) s.add(c);
    return s;
  }, [allRows]);

  // Selection aggregates (across all loaded rows, not just current page)
  const selectedRows = useMemo(
    () => allRows.filter((r) => selectedHashes.has(r.ipfsHash)),
    [allRows, selectedHashes],
  );
  const selectionFees = selectedRows.reduce((s, r) => s + r.queryFees, 0);
  const selectionSignal = selectedRows.reduce((s, r) => s + r.signal, 0);
  const selectionStake = selectedRows.reduce((s, r) => s + r.stake, 0);

  // Total count for pagination
  const filteredTotal = useMemo(() => {
    if (is30d) {
      let filtered = allRows;
      if (eliteOnly) filtered = filtered.filter((r) => r.isElite);
      if (networkFilter !== 'all') filtered = filtered.filter((r) => !rowNetworks[r.ipfsHash] || rowNetworks[r.ipfsHash] === networkFilter);
      if (complexityFilter !== 'all') filtered = filtered.filter((r) => !rowComplexities[r.ipfsHash] || rowComplexities[r.ipfsHash] === complexityFilter);
      if (categoryFilter !== 'all') filtered = filtered.filter((r) => r.categories.includes(categoryFilter));
      return filtered.length;
    }
    return undefined; // use estimate for all-time
  }, [allRows, is30d, eliteOnly, networkFilter, rowNetworks, complexityFilter, rowComplexities, categoryFilter]);

  // For all-time mode: estimate total since we don't have count from the subgraph
  const hasFullPage = !is30d && allRows.length === PAGE_SIZE;
  const estimatedTotal = filteredTotal ?? (hasFullPage ? (page + 2) * PAGE_SIZE : page * PAGE_SIZE + allRows.length);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDesc(!sortDesc);
    } else {
      setSortKey(key);
      setSortDesc(true);
    }
    setPage(0);
  };

  const thBase =
    'px-4 py-3 text-[11px] font-medium text-[var(--text-muted)] select-none border-r border-[var(--border)]/20 last:border-r-0';
  const thSortable = cn(thBase, 'cursor-pointer hover:text-[var(--text)] transition-colors');
  const tdBorder = 'border-r border-[var(--border)]/20 last:border-r-0';

  const renderSortArrow = (key: SortKey) =>
    sortKey === key ? (
      <span className="text-[var(--accent-text)] ml-1">{sortDesc ? '\u2193' : '\u2191'}</span>
    ) : null;

  if (isLoading && page === 0) {
    // Reserves roughly what a full page of results occupies (PAGE_SIZE rows at
    // ~67px, plus header and pagination). At the old 300px the table grew by
    // ~1400px on load and shoved the whole footer down the page.
    return <ChartSkeleton height="1725px" />;
  }

  if (isError || (is30d ? !raw30d : !raw)) {
    return (
      <div className="text-center py-24">
        <h2 className="text-xl font-semibold text-[var(--text)] mb-2">Unable to Load Deployments</h2>
        <p className="text-[var(--text-muted)]">
          Could not fetch subgraph deployment data from the network subgraph.
        </p>
      </div>
    );
  }

  const isSearching = searchQuery.length >= 2;

  return (
    <div className="space-y-6">
      {/* Search bar */}
      <div>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by name, Qm hash, or contract address (0x…)"
          className={cn(
            'w-full px-4 py-3 text-sm rounded-[var(--radius-card)]',
            'bg-[var(--bg-surface)] border border-[var(--border)]',
            'text-[var(--text)] placeholder:text-[var(--text-faint)]',
            'focus:outline-none focus:border-[var(--accent)]',
          )}
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Fee window toggle */}
        <div className="inline-flex rounded-[var(--radius-button)] border border-[var(--border)] overflow-hidden">
          <button
            onClick={() => { setFeeWindow('30d'); setPage(0); }}
            className={cn(
              'px-3 py-1.5 text-xs font-medium transition-colors',
              is30d
                ? 'bg-[var(--accent)] text-white'
                : 'bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text)]'
            )}
          >
            30 Day Fees
          </button>
          <button
            onClick={() => { setFeeWindow('allTime'); setPage(0); }}
            className={cn(
              'px-3 py-1.5 text-xs font-medium transition-colors',
              !is30d
                ? 'bg-[var(--accent)] text-white'
                : 'bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text)]'
            )}
          >
            All Time
          </button>
        </div>
        <button
          onClick={() => setEliteOnly(!eliteOnly)}
          className={cn(
            'px-3 py-1.5 text-xs font-medium rounded-[var(--radius-button)] border transition-colors',
            eliteOnly
              ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
              : 'bg-[var(--bg-surface)] text-[var(--text-muted)] border-[var(--border)] hover:border-[var(--accent)]'
          )}
        >
          Elite Only ({'>'}1K GRT fees)
        </button>
        {knownComplexities.size > 0 && (
          <select
            aria-label="Filter by complexity"
            value={complexityFilter}
            onChange={(e) => setComplexityFilter(e.target.value)}
            className={cn(
              'px-3 py-1.5 text-xs rounded-[var(--radius-button)]',
              'bg-[var(--bg-surface)] border border-[var(--border)]',
              'text-[var(--text)]',
              'focus:outline-none focus:border-[var(--accent)]'
            )}
          >
            <option value="all">All Complexities</option>
            {(['Light', 'Moderate', 'Heavy', 'Extreme'] as const)
              .filter((c) => knownComplexities.has(c))
              .map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
          </select>
        )}
        {knownCategories.size > 0 && (
          <select
            aria-label="Filter by category"
            value={categoryFilter}
            onChange={(e) => { setCategoryFilter(e.target.value); setPage(0); }}
            className={cn(
              'px-3 py-1.5 text-xs rounded-[var(--radius-button)]',
              'bg-[var(--bg-surface)] border border-[var(--border)]',
              'text-[var(--text)]',
              'focus:outline-none focus:border-[var(--accent)]'
            )}
          >
            <option value="all">All Categories</option>
            {[...knownCategories].sort().map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        )}
        {knownNetworks.size > 0 && (
          <select
            aria-label="Filter by network"
            value={networkFilter}
            onChange={(e) => setNetworkFilter(e.target.value)}
            className={cn(
              'px-3 py-1.5 text-xs rounded-[var(--radius-button)]',
              'bg-[var(--bg-surface)] border border-[var(--border)]',
              'text-[var(--text)]',
              'focus:outline-none focus:border-[var(--accent)]'
            )}
          >
            <option value="all">All Networks</option>
            {/* The networks discovered on this page, by their manifest ids. The Pinax registry that used to
                append every mainnet and pretty-print the ids is gone (nuthatch#1160). */}
            {[...knownNetworks].sort().map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        )}
      </div>

      {/* Selection summary bar */}
      {selectedHashes.size > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2.5 bg-[var(--accent)]/10 border border-[var(--accent)]/30 rounded-[var(--radius-card)] text-sm">
          <span className="font-medium text-[var(--accent-text)]">{selectedHashes.size} selected</span>
          <span className="text-[var(--border-mid)]">·</span>
          <span className="text-[var(--text-muted)] font-mono">{formatGRT(selectionFees)} GRT {is30d ? '30d fees' : 'fees'}</span>
          <span className="text-[var(--border-mid)]">·</span>
          <span className="text-[var(--text-muted)] font-mono">{formatGRT(selectionSignal)} signal</span>
          <span className="text-[var(--border-mid)]">·</span>
          <span className="text-[var(--text-muted)] font-mono">{formatGRT(selectionStake)} stake</span>
          <button
            onClick={() => setSelectedHashes(new Set())}
            className="ml-auto text-xs text-[var(--text-faint)] hover:text-[var(--text)] transition-colors"
          >
            Clear
          </button>
        </div>
      )}

      {/* Search results */}
      {isSearching && (
        <Card className="overflow-hidden">
          {searchLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : searchResults && searchResults.length > 0 ? (
            <div className="divide-y divide-[var(--border)]">
              {searchResults.map((s) => {
                const dep = s.currentVersion?.subgraphDeployment;
                if (!dep) return null;
                const signal = weiToGRT(dep.signalledTokens);
                const stake = weiToGRT(dep.stakedTokens);
                return (
                  <Link
                    key={s.id}
                    href={`/subgraphs/${dep.ipfsHash}`}
                    className="flex items-center justify-between px-4 py-3 hover:bg-[var(--bg-elevated)] transition-colors"
                  >
                    <div>
                      <p className="text-sm font-medium text-[var(--text)]">
                        {s.metadata?.displayName || 'Unnamed'}
                      </p>
                      <p className="text-xs font-mono text-[var(--text-faint)]">
                        {dep.ipfsHash.slice(0, 12)}...{dep.ipfsHash.slice(-6)}
                      </p>
                    </div>
                    <div className="flex items-center gap-4 text-xs font-mono text-[var(--text-muted)]">
                      <span>{formatGRT(signal)} signal</span>
                      <span>{formatGRT(stake)} stake</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <p className="px-4 py-8 text-sm text-[var(--text-faint)] text-center">
              No subgraphs found for &ldquo;{searchQuery}&rdquo;
            </p>
          )}
        </Card>
      )}

      {/* Mobile cards */}
      <div className="block md:hidden space-y-3">
        {rows.map((row, idx) => {
          const highRatio = row.signalStakeRatio > 0.5;
          return (
            <Link key={row.id} href={`/subgraphs/${row.ipfsHash}`} className="block relative">
              <Card className={`transition-colors ${selectedHashes.has(row.ipfsHash) ? 'border-[var(--accent)]/50 bg-[var(--accent)]/5' : 'hover:border-[var(--accent-hover)]'}`}>
                <button
                  className={`absolute top-2.5 right-2.5 z-10 w-6 h-6 rounded border-2 flex items-center justify-center transition-colors ${
                    selectedHashes.has(row.ipfsHash)
                      ? 'border-[var(--accent)] bg-[var(--accent)]'
                      : 'border-[var(--border-mid)] bg-[var(--bg-surface)]'
                  }`}
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleSelection(row.ipfsHash); }}
                >
                  {selectedHashes.has(row.ipfsHash) && (
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 12 12">
                      <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0 mr-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-[var(--text-faint)]">#{page * PAGE_SIZE + idx + 1}</span>
                      {row.displayName ? (
                        <span className="text-sm font-medium text-[var(--text)] truncate" title={row.displayName}>
                          {row.displayName}
                        </span>
                      ) : (
                        <span className="font-mono text-sm text-[var(--text)]" title={row.ipfsHash}>
                          {row.ipfsHash.slice(0, 8)}...{row.ipfsHash.slice(-6)}
                        </span>
                      )}
                      {row.isElite && (
                        <span className="relative group/elite shrink-0">
                          <Badge
                            variant="warning"
                            className="cursor-pointer"
                            onClick={(e) => { e.preventDefault(); setEliteOnly(true); }}
                          >
                            Elite
                          </Badge>
                          <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 text-[10px] text-white bg-[var(--bg-elevated)] border border-[var(--border)] rounded whitespace-nowrap opacity-0 group-hover/elite:opacity-100 transition-opacity z-50">
                            Earned over 1,000 GRT in query fees
                          </span>
                        </span>
                      )}
                    </div>
                    {row.displayName && (
                      <p className="text-[10px] font-mono text-[var(--text-faint)] mt-0.5 ml-7">
                        {row.ipfsHash.slice(0, 8)}...{row.ipfsHash.slice(-6)}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <ComplexityCell hash={row.ipfsHash} onComplexity={handleComplexity} />
                    <NetworkCell hash={row.ipfsHash} onNetwork={handleNetwork} />
                    {row.indexerCount <= 1 && (
                      <span className="relative group/lowidx">
                        <Badge variant="warning" className="text-[10px] px-1.5">1 idx</Badge>
                        <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 text-[10px] text-white bg-[var(--bg-elevated)] border border-[var(--border)] rounded whitespace-nowrap opacity-0 group-hover/lowidx:opacity-100 transition-opacity z-50">
                          Only {row.indexerCount} active indexer, so it may be hard to sync
                        </span>
                      </span>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="p-2 rounded bg-[var(--bg-elevated)]">
                    <p className="text-[10px] text-[var(--text-faint)]">Signal</p>
                    <p className="text-xs font-mono text-[var(--text)]">{formatGRT(row.signal)}</p>
                  </div>
                  <div className="p-2 rounded bg-[var(--bg-elevated)]">
                    <p className="text-[10px] text-[var(--text-faint)]">Stake</p>
                    <p className="text-xs font-mono text-[var(--text)]">{formatGRT(row.stake)}</p>
                  </div>
                  <div className="p-2 rounded bg-[var(--bg-elevated)]">
                    <p className="text-[10px] text-[var(--text-faint)]">Sig/Stake</p>
                    <p className={cn('text-xs font-mono', highRatio ? 'text-[var(--green)] font-semibold' : 'text-[var(--text)]')}>
                      {row.signalStakeRatio.toFixed(3)}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center mt-2">
                  <div className="p-2 rounded bg-[var(--bg-elevated)]">
                    <p className="text-[10px] text-[var(--text-faint)]">{is30d ? 'Fees 30d' : 'Fees'}</p>
                    <p className="text-xs font-mono text-[var(--text)]">{formatGRT(row.queryFees)}</p>
                  </div>
                  <div className="p-2 rounded bg-[var(--bg-elevated)]">
                    <p className="text-[10px] text-[var(--text-faint)]">Indexers</p>
                    <p className="text-xs font-mono text-[var(--text)]">{row.indexerCount}</p>
                  </div>
                  <div className="p-2 rounded bg-[var(--bg-elevated)]">
                    <p className="text-[10px] text-[var(--text-faint)]">Curators</p>
                    <p className="text-xs font-mono text-[var(--text)]">{row.curatorCount}</p>
                  </div>
                </div>
              </Card>
            </Link>
          );
        })}
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          totalItems={estimatedTotal}
          onPageChange={setPage}
        />
      </div>

      {/* Desktop table */}
      <Card className="overflow-hidden hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-[var(--bg-elevated)]">
              <tr>
                <th className={cn(thBase, 'w-10 text-center')}>
                  <input
                    aria-label="Select all subgraphs"
                    type="checkbox"
                    className="cursor-pointer accent-[var(--accent)]"
                    checked={rows.length > 0 && rows.every((r) => selectedHashes.has(r.ipfsHash))}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedHashes((prev) => new Set([...prev, ...rows.map((r) => r.ipfsHash)]));
                      } else {
                        setSelectedHashes((prev) => {
                          const next = new Set(prev);
                          rows.forEach((r) => next.delete(r.ipfsHash));
                          return next;
                        });
                      }
                    }}
                  />
                </th>
                <th className={cn(thBase, 'text-left w-12')}>#</th>
                <th className={cn(thBase, 'text-left')}>Deployment ID</th>
                <th className={cn(thBase, 'text-center')}>Complexity</th>
                <th className={cn(thBase, 'text-center')}>Network</th>
                <th className={cn(thSortable, 'text-right')} onClick={() => handleSort('signal')}>
                  Signal (GRT){renderSortArrow('signal')}
                </th>
                <th className={cn(thSortable, 'text-right')} onClick={() => handleSort('stake')}>
                  Stake (GRT){renderSortArrow('stake')}
                </th>
                <th className={cn(thSortable, 'text-right')} onClick={() => handleSort('queryFees')}>
                  {is30d ? 'Fees 30d (GRT)' : 'Query Fees (GRT)'}{renderSortArrow('queryFees')}
                </th>
                <th className={cn(thSortable, 'text-right')} onClick={() => handleSort('created')}>
                  Created{renderSortArrow('created')}
                </th>
                <th className={cn(thBase, 'text-right')}>Indexers</th>
                <th className={cn(thBase, 'text-right')}>Signal/Stake</th>
                <th className={cn(thBase, 'text-right')}>Curators</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                const highRatio = row.signalStakeRatio > 0.5;
                return (
                  <tr
                    key={row.id}
                    className={`border-b border-[0.5px] border-[var(--border)] transition-colors ${selectedHashes.has(row.ipfsHash) ? 'bg-[var(--accent)]/5' : 'hover:bg-[var(--bg-elevated)]'}`}
                  >
                    <td
                      className={`px-3 py-3 text-center ${tdBorder}`}
                      onClick={(e) => { e.stopPropagation(); toggleSelection(row.ipfsHash); }}
                    >
                      <input
                        aria-label="Select subgraph"
                        type="checkbox"
                        className="cursor-pointer accent-[var(--accent)]"
                        checked={selectedHashes.has(row.ipfsHash)}
                        onChange={() => {}}
                      />
                    </td>
                    <td className={`px-4 py-3 text-sm text-[var(--text-faint)] ${tdBorder}`}>{page * PAGE_SIZE + idx + 1}</td>
                    <td className={`px-4 py-3 ${tdBorder}`}>
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/subgraphs/${row.ipfsHash}`}
                          className="hover:text-[var(--accent-text)] transition-colors"
                          title={row.ipfsHash}
                        >
                          {row.displayName ? (
                            <div>
                              <span className="text-sm font-medium text-[var(--text)] block truncate max-w-[220px]">
                                {row.displayName}
                              </span>
                              <span className="text-[10px] font-mono text-[var(--text-faint)]">
                                {row.ipfsHash.slice(0, 8)}...{row.ipfsHash.slice(-6)}
                              </span>
                            </div>
                          ) : (
                            <span className="font-mono text-sm text-[var(--text)]">
                              {row.ipfsHash.slice(0, 8)}...{row.ipfsHash.slice(-6)}
                            </span>
                          )}
                        </Link>
                        {row.isElite && (
                      <span className="relative group/elite">
                        <Badge
                          variant="warning"
                          className="cursor-pointer"
                          onClick={(e) => { e.preventDefault(); setEliteOnly(true); }}
                        >
                          Elite
                        </Badge>
                        <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 text-[10px] text-white bg-[var(--bg-elevated)] border border-[var(--border)] rounded whitespace-nowrap opacity-0 group-hover/elite:opacity-100 transition-opacity z-50">
                          Earned over 1,000 GRT in query fees
                        </span>
                      </span>
                    )}
                      </div>
                    </td>
                    <td className={`px-4 py-3 text-center ${tdBorder}`}>
                      <ComplexityCell hash={row.ipfsHash} onComplexity={handleComplexity} />
                    </td>
                    <td className={`px-4 py-3 text-center ${tdBorder}`}>
                      <NetworkCell hash={row.ipfsHash} onNetwork={handleNetwork} />
                    </td>
                    <td className={`px-4 py-3 text-right font-mono text-sm text-[var(--text)] ${tdBorder}`}>
                      {formatGRT(row.signal)}
                    </td>
                    <td className={`px-4 py-3 text-right font-mono text-sm text-[var(--text)] ${tdBorder}`}>
                      {formatGRT(row.stake)}
                    </td>
                    <td className={`px-4 py-3 text-right font-mono text-sm text-[var(--text)] ${tdBorder}`}>
                      {formatGRT(row.queryFees)}
                    </td>
                    <td className={`px-4 py-3 text-right font-mono text-sm text-[var(--text-muted)] ${tdBorder}`}>
                      {row.createdAt ? new Date(row.createdAt * 1000).toLocaleDateString() : '--'}
                    </td>
                    <td className={`px-4 py-3 text-right font-mono text-sm text-[var(--text)] ${tdBorder}`}>
                      <span className="inline-flex items-center justify-end gap-1.5">
                        {row.indexerCount}
                        {row.indexerCount <= 1 && (
                          <span className="relative group/lowidx">
                            <span className="text-[var(--amber)] text-xs cursor-default">&#9888;</span>
                            <span className="pointer-events-none absolute bottom-full right-0 mb-1.5 px-2 py-1 text-[10px] text-white bg-[var(--bg-elevated)] border border-[var(--border)] rounded whitespace-nowrap opacity-0 group-hover/lowidx:opacity-100 transition-opacity z-50">
                              Only {row.indexerCount} active indexer, so it may be hard to sync
                            </span>
                          </span>
                        )}
                      </span>
                    </td>
                    <td
                      className={cn(
                        `px-4 py-3 text-right font-mono text-sm ${tdBorder}`,
                        highRatio ? 'text-[var(--green)] font-semibold' : 'text-[var(--text)]'
                      )}
                    >
                      {row.signalStakeRatio.toFixed(3)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm text-[var(--text)]">
                      {row.curatorCount}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          totalItems={estimatedTotal}
          onPageChange={setPage}
        />
      </Card>
    </div>
  );
}
