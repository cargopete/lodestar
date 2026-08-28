'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from './Card';
import { ProgressBar } from './ProgressBar';
import {
  CATALYST_ITEMS,
  CATALYST_LAST_SCORED,
  CATALYST_SOURCE_POST,
  CATALYST_TRACKER_URL,
  catalystSummary,
  coverageBand,
  type CatalystItem,
  type CoverageBand,
} from '@/data/catalyst-roadmap';

const BAND_META: Record<
  CoverageBand,
  { bar: 'teal' | 'orange' | 'neutral'; text: string; label: string }
> = {
  strong: {
    bar: 'teal',
    text: 'text-[var(--green)]',
    label: 'Most of the engineering is already public',
  },
  partial: {
    bar: 'orange',
    text: 'text-[var(--amber)]',
    label: 'A reference implementation exists; the hard half does not',
  },
  foundation: {
    bar: 'neutral',
    text: 'text-[var(--text-faint)]',
    label: 'Deals, migrations and institutional trust — Foundation work',
  },
};

function isExternal(url: string) {
  return url.startsWith('http');
}

function Row({
  item,
  open,
  onToggle,
}: {
  item: CatalystItem;
  open: boolean;
  onToggle: () => void;
}) {
  const band = BAND_META[coverageBand(item.coverage)];

  return (
    <div className="border-b border-[var(--border)] last:border-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full text-left py-3 grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_140px_3rem] items-center gap-x-3 gap-y-2 hover:bg-[var(--bg-elevated)] transition-colors rounded-[var(--radius-button)] px-2 -mx-2"
      >
        <span className="flex items-center gap-2 min-w-0">
          <svg
            className={`w-3 h-3 shrink-0 text-[var(--text-faint)] transition-transform ${open ? 'rotate-90' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-[13px] text-[var(--text)] truncate" title={item.label}>
            {item.label}
          </span>
        </span>

        {/* The bar wraps to a full-width row on mobile, where 140px of track is
            not worth the horizontal squeeze on the label. */}
        <span className="col-span-2 sm:col-span-1 sm:col-start-2 order-last sm:order-none">
          <ProgressBar value={item.coverage} variant={band.bar} size="sm" />
        </span>

        <span
          className={`font-mono text-[13px] font-semibold text-right tabular-nums ${band.text}`}
        >
          {item.coverage}%
        </span>
      </button>

      {open && (
        <div className="pb-4 pl-7 pr-2 space-y-2">
          <p className="text-[13px] leading-relaxed text-[var(--text-muted)]">{item.rationale}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {item.projects.length === 0 ? (
              <span className="text-[11px] font-mono text-[var(--text-faint)]">
                No community project
              </span>
            ) : (
              item.projects.map((p) =>
                isExternal(p.url) ? (
                  <a
                    key={p.url}
                    href={p.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--bg-elevated)] text-[var(--accent-text)] hover:underline"
                  >
                    {p.name} ↗
                  </a>
                ) : (
                  <Link
                    key={p.url}
                    href={p.url}
                    className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--bg-elevated)] text-[var(--accent-text)] hover:underline"
                  >
                    {p.name}
                  </Link>
                )
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * How much of Project Catalyst the community has already built.
 *
 * Editorial scoring, not measurement — the card says so on its face, because a
 * number this confident sitting next to live chain data would otherwise be read
 * as one.
 */
export function CatalystCoverage() {
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const summary = useMemo(() => catalystSummary(), []);

  // Formatted in UTC on purpose. The date string parses as UTC midnight, so
  // formatting it in the viewer's local zone renders the previous day anywhere
  // west of Greenwich — and the server prerenders in UTC, which is a hydration
  // mismatch rather than merely a wrong date.
  const scored = new Date(CATALYST_LAST_SCORED).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Project Catalyst Coverage</CardTitle>
            <p className="text-sm text-[var(--text-muted)] mt-1">
              How much of the Foundation&apos;s roadmap community tools already cover
            </p>
          </div>
          <Link
            href={CATALYST_SOURCE_POST}
            className="text-xs text-[var(--accent-text)] hover:underline shrink-0"
          >
            The scoring →
          </Link>
        </div>
      </CardHeader>

      <CardContent>
        <div className="flex items-end gap-4 mb-1">
          <p className="text-[32px] leading-none font-mono font-semibold text-[var(--accent-text)] tabular-nums">
            {summary.overall.toFixed(0)}%
          </p>
          <p className="text-[13px] text-[var(--text-muted)] pb-0.5">
            of the roadmap already sits in public repos
          </p>
        </div>
        <p className="text-[11px] text-[var(--text-faint)] mb-4">
          Unweighted mean of {summary.total} roadmap items · {summary.covered} with community work ·{' '}
          {summary.untouched} untouched · editorial scoring, last argued {scored}
        </p>

        <div>
          {CATALYST_ITEMS.map((item) => (
            <Row
              key={item.slug}
              item={item}
              open={openSlug === item.slug}
              onToggle={() => setOpenSlug((cur) => (cur === item.slug ? null : item.slug))}
            />
          ))}
        </div>

        <div className="mt-4 pt-3 border-t border-[var(--border)] flex flex-wrap gap-x-4 gap-y-1">
          {(Object.keys(BAND_META) as CoverageBand[]).map((band) => (
            <span key={band} className="inline-flex items-center gap-1.5">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  band === 'strong'
                    ? 'bg-[var(--green)]'
                    : band === 'partial'
                      ? 'bg-[var(--amber)]'
                      : 'bg-[var(--text-faint)]'
                }`}
              />
              <span className="text-[11px] text-[var(--text-faint)]">{BAND_META[band].label}</span>
            </span>
          ))}
        </div>

        <div className="mt-3 pt-3 border-t border-[var(--border)]">
          <a
            href={CATALYST_TRACKER_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-[var(--accent-text)] hover:underline"
          >
            The plan to close every gap, workstream by workstream ↗
          </a>
          <p className="text-[11px] text-[var(--text-faint)] mt-1">
            No budget, no headcount, no funding. A live checklist of what is verified on-chain and
            what is left.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
