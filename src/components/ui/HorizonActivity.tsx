'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { formatGRT, cn } from '@/lib/utils';
import type { ActivityEvent } from '@/app/api/horizon/activity/route';

// ── Event display config ────────────────────────────────────────────────────

const EVENT_CONFIG: Record<ActivityEvent['type'], { label: string; color: string }> = {
  delegated:       { label: 'Delegated',   color: 'var(--green)' },
  undelegated:     { label: 'Undelegated', color: 'var(--amber)' },
  withdrawn:       { label: 'Withdrawn',   color: 'var(--amber)' },
  delegation_slash:{ label: 'Slashed',     color: 'var(--red)'   },
  stake_deposit:   { label: 'Staked',      color: 'var(--cyan)'  },
  stake_lock:      { label: 'Thawing',     color: 'var(--amber)' },
  stake_withdraw:  { label: 'Unstaked',    color: 'var(--amber)' },
  provision:       { label: 'Provision',   color: 'var(--cyan)'  },
  provision_slash: { label: 'Slashed',     color: 'var(--red)'   },
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function shortAddr(addr: string) {
  return addr.slice(0, 6) + '…' + addr.slice(-4);
}

// ── Component ────────────────────────────────────────────────────────────────

export function HorizonActivity() {
  const { data, isLoading, dataUpdatedAt } = useQuery<{ data: ActivityEvent[] }>({
    queryKey: ['horizon-activity'],
    queryFn: () => fetch('/api/horizon/activity?limit=100').then((r) => r.json()),
    refetchInterval: 30_000,
    staleTime: 25_000,
  });

  const events = data?.data ?? [];
  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <CardTitle>Horizon Activity</CardTitle>
            {/* Live pulsing dot */}
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--green)] opacity-60" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--green)]" />
            </span>
          </div>

          {/* Powered by Amp badge */}
          <a
            href="https://amp.xyz"
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-full',
              'border border-[var(--border)] bg-[var(--bg-elevated)]',
              'text-[10px] font-medium text-[var(--text-faint)]',
              'hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors'
            )}
            title="Live on-chain data powered by Amp"
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
            Powered by Amp
          </a>
        </div>

        <div className="flex items-center justify-between mt-1">
          <p className="text-[11px] text-[var(--text-faint)]">
            All Horizon staking events · refreshes every 30s
          </p>
          {lastUpdated && (
            <span className="text-[10px] text-[var(--text-faint)]">
              updated {lastUpdated}
            </span>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-11 shimmer rounded-lg" />
            ))}
          </div>
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <span className="text-2xl">⛓</span>
            <p className="text-sm text-[var(--text-muted)]">No Horizon events indexed yet</p>
            <p className="text-[11px] text-[var(--text-faint)]">Events will appear as they are indexed from the chain</p>
          </div>
        ) : (
          <div className="space-y-1.5 max-h-[600px] overflow-y-auto pr-1">
            {events.map((event) => {
              const cfg = EVENT_CONFIG[event.type];
              const isSlash = event.type === 'provision_slash' || event.type === 'delegation_slash';

              return (
                <div
                  key={event.id}
                  className={cn(
                    'flex items-center gap-2.5 px-3 py-2 rounded-lg',
                    'bg-[var(--bg-elevated)] border-[0.5px] border-[var(--border)]',
                    'hover:border-[color-mix(in_srgb,var(--border)_60%,var(--accent)_40%)] transition-colors',
                    isSlash && 'border-[color-mix(in_srgb,var(--border)_70%,var(--red)_30%)]'
                  )}
                >
                  {/* Event badge */}
                  <span
                    className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 min-w-[56px] text-center"
                    style={{
                      color: cfg.color,
                      backgroundColor: `color-mix(in srgb, ${cfg.color} 12%, transparent)`,
                    }}
                  >
                    {cfg.label}
                  </span>

                  {/* Amount */}
                  <span className="font-mono text-xs text-[var(--text)] shrink-0 w-[90px] text-right">
                    {event.tokensGRT > 0 ? `${formatGRT(event.tokensGRT)} GRT` : '—'}
                  </span>

                  {/* Provider + optional delegator */}
                  <span className="text-[11px] text-[var(--text-faint)] font-mono truncate flex-1 hidden sm:block">
                    <a
                      href={`/indexers/${event.serviceProvider}`}
                      className="hover:text-[var(--accent)] transition-colors"
                    >
                      {shortAddr(event.serviceProvider)}
                    </a>
                    {event.delegator && (
                      <>
                        <span className="mx-1.5 text-[var(--text-faint)]">←</span>
                        <a
                          href={`/delegators/${event.delegator}`}
                          className="hover:text-[var(--accent)] transition-colors"
                        >
                          {shortAddr(event.delegator)}
                        </a>
                      </>
                    )}
                  </span>

                  {/* Block + arbiscan link */}
                  <span className="ml-auto text-[10px] text-[var(--text-faint)] shrink-0 flex items-center gap-1.5">
                    <span className="font-mono hidden md:inline">#{event.block.toLocaleString()}</span>
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
