'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { PROTOCOLS, type ProtocolCategory, type ProtocolConfig } from '@/lib/protocols/config';
import { useProtocolsDirectory } from '@/hooks/useProtocols';
import type { ProtocolSummary } from '@/lib/protocols/fetcher';
import { formatUSD } from '@/lib/utils';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';

const CATEGORY_STYLES: Record<string, string> = {
  'DEX': 'bg-[var(--accent)]/10 text-[var(--accent)]',
  'Lending': 'bg-[var(--green)]/10 text-[var(--green)]',
  'Liquid Staking': 'bg-[#00A3FF]/12 text-[#5BC2FF]',
};

const CATEGORY_FILTERS: Array<'All' | ProtocolCategory> = [
  'All', 'DEX', 'Lending', 'Liquid Staking',
];

type SortKey = 'tvl' | 'volume' | 'fees';
type SortDir = 'asc' | 'desc';

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

interface DirectoryRow {
  config: ProtocolConfig;
  summary: ProtocolSummary | null | undefined;
  failed: boolean;
}

const SORT_VALUE: Record<SortKey, (s: ProtocolSummary) => number> = {
  tvl: (s) => s.tvlUSD,
  volume: (s) => s.volume30dUSD,
  fees: (s) => s.fees30dUSD,
};

export default function ProtocolsPage() {
  const { data: summaries, isLoading } = useProtocolsDirectory();
  const [category, setCategory] = useState<'All' | ProtocolCategory>('All');
  const [sortKey, setSortKey] = useState<SortKey>('tvl');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const rows: DirectoryRow[] = useMemo(() => {
    const all: DirectoryRow[] = PROTOCOLS.map((config, i) => ({
      config,
      summary: summaries?.[i],
      failed: !!summaries && !summaries[i],
    }));

    const filtered = category === 'All'
      ? all
      : all.filter((r) => r.config.category === category);

    const sorted = [...filtered].sort((a, b) => {
      const av = a.summary ? SORT_VALUE[sortKey](a.summary) : -1;
      const bv = b.summary ? SORT_VALUE[sortKey](b.summary) : -1;
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

  return (
    <div className="space-y-6">
      <div className="pb-2 border-b border-[var(--border)]">
        <h1 className="text-2xl font-semibold text-[var(--text)]">DeFi Protocols</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          Live analytics for leading DeFi protocols — all data sourced from The Graph
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
                  {rows.map(({ config: protocol, summary, failed }, i) => (
                    <tr
                      key={protocol.slug}
                      className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--bg-elevated)] transition-colors"
                    >
                      <td className="py-3 pr-4 text-[var(--text-faint)] font-mono text-xs">{i + 1}</td>
                      <td className="py-3 pr-4">
                        <Link
                          href={`/protocols/${protocol.slug}`}
                          className="flex items-center gap-2.5 group"
                        >
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: protocol.color }}
                          />
                          <span className="font-medium text-[var(--text)] group-hover:text-[var(--accent)] transition-colors">
                            {protocol.name}
                          </span>
                          <span className="text-[10px] text-[var(--text-faint)] hidden sm:inline">
                            {protocol.chains.join(', ')}
                          </span>
                        </Link>
                      </td>
                      <td className="py-3 pr-4">
                        <CategoryBadge category={protocol.category} />
                      </td>
                      <td className="py-3 pr-4 text-right font-mono text-[var(--text)] whitespace-nowrap">
                        {failed ? '—' : summary ? formatUSD(summary.tvlUSD) : <span className="text-[var(--text-faint)]">—</span>}
                      </td>
                      <td className="py-3 pr-4 text-right font-mono text-[var(--text-muted)] text-xs whitespace-nowrap">
                        {failed ? '—' : summary ? formatUSD(summary.volume30dUSD) : '—'}
                      </td>
                      <td className="py-3 text-right font-mono text-[var(--accent)] text-xs whitespace-nowrap">
                        {failed ? '—' : summary ? formatUSD(summary.fees30dUSD) : '—'}
                      </td>
                    </tr>
                  ))}
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
        {' '}— open, permissionless blockchain data
      </p>
    </div>
  );
}
