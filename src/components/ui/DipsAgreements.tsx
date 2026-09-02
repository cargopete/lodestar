'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import type { Agreement, AgreementStatus } from '@/lib/dips-agreements';

interface AgreementsResponse {
  available: boolean;
  empty?: boolean;
  agreements?: Agreement[];
  counts?: Record<AgreementStatus, number>;
  totalCollectedGrt?: number;
}

function shortId(id: string) {
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

function fmtDate(ts: number) {
  return new Date(ts * 1000).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

const STATUS_COLOUR: Record<AgreementStatus, string> = {
  active: 'text-[var(--green)]',
  accepted: 'text-[var(--green)]',
  offered: 'text-[var(--amber)]',
  'offer-withdrawn': 'text-[var(--text-faint)]',
  rejected: 'text-[var(--red)]',
  cancelled: 'text-[var(--text-muted)]',
  removed: 'text-[var(--text-faint)]',
};

const STATUS_LABEL: Record<AgreementStatus, string> = {
  active: 'Active',
  accepted: 'Accepted',
  offered: 'Offered',
  'offer-withdrawn': 'Offer withdrawn',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  removed: 'Removed',
};

/**
 * Direct Indexer Payment agreements, once any exist.
 *
 * Renders nothing at all while the lifecycle is empty, which is its state today and will be until
 * governance funds the indexing-agreement allocation. That is deliberate rather than lazy: an
 * empty table with headings would sit on the homepage implying agreements are a thing that happens
 * here and simply are not happening, which is a different and wronger claim than saying nothing.
 *
 * When the first agreement is accepted this appears on its own.
 */
export function DipsAgreements() {
  const { data, isLoading } = useQuery<{ data: AgreementsResponse }>({
    queryKey: ['dips-agreements'],
    queryFn: () => fetch('/api/dips/agreements').then((r) => r.json()),
    refetchInterval: 300_000,
    staleTime: 240_000,
  });

  const d = data?.data;
  if (isLoading || !d?.available || d.empty) return null;

  const agreements = d.agreements ?? [];
  const counts = d.counts;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Indexing agreements</CardTitle>
            <p className="text-sm text-[var(--text-muted)] mt-1">
              Recurring Collection Agreements on Arbitrum One, from offer through collection.
            </p>
          </div>
          <span className="shrink-0 px-2 py-0.5 rounded font-mono text-[10px] uppercase tracking-wide bg-[var(--bg-elevated)] text-[var(--green)]">
            Live
          </span>
        </div>
      </CardHeader>

      <CardContent>
        <div className="flex items-end gap-4 mb-4">
          <p className="text-[32px] leading-none font-mono font-semibold text-[var(--accent-text)] tabular-nums">
            {(d.totalCollectedGrt ?? 0).toFixed(2)}
          </p>
          <p className="text-[13px] text-[var(--text-muted)] pb-0.5">
            GRT collected across {agreements.length} agreement{agreements.length === 1 ? '' : 's'}
            {counts?.active ? ` · ${counts.active} active` : ''}
          </p>
        </div>

        <div>
          {agreements.slice(0, 12).map((a) => (
            <div
              key={a.id}
              className="py-2.5 border-b border-[var(--border)] last:border-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 items-center"
            >
              <span className="min-w-0">
                <span className="text-[13px] text-[var(--text)] block truncate">
                  {a.serviceProvider ?? 'unknown provider'}
                </span>
                <span className="font-mono text-[10px] text-[var(--text-faint)]">
                  {shortId(a.id)}
                  {' · '}
                  <span className={STATUS_COLOUR[a.status]}>{STATUS_LABEL[a.status]}</span>
                  {a.collections > 0
                    ? ` · ${a.collections} collection${a.collections === 1 ? '' : 's'}`
                    : ''}
                  {a.endsAt ? ` · ends ${fmtDate(a.endsAt)}` : ''}
                </span>
              </span>
              <span className="font-mono text-[13px] font-semibold tabular-nums text-right text-[var(--text)]">
                {a.collectedGrt.toFixed(2)}
              </span>
            </div>
          ))}
        </div>

        {agreements.length > 12 && (
          <p className="mt-3 font-mono text-[10px] text-[var(--text-faint)]">
            showing 12 of {agreements.length}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
