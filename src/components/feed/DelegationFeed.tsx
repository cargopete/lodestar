'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useNetworkDelegations, useEnrichedIndexers } from '@/hooks/useNetworkStats';
import { weiToGRT, formatGRT, formatRelativeTime, cn } from '@/lib/utils';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';

const EVENT_CONFIG: Record<string, { label: string; color: string; sign: '+' | '-' | '' }> = {
  StakeDelegated: { label: 'Delegated', color: 'var(--green)', sign: '+' },
  StakeDelegatedLocked: { label: 'Delegated', color: 'var(--green)', sign: '+' },
  StakeUndelegated: { label: 'Undelegated', color: 'var(--amber)', sign: '-' },
  StakeUndelegatedLocked: { label: 'Undelegated', color: 'var(--amber)', sign: '-' },
  StakeDelegatedWithdrawn: { label: 'Withdrawn', color: 'var(--red)', sign: '-' },
};

interface DelegationFeedProps {
  /** Pre-set indexer filter (e.g. from indexer detail page) */
  indexerAddress?: string;
}

export function DelegationFeed({ indexerAddress: initialFilter }: DelegationFeedProps) {
  const [filterInput, setFilterInput] = useState(initialFilter ?? '');
  const [activeFilter, setActiveFilter] = useState(initialFilter ?? '');

  // Load enriched indexers for name → address resolution
  const { data: enrichedData } = useEnrichedIndexers();

  // Build name→address lookup from enriched data
  const nameToAddress = useMemo(() => {
    const map = new Map<string, string>();
    if (enrichedData?.indexers) {
      for (const idx of enrichedData.indexers) {
        map.set(idx.name.toLowerCase(), idx.id);
        map.set(idx.id.toLowerCase(), idx.id);
      }
    }
    return map;
  }, [enrichedData]);

  // Resolve the active filter — could be a name or an address
  const resolvedFilter = useMemo(() => {
    if (!activeFilter) return '';
    // Direct address
    if (/^0x[a-fA-F0-9]{40}$/.test(activeFilter)) return activeFilter;
    // Try name lookup (case-insensitive, partial match)
    const lower = activeFilter.toLowerCase();
    for (const [name, addr] of nameToAddress) {
      if (name.includes(lower)) return addr;
    }
    return activeFilter; // pass through — will return no results if invalid
  }, [activeFilter, nameToAddress]);

  const isValidAddress = /^0x[a-fA-F0-9]{40}$/.test(resolvedFilter);
  const { data: events, isLoading } = useNetworkDelegations(isValidAddress ? resolvedFilter : undefined);

  // Build indexer address → name map for display
  const indexerNames = useMemo(() => {
    const map = new Map<string, string>();
    if (enrichedData?.indexers) {
      for (const idx of enrichedData.indexers) {
        map.set(idx.id.toLowerCase(), idx.name);
      }
    }
    return map;
  }, [enrichedData]);

  const handleFilterSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setActiveFilter(filterInput.trim());
  };

  const clearFilter = () => {
    setFilterInput('');
    setActiveFilter('');
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Delegation Activity</CardTitle>
          <span className="text-[10px] text-[var(--text-faint)] uppercase tracking-wider">
            {activeFilter ? 'Filtered' : 'Live'} — last 50
          </span>
        </div>
        {/* Indexer filter */}
        <form onSubmit={handleFilterSubmit} className="flex items-center gap-2 mt-3">
          <input
            type="text"
            value={filterInput}
            onChange={(e) => setFilterInput(e.target.value)}
            placeholder="Filter by indexer name or address..."
            className={cn(
              'flex-1 px-3 py-1.5 text-xs',
              'rounded-[var(--radius-button)]',
              'bg-[var(--bg-elevated)] border border-[var(--border)]',
              'text-[var(--text)] placeholder:text-[var(--text-faint)]',
              'focus:outline-none focus:border-[var(--accent)]'
            )}
          />
          <button
            type="submit"
            className={cn(
              'px-3 py-1.5 text-xs font-medium rounded-[var(--radius-button)]',
              'bg-[var(--accent)] text-white hover:opacity-90 transition-opacity'
            )}
          >
            Filter
          </button>
          {activeFilter && (
            <button
              type="button"
              onClick={clearFilter}
              className="px-2 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
            >
              Clear
            </button>
          )}
        </form>
        {activeFilter && !isValidAddress && (
          <p className="text-[11px] text-[var(--amber)] mt-1">
            No indexer found matching &ldquo;{activeFilter}&rdquo;
          </p>
        )}
        {activeFilter && isValidAddress && resolvedFilter !== activeFilter.toLowerCase() && (
          <p className="text-[11px] text-[var(--text-faint)] mt-1">
            Matched: {indexerNames.get(resolvedFilter.toLowerCase()) ?? resolvedFilter}
          </p>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-14 shimmer rounded-lg" />
            ))}
          </div>
        ) : !events?.length ? (
          <p className="text-sm text-[var(--text-muted)] text-center py-8">
            {activeFilter ? 'No delegation events found' : 'No recent delegation events'}
          </p>
        ) : (
          <div className="space-y-1.5 max-h-[520px] overflow-y-auto">
            {events.map((event) => {
              const config = EVENT_CONFIG[event.eventType] ?? { label: event.eventType, color: 'var(--text-muted)', sign: '' };
              const amount = weiToGRT(event.tokens);
              const timestamp = Number(event.timestamp);
              const indexerName = indexerNames.get(event.indexer.toLowerCase());

              return (
                <div
                  key={event.id}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)] hover:border-[color-mix(in_srgb,var(--border)_70%,var(--accent)_30%)] transition-colors"
                >
                  {/* Event type badge */}
                  <span
                    className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0"
                    style={{ color: config.color, backgroundColor: `color-mix(in srgb, ${config.color} 12%, transparent)` }}
                  >
                    {config.label}
                  </span>

                  {/* Amount */}
                  <span className="font-mono text-sm text-[var(--text)] shrink-0">
                    <span style={{ color: config.color }}>{config.sign}</span>
                    {formatGRT(amount)} GRT
                  </span>

                  {/* Addresses — full on desktop, hidden on mobile */}
                  <span className="text-[11px] text-[var(--text-faint)] truncate hidden sm:inline font-mono">
                    <Link
                      href={`/delegators/${event.delegator}`}
                      className="hover:text-[var(--accent)] transition-colors"
                    >
                      {event.delegator}
                    </Link>
                    <span className="mx-1">→</span>
                    <Link
                      href={`/indexers/${event.indexer}`}
                      className="hover:text-[var(--accent)] transition-colors"
                    >
                      {indexerName ?? event.indexer}
                    </Link>
                  </span>

                  {/* Timestamp + tx link */}
                  <span className="ml-auto text-[10px] text-[var(--text-faint)] shrink-0 flex items-center gap-1.5">
                    {formatRelativeTime(timestamp)}
                    <a
                      href={`https://arbiscan.io/tx/${event.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-[var(--accent)] transition-colors"
                      title="View on Arbiscan"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                      </svg>
                    </a>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
