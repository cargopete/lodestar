'use client';

import Link from 'next/link';
import { useNetworkDelegations } from '@/hooks/useNetworkStats';
import { weiToGRT, formatGRT, shortenAddress, formatRelativeTime } from '@/lib/utils';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';

const EVENT_CONFIG: Record<string, { label: string; color: string; sign: '+' | '-' | '' }> = {
  StakeDelegated: { label: 'Delegated', color: 'var(--green)', sign: '+' },
  StakeDelegatedLocked: { label: 'Delegated', color: 'var(--green)', sign: '+' },
  StakeUndelegated: { label: 'Undelegated', color: 'var(--amber)', sign: '-' },
  StakeUndelegatedLocked: { label: 'Undelegated', color: 'var(--amber)', sign: '-' },
  StakeDelegatedWithdrawn: { label: 'Withdrawn', color: 'var(--red)', sign: '-' },
};

export function DelegationFeed() {
  const { data: events, isLoading } = useNetworkDelegations();

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Delegation Activity</CardTitle>
          <span className="text-[10px] text-[var(--text-faint)] uppercase tracking-wider">Live — last 50</span>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-14 shimmer rounded-lg" />
            ))}
          </div>
        ) : !events?.length ? (
          <p className="text-sm text-[var(--text-muted)] text-center py-8">No recent delegation events</p>
        ) : (
          <div className="space-y-1.5 max-h-[520px] overflow-y-auto">
            {events.map((event) => {
              const config = EVENT_CONFIG[event.eventType] ?? { label: event.eventType, color: 'var(--text-muted)', sign: '' };
              const amount = weiToGRT(event.tokens);
              const timestamp = Number(event.timestamp);

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

                  {/* Addresses */}
                  <span className="text-[11px] text-[var(--text-faint)] truncate hidden sm:inline">
                    <Link
                      href={`/delegators/${event.delegator}`}
                      className="hover:text-[var(--accent)] transition-colors"
                    >
                      {shortenAddress(event.delegator)}
                    </Link>
                    {' → '}
                    <Link
                      href={`/indexers/${event.indexer}`}
                      className="hover:text-[var(--accent)] transition-colors"
                    >
                      {shortenAddress(event.indexer)}
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
