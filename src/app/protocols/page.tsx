'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { PROTOCOLS, type ProtocolCategory, type ProtocolConfig } from '@/lib/protocols/config';
import { useProtocolsDirectory } from '@/hooks/useProtocols';
import type { ProtocolSummary } from '@/lib/protocols/fetcher';
import { formatUSD } from '@/lib/utils';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { ProtocolLogo, buildProtocolSources, buildNetworkSources } from '@/components/ProtocolLogo';

const CATEGORY_STYLES: Record<string, string> = {
  'DEX': 'bg-[var(--accent)]/10 text-[var(--accent)]',
  'Lending': 'bg-[var(--green)]/10 text-[var(--green)]',
  'Liquid Staking': 'bg-[#00A3FF]/12 text-[#5BC2FF]',
  'Yield Aggregator': 'bg-[#0657F9]/12 text-[#6E92FF]',
  'Prediction Markets': 'bg-[#A855F7]/12 text-[#C084FC]',
  'Bridge': 'bg-[#FFA94D]/12 text-[#FFB870]',
  'RWA': 'bg-[#FFCC55]/12 text-[#FFD874]',
  'Perpetuals': 'bg-[#ED1EFF]/12 text-[#E879F9]',
};

const CATEGORY_FILTERS: Array<'All' | ProtocolCategory> = [
  'All', 'DEX', 'Lending', 'RWA', 'Liquid Staking', 'Yield Aggregator', 'Perpetuals', 'Prediction Markets', 'Bridge',
];

type SortKey = 'category' | 'tvl' | 'volume' | 'fees';
type SortDir = 'asc' | 'desc';

const CATEGORY_ORDER: Record<ProtocolCategory, number> = {
  'DEX': 0,
  'Lending': 1,
  'RWA': 2,
  'Liquid Staking': 3,
  'Yield Aggregator': 4,
  'Perpetuals': 5,
  'Bridge': 6,
  'Prediction Markets': 7,
};

function CategoryBadge({ category }: { category: string }) {
  const styles = CATEGORY_STYLES[category] ?? 'bg-[var(--bg-elevated)] text-[var(--text-muted)]';
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${styles}`}>
      {category}
    </span>
  );
}

interface SortableHeaderProps {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  className?: string;
}

function SortableHeader({ label, active, dir, onClick, className }: SortableHeaderProps) {
  return (
    <th className={`py-2 text-[11px] font-medium text-[var(--text-faint)] ${className ?? ''}`}>
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 hover:text-[var(--text)] transition-colors ${active ? 'text-[var(--text)]' : ''}`}
      >
        {label}
        <span className="text-[9px] w-2 inline-block">
          {active ? (dir === 'desc' ? '▼' : '▲') : ''}
        </span>
      </button>
    </th>
  );
}

interface ChildEntry {
  config: ProtocolConfig;
  summary: ProtocolSummary | null | undefined;
  failed: boolean;
}

interface DirectoryRow {
  /** Stable key — slug for singletons, family slug for families. */
  key: string;
  /** True when this row aggregates multiple per-chain entries. */
  isFamily: boolean;
  /** Display name (familyLabel for families, protocol name otherwise). */
  name: string;
  category: ProtocolCategory;
  color: string;
  /**
   * For singletons, this is the single child. For families, the
   * representative child (highest TVL) — used for the dot color and
   * primary navigation target.
   */
  primary: ChildEntry;
  children: ChildEntry[];
  /** Aggregated TVL for the row (sum across children, or single value). */
  tvlUSD: number;
  volume30dUSD: number;
  fees30dUSD: number;
  /** True when at least one child has data; false if every child failed/loading. */
  hasData: boolean;
  /** Number of children that explicitly failed. Singletons: 0 or 1. */
  failedCount: number;
  /** True when every child explicitly failed. */
  allFailed: boolean;
}

const METRIC_SORT_VALUE: Record<Exclude<SortKey, 'category'>, (r: DirectoryRow) => number> = {
  tvl: (r) => r.tvlUSD,
  volume: (r) => r.volume30dUSD,
  fees: (r) => r.fees30dUSD,
};

export default function ProtocolsPage() {
  const { data: summaries, isLoading } = useProtocolsDirectory();
  const [category, setCategory] = useState<'All' | ProtocolCategory>('All');
  const [sortKey, setSortKey] = useState<SortKey>('category');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const rows: DirectoryRow[] = useMemo(() => {
    // Build per-config child entries first.
    const allChildren: ChildEntry[] = PROTOCOLS.map((config) => {
      const entry = summaries ? summaries[config.slug] : undefined;
      return {
        config,
        summary: entry ?? undefined,
        failed: !!summaries && entry === null,
      };
    });

    // Bucket children by family (or by slug for singletons).
    const buckets = new Map<string, ChildEntry[]>();
    for (const child of allChildren) {
      const key = child.config.family ?? child.config.slug;
      const arr = buckets.get(key);
      if (arr) arr.push(child);
      else buckets.set(key, [child]);
    }

    // Apply category filter at the bucket level — a family row passes if
    // any child matches. (All children of a family share a category in
    // practice, but we don't enforce it here.)
    const directoryRows: DirectoryRow[] = [];
    for (const [key, children] of buckets) {
      const filtered = category === 'All'
        ? children
        : children.filter((c) => c.config.category === category);
      if (filtered.length === 0) continue;

      const isFamily = filtered.length > 1 || (filtered[0].config.family != null && filtered.length > 0);
      // Pick the highest-TVL child (with data) as the primary representative.
      const sortedChildren = [...filtered].sort((a, b) => {
        const at = a.summary?.tvlUSD ?? -1;
        const bt = b.summary?.tvlUSD ?? -1;
        return bt - at;
      });
      const primary = sortedChildren[0];

      const withData = filtered.filter((c) => !c.failed && c.summary);
      const tvlUSD = withData.reduce((s, c) => s + (c.summary?.tvlUSD ?? 0), 0);
      const volume30dUSD = withData.reduce((s, c) => s + (c.summary?.volume30dUSD ?? 0), 0);
      const fees30dUSD = withData.reduce((s, c) => s + (c.summary?.fees30dUSD ?? 0), 0);
      const failedCount = filtered.filter((c) => c.failed).length;

      directoryRows.push({
        key,
        isFamily: isFamily && filtered.length > 1,
        name: isFamily && filtered.length > 1 ? (primary.config.familyLabel ?? primary.config.name) : primary.config.name,
        category: primary.config.category,
        color: primary.config.color,
        primary,
        children: sortedChildren,
        tvlUSD,
        volume30dUSD,
        fees30dUSD,
        hasData: withData.length > 0,
        failedCount,
        allFailed: !!summaries && failedCount === filtered.length && filtered.length > 0,
      });
    }

    const sorted = [...directoryRows].sort((a, b) => {
      if (sortKey === 'category') {
        const catDelta = CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category];
        if (catDelta !== 0) return catDelta;
        return b.tvlUSD - a.tvlUSD;
      }
      const av = a.hasData ? METRIC_SORT_VALUE[sortKey](a) : -1;
      const bv = b.hasData ? METRIC_SORT_VALUE[sortKey](b) : -1;
      return sortDir === 'desc' ? bv - av : av - bv;
    });
    return sorted;
  }, [summaries, category, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(sortDir === 'desc' ? 'asc' : 'desc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  function toggleExpand(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Flatten rows into render order: family rows followed by their children
  // when expanded. Singletons render as plain rows.
  const renderRows: Array<
    | { kind: 'row'; row: DirectoryRow; index: number }
    | { kind: 'child'; child: ChildEntry; familyKey: string }
  > = [];
  rows.forEach((row, i) => {
    renderRows.push({ kind: 'row', row, index: i });
    if (row.isFamily && expanded.has(row.key)) {
      for (const child of row.children) {
        renderRows.push({ kind: 'child', child, familyKey: row.key });
      }
    }
  });

  return (
    <div className="space-y-6">
      <div className="pb-2 border-b border-[var(--border)]">
        <h1 className="text-2xl font-semibold text-[var(--text)]">DeFi Protocols</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          Live analytics for leading DeFi protocols, all data sourced from The Graph
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <CardTitle>Protocol Directory</CardTitle>
            <span className="text-xs text-[var(--text-faint)]">Data updated hourly · Powered by The Graph</span>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-3">
            {CATEGORY_FILTERS.map((c) => {
              const active = c === category;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={`text-[11px] px-2 py-1 rounded-[var(--radius-button)] border transition-colors ${
                    active
                      ? 'bg-[var(--accent)]/10 border-[var(--accent)]/30 text-[var(--accent)]'
                      : 'bg-transparent border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--border-mid)] hover:text-[var(--text)]'
                  }`}
                >
                  {c}
                </button>
              );
            })}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {PROTOCOLS.map((p) => (
                <div key={p.slug} className="h-12 shimmer rounded" />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="text-left py-2 pr-4 text-[11px] font-medium text-[var(--text-faint)] w-8">#</th>
                    <th className="text-left py-2 pr-4 text-[11px] font-medium text-[var(--text-faint)]">Protocol</th>
                    <th className="text-left py-2 pr-4 text-[11px] font-medium text-[var(--text-faint)]">Category</th>
                    <SortableHeader
                      label="TVL"
                      active={sortKey === 'tvl'}
                      dir={sortDir}
                      onClick={() => handleSort('tvl')}
                      className="text-right pr-4"
                    />
                    <SortableHeader
                      label="30d Volume"
                      active={sortKey === 'volume'}
                      dir={sortDir}
                      onClick={() => handleSort('volume')}
                      className="text-right pr-4"
                    />
                    <SortableHeader
                      label="30d Fees"
                      active={sortKey === 'fees'}
                      dir={sortDir}
                      onClick={() => handleSort('fees')}
                      className="text-right"
                    />
                  </tr>
                </thead>
                <tbody>
                  {renderRows.map((entry) => {
                    if (entry.kind === 'row') {
                      const { row, index } = entry;
                      const isOpen = expanded.has(row.key);
                      const showDash = row.allFailed;
                      return (
                        <tr
                          key={row.key}
                          className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--bg-elevated)] transition-colors"
                        >
                          <td className="py-3 pr-4 text-[var(--text-faint)] font-mono text-xs">{index + 1}</td>
                          <td className="py-3 pr-4">
                            {row.isFamily ? (
                              <button
                                type="button"
                                onClick={() => toggleExpand(row.key)}
                                className="flex items-center gap-2.5 group w-full text-left"
                                aria-expanded={isOpen}
                              >
                                <span className="text-[10px] text-[var(--text-faint)] w-3 inline-block">
                                  {isOpen ? '▼' : '▶'}
                                </span>
                                <ProtocolLogo
                                  name={row.name}
                                  color={row.color}
                                  sources={buildProtocolSources(row.primary.config.family ?? row.primary.config.slug)}
                                  size={20}
                                />
                                <span className="font-medium text-[var(--text)] group-hover:text-[var(--accent)] transition-colors">
                                  {row.name}
                                </span>
                                <span className="text-[10px] text-[var(--text-faint)] hidden sm:inline">
                                  {row.children.length} chains
                                </span>
                              </button>
                            ) : (
                              <Link
                                href={`/protocols/${row.primary.config.slug}`}
                                className="flex items-center gap-2.5 group"
                              >
                                <span className="text-[10px] w-3 inline-block" />
                                <ProtocolLogo
                                  name={row.name}
                                  color={row.color}
                                  sources={buildProtocolSources(row.primary.config.family ?? row.primary.config.slug)}
                                  size={20}
                                />
                                <span className="font-medium text-[var(--text)] group-hover:text-[var(--accent)] transition-colors">
                                  {row.name}
                                </span>
                                <span className="text-[10px] text-[var(--text-faint)] hidden sm:inline">
                                  {row.primary.config.chains.join(', ')}
                                </span>
                              </Link>
                            )}
                          </td>
                          <td className="py-3 pr-4">
                            <CategoryBadge category={row.category} />
                          </td>
                          <td className="py-3 pr-4 text-right font-mono text-[var(--text)] whitespace-nowrap">
                            {showDash ? '—' : row.hasData ? formatUSD(row.tvlUSD) : <span className="text-[var(--text-faint)]">—</span>}
                          </td>
                          <td className="py-3 pr-4 text-right font-mono text-[var(--text-muted)] text-xs whitespace-nowrap">
                            {showDash ? '—' : row.hasData ? formatUSD(row.volume30dUSD) : '—'}
                          </td>
                          <td className="py-3 text-right font-mono text-[var(--accent)] text-xs whitespace-nowrap">
                            {showDash ? '—' : row.hasData ? formatUSD(row.fees30dUSD) : '—'}
                          </td>
                        </tr>
                      );
                    }
                    const { child } = entry;
                    const summary = child.summary ?? null;
                    return (
                      <tr
                        key={`${entry.familyKey}-${child.config.slug}`}
                        className="border-b border-[var(--border)] last:border-0 bg-[var(--bg-elevated)]/40 hover:bg-[var(--bg-elevated)] transition-colors"
                      >
                        <td className="py-2.5 pr-4" />
                        <td className="py-2.5 pr-4 pl-9">
                          <Link
                            href={`/protocols/${child.config.slug}`}
                            className="flex items-center gap-2.5 group"
                          >
                            <ProtocolLogo
                              name={child.config.chains[0] ?? child.config.name}
                              color={child.config.color}
                              sources={buildNetworkSources(child.config.chains[0] ?? '')}
                              size={16}
                            />
                            <span className="text-xs text-[var(--text-muted)] group-hover:text-[var(--accent)] transition-colors">
                              {child.config.chains.join(' / ')}
                            </span>
                          </Link>
                        </td>
                        <td className="py-2.5 pr-4">
                          <CategoryBadge category={child.config.category} />
                        </td>
                        <td className="py-2.5 pr-4 text-right font-mono text-[var(--text-muted)] text-xs whitespace-nowrap">
                          {child.failed ? '—' : summary ? formatUSD(summary.tvlUSD) : '—'}
                        </td>
                        <td className="py-2.5 pr-4 text-right font-mono text-[var(--text-faint)] text-[11px] whitespace-nowrap">
                          {child.failed ? '—' : summary ? formatUSD(summary.volume30dUSD) : '—'}
                        </td>
                        <td className="py-2.5 text-right font-mono text-[var(--accent)]/70 text-[11px] whitespace-nowrap">
                          {child.failed ? '—' : summary ? formatUSD(summary.fees30dUSD) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-xs text-[var(--text-faint)]">
                        No protocols match this filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-center text-[var(--text-faint)]">
        Analytics powered by{' '}
        <a
          href="https://thegraph.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--accent)] hover:underline"
        >
          The Graph
        </a>
        {' '}· open, permissionless blockchain data
      </p>
    </div>
  );
}
