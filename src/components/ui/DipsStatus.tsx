'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import type { DipsAllocation, DipsStep } from '@/app/api/dips/route';

interface DipsResponse {
  available: boolean;
  totalRate?: number;
  agreementRate?: number;
  live?: boolean;
  allocations?: DipsAllocation[];
  timeline?: DipsStep[];
  lastConfiguredAt?: number | null;
}

function shortAddr(addr: string) {
  return addr.slice(0, 6) + '…' + addr.slice(-4);
}

function fmtDate(ts: number) {
  return new Date(ts * 1000).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Direct Indexer Payments: armed or live?
 *
 * The whole panel exists for one number. Every DIPS contract is deployed and wired on Arbitrum One,
 * and the indexing-agreement allocation is zero. When governance moves it, this is the first place
 * it shows. Backed by `dips-nest`; renders nothing at all when the nest is unconfigured, because a
 * panel that invents a zero here would be indistinguishable from one reporting a real one.
 */
export function DipsStatus() {
  const { data, isLoading } = useQuery<{ data: DipsResponse }>({
    queryKey: ['dips-status'],
    queryFn: () => fetch('/api/dips').then((r) => r.json()),
    refetchInterval: 300_000,
    staleTime: 240_000,
  });

  const d = data?.data;
  if (isLoading || !d?.available) return null;

  const live = Boolean(d.live);
  const allocations = d.allocations ?? [];
  const timeline = d.timeline ?? [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Direct Indexer Payments</CardTitle>
            <p className="text-sm text-[var(--text-muted)] mt-1">
              Every DIPS contract is live on Arbitrum One. The question is whether any issuance
              reaches them yet.
            </p>
          </div>
          <span
            className={`shrink-0 px-2 py-0.5 rounded font-mono text-[10px] uppercase tracking-wide ${
              live
                ? 'bg-[var(--bg-elevated)] text-[var(--green)]'
                : 'bg-[var(--bg-elevated)] text-[var(--amber)]'
            }`}
          >
            {live ? 'Live' : 'Armed'}
          </span>
        </div>
      </CardHeader>

      <CardContent>
        <div className="flex items-end gap-4 mb-1">
          <p className="text-[32px] leading-none font-mono font-semibold text-[var(--accent-text)] tabular-nums">
            {(d.agreementRate ?? 0).toFixed(2)}
          </p>
          <p className="text-[13px] text-[var(--text-muted)] pb-0.5">
            GRT per block reaching indexing agreements
          </p>
        </div>
        <p className="text-[11px] text-[var(--text-faint)] mb-4">
          out of {(d.totalRate ?? 0).toFixed(2)} GRT/block allocated
          {d.lastConfiguredAt ? ` · last configured ${fmtDate(d.lastConfiguredAt)}` : ''}
        </p>

        <div>
          {allocations.map((a) => (
            <div
              key={a.target}
              className="py-2.5 border-b border-[var(--border)] last:border-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 items-center"
            >
              <span className="min-w-0">
                <span className="text-[13px] text-[var(--text)] block truncate">{a.label}</span>
                <span className="font-mono text-[10px] text-[var(--text-faint)]">
                  {shortAddr(a.target)}
                  {!a.observed && ' · no allocation event; zero by absence'}
                  {a.observed && a.selfMinting && ' · self-minting'}
                </span>
              </span>
              <span className="font-mono text-[13px] font-semibold tabular-nums text-right text-[var(--text)]">
                {a.rate.toFixed(2)}
                <span className="text-[var(--text-faint)] font-normal">
                  {' '}
                  ({a.sharePct.toFixed(0)}%)
                </span>
              </span>
            </div>
          ))}
        </div>

        {timeline.length > 0 && (
          <div className="mt-4 pt-3 border-t border-[var(--border)]">
            <p className="font-mono text-[10px] uppercase tracking-wide text-[var(--text-faint)] mb-2">
              How it got here
            </p>
            <div className="space-y-1.5">
              {timeline.map((s) => (
                <div
                  key={`${s.block}-${s.step}`}
                  className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] gap-x-3 items-baseline"
                >
                  <span className="font-mono text-[10px] text-[var(--text-faint)] tabular-nums">
                    {fmtDate(s.timestamp)}
                  </span>
                  <span className="text-[12px] text-[var(--text-muted)] min-w-0 truncate">
                    {s.label}
                    {s.subjectLabel ? ` · ${s.subjectLabel}` : ''}
                  </span>
                  <span className="font-mono text-[11px] tabular-nums text-[var(--text-faint)]">
                    {s.rate !== null ? `${s.rate.toFixed(2)} GRT/blk` : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-[11px] text-[var(--text-faint)] mt-4 pt-3 border-t border-[var(--border)]">
          {live
            ? 'Issuance is reaching indexing agreements. DIPS is funding indexers.'
            : 'Every step of arming DIPS is done except one: moving the indexing-agreement allocation off zero. That is a single governance transaction.'}
        </p>
      </CardContent>
    </Card>
  );
}
