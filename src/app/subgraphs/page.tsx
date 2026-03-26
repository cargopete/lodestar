'use client';

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Pagination } from '@/components/ui/Pagination';
import { useSubgraphDeployments, useManifestAnalysis, useNetworksRegistry } from '@/hooks/useNetworkStats';
import { weiToGRT, formatGRT, cn } from '@/lib/utils';
import type { ComplexityCategory } from '@/lib/manifest';
import type { NetworkInfo } from '@/app/api/networks/route';

// ---------- constants ----------

const PAGE_SIZE = 25;

// Elite subgraph threshold: cumulative query fees above this are "Elite"
const ELITE_FEE_THRESHOLD_GRT = 1000;

// Map front-end sort keys to GraphQL field names
const SORT_KEY_MAP: Record<string, string> = {
  signal: 'signalledTokens',
  stake: 'stakedTokens',
  queryFees: 'queryFeesAmount',
};

type SortKey = 'signal' | 'stake' | 'queryFees';

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

function NetworkCell({ hash, onNetwork, networkMap }: { hash: string; onNetwork?: (hash: string, network: string) => void; networkMap: Map<string, NetworkInfo> }) {
  const { data, isLoading, isError } = useManifestAnalysis(hash);

  useEffect(() => {
    if (data?.network && onNetwork) onNetwork(hash, data.network);
  }, [hash, data?.network, onNetwork]);

  if (isLoading) return <div className="h-5 w-16 shimmer rounded" />;
  if (isError || !data) return <span className="text-[var(--text-faint)]">--</span>;

  if (!data.network) return <span className="text-[var(--text-faint)]">--</span>;

  const info = networkMap.get(data.network);
  const displayName = info?.shortName ?? data.network;
  const iconUrl = info?.iconUrl;

  return (
    <Badge variant="accent" className="inline-flex items-center gap-1.5">
      {iconUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={iconUrl} alt="" className="w-3.5 h-3.5 rounded-full" />
      )}
      {displayName}
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

export default function SubgraphDirectory() {
  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>('signal');
  const [sortDesc, setSortDesc] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [eliteOnly, setEliteOnly] = useState(false);
  const [networkFilter, setNetworkFilter] = useState<string>('all');
  const [complexityFilter, setComplexityFilter] = useState<string>('all');
  const [knownNetworks, setKnownNetworks] = useState<Set<string>>(new Set());
  const [rowNetworks, setRowNetworks] = useState<Record<string, string>>({});
  const [knownComplexities, setKnownComplexities] = useState<Set<string>>(new Set());
  const [rowComplexities, setRowComplexities] = useState<Record<string, string>>({});
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Networks registry for display names and icons
  const { data: registryData } = useNetworksRegistry();
  const networkMap = useMemo(() => {
    const map = new Map<string, NetworkInfo>();
    if (!registryData?.networks) return map;
    for (const n of registryData.networks) {
      map.set(n.id, n);
      // Also index by aliases so manifest network IDs like "xdai" resolve
      for (const alias of n.aliases) {
        if (!map.has(alias)) map.set(alias, n);
      }
    }
    return map;
  }, [registryData]);

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

  const queryParams = useMemo(() => ({
    first: PAGE_SIZE,
    skip: page * PAGE_SIZE,
    orderBy: SORT_KEY_MAP[sortKey],
    orderDirection: (sortDesc ? 'desc' : 'asc') as 'asc' | 'desc',
  }), [page, sortKey, sortDesc]);

  const { data: raw, isLoading, isError } = useSubgraphDeployments(queryParams);

  const allRows = useMemo(() => {
    if (!raw) return [];
    return raw.map((d) => {
      const signal = weiToGRT(d.signalledTokens);
      const stake = weiToGRT(d.stakedTokens);
      const queryFees = weiToGRT(d.queryFeesAmount);
      return {
        id: d.id,
        ipfsHash: d.ipfsHash,
        signal,
        stake,
        queryFees,
        isElite: queryFees >= ELITE_FEE_THRESHOLD_GRT,
        indexerCount: d.indexerAllocations.length,
        curatorCount: d.curatorSignals.length,
        signalStakeRatio: stake > 0 ? signal / stake : 0,
      };
    });
  }, [raw]);

  const rows = useMemo(() => {
    let filtered = allRows;
    if (eliteOnly) filtered = filtered.filter((r) => r.isElite);
    if (networkFilter !== 'all') filtered = filtered.filter((r) => rowNetworks[r.ipfsHash] === networkFilter);
    if (complexityFilter !== 'all') filtered = filtered.filter((r) => rowComplexities[r.ipfsHash] === complexityFilter);
    return filtered;
  }, [allRows, eliteOnly, networkFilter, rowNetworks, complexityFilter, rowComplexities]);

  // We don't know total count from the subgraph, so estimate:
  // if we got a full page, there's likely more
  const hasFullPage = allRows.length === PAGE_SIZE;
  // Use a high estimate so pagination works; will show fewer on last page
  const estimatedTotal = hasFullPage ? (page + 2) * PAGE_SIZE : page * PAGE_SIZE + allRows.length;

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
    'px-4 py-3 text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-[0.06em] select-none';
  const thSortable = cn(thBase, 'cursor-pointer hover:text-[var(--text)] transition-colors');

  const renderSortArrow = (key: SortKey) =>
    sortKey === key ? (
      <span className="text-[var(--accent)] ml-1">{sortDesc ? '\u2193' : '\u2191'}</span>
    ) : null;

  if (isLoading && page === 0) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (isError || !raw) {
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
          placeholder="Search by name or Qm hash..."
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
        {knownNetworks.size > 0 && (
          <select
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
            {[...knownNetworks].sort().map((n) => {
              const info = networkMap.get(n);
              return (
                <option key={n} value={n}>{info?.shortName ?? n}</option>
              );
            })}
          </select>
        )}
      </div>

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
            <Link key={row.id} href={`/subgraphs/${row.ipfsHash}`}>
              <Card className="hover:border-[var(--accent-hover)] transition-colors">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-[var(--text-faint)]">#{page * PAGE_SIZE + idx + 1}</span>
                    <span className="font-mono text-sm text-[var(--text)]" title={row.ipfsHash}>
                      {row.ipfsHash.slice(0, 8)}...{row.ipfsHash.slice(-6)}
                    </span>
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
                  <div className="flex items-center gap-1.5">
                    <ComplexityCell hash={row.ipfsHash} onComplexity={handleComplexity} />
                    <NetworkCell hash={row.ipfsHash} onNetwork={handleNetwork} networkMap={networkMap} />
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
                    <p className="text-[10px] text-[var(--text-faint)]">Fees</p>
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
                  Query Fees (GRT){renderSortArrow('queryFees')}
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
                    className="border-b border-[0.5px] border-[var(--border)] hover:bg-[var(--bg-elevated)] transition-colors"
                  >
                    <td className="px-4 py-3 text-sm text-[var(--text-faint)]">{page * PAGE_SIZE + idx + 1}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/subgraphs/${row.ipfsHash}`}
                          className="font-mono text-sm text-[var(--text)] hover:text-[var(--accent)] transition-colors"
                          title={row.ipfsHash}
                        >
                          {row.ipfsHash.slice(0, 8)}...{row.ipfsHash.slice(-6)}
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
                    <td className="px-4 py-3 text-center">
                      <ComplexityCell hash={row.ipfsHash} onComplexity={handleComplexity} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <NetworkCell hash={row.ipfsHash} onNetwork={handleNetwork} networkMap={networkMap} />
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm text-[var(--text)]">
                      {formatGRT(row.signal)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm text-[var(--text)]">
                      {formatGRT(row.stake)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm text-[var(--text)]">
                      {formatGRT(row.queryFees)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm text-[var(--text)]">
                      {row.indexerCount}
                    </td>
                    <td
                      className={cn(
                        'px-4 py-3 text-right font-mono text-sm',
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
