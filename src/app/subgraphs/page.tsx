'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Pagination } from '@/components/ui/Pagination';
import { useSubgraphDeployments, useManifestAnalysis } from '@/hooks/useNetworkStats';
import { weiToGRT, formatGRT, cn } from '@/lib/utils';
import type { ComplexityCategory } from '@/lib/manifest';

// ---------- constants ----------

const PAGE_SIZE = 25;

// Map front-end sort keys to GraphQL field names
const SORT_KEY_MAP: Record<string, string> = {
  signal: 'signalledTokens',
  stake: 'stakedTokens',
  queryFees: 'queryFeesAmount',
};

type SortKey = 'signal' | 'stake' | 'queryFees';

// ---------- complexity cell ----------

const CATEGORY_VARIANT: Record<ComplexityCategory, 'success' | 'default' | 'warning' | 'error'> = {
  Light: 'success',
  Moderate: 'default',
  Heavy: 'warning',
  Extreme: 'error',
};

function ComplexityCell({ hash }: { hash: string }) {
  const { data, isLoading, isError } = useManifestAnalysis(hash);

  if (isLoading) {
    return <div className="h-5 w-16 shimmer rounded" />;
  }

  if (isError || !data) {
    return <span className="text-[var(--text-faint)]">--</span>;
  }

  return (
    <Badge variant={CATEGORY_VARIANT[data.category]}>
      {data.category}
    </Badge>
  );
}

// ---------- component ----------

export default function SubgraphDirectory() {
  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>('signal');
  const [sortDesc, setSortDesc] = useState(true);

  const queryParams = useMemo(() => ({
    first: PAGE_SIZE,
    skip: page * PAGE_SIZE,
    orderBy: SORT_KEY_MAP[sortKey],
    orderDirection: (sortDesc ? 'desc' : 'asc') as 'asc' | 'desc',
  }), [page, sortKey, sortDesc]);

  const { data: raw, isLoading, isError } = useSubgraphDeployments(queryParams);

  const rows = useMemo(() => {
    if (!raw) return [];
    return raw.map((d) => {
      const signal = weiToGRT(d.signalledTokens);
      const stake = weiToGRT(d.stakedTokens);
      return {
        id: d.id,
        ipfsHash: d.ipfsHash,
        signal,
        stake,
        queryFees: weiToGRT(d.queryFeesAmount),
        indexerCount: d.indexerAllocations.length,
        curatorCount: d.curatorSignals.length,
        signalStakeRatio: stake > 0 ? signal / stake : 0,
      };
    });
  }, [raw]);

  // We don't know total count from the subgraph, so estimate:
  // if we got a full page, there's likely more
  const hasFullPage = rows.length === PAGE_SIZE;
  // Use a high estimate so pagination works; will show fewer on last page
  const estimatedTotal = hasFullPage ? (page + 2) * PAGE_SIZE : page * PAGE_SIZE + rows.length;

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

  return (
    <div className="space-y-6">
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
                  </div>
                  <ComplexityCell hash={row.ipfsHash} />
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
                      <Link
                        href={`/subgraphs/${row.ipfsHash}`}
                        className="font-mono text-sm text-[var(--text)] hover:text-[var(--accent)] transition-colors"
                        title={row.ipfsHash}
                      >
                        {row.ipfsHash.slice(0, 8)}...{row.ipfsHash.slice(-6)}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <ComplexityCell hash={row.ipfsHash} />
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
