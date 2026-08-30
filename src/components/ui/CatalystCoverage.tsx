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
  { bar: 'teal' | 'orange' | 'neutral'; fill: string; text: string; label: string }
> = {
  strong: {
    bar: 'teal',
    fill: 'var(--green)',
    text: 'text-[var(--green)]',
    label: 'Most of the engineering is already public',
  },
  partial: {
    bar: 'orange',
    fill: 'var(--amber)',
    text: 'text-[var(--amber)]',
    label: 'A reference implementation exists; the hard half does not',
  },
  foundation: {
    bar: 'neutral',
    fill: 'var(--text-faint)',
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
          <CeilingTrack item={item} band={band} />
        </span>

        <span className="text-right">
          <span
            className={`block font-mono text-[13px] font-semibold tabular-nums ${band.text}`}
          >
            {item.coverage}%
          </span>
          {/* Our ceiling, not the community's. It is the one that changes what we do next, and on
              four of the eight it is already reached. */}
          <span className="block font-mono text-[10px] tabular-nums text-[var(--text-faint)]">
            of {item.ourCeiling}
            {item.ceilingLocked ? ' 🔒' : ''}
          </span>
        </span>
      </button>

      {open && (
        <div className="pb-4 pl-7 pr-2 space-y-2">
          <p className="text-[12px] text-[var(--text-faint)]">
            <span className="font-mono tabular-nums text-[var(--text-muted)]">
              {item.coverage}%
            </span>{' '}
            now ·{' '}
            <span className="font-mono tabular-nums text-[var(--text-muted)]">
              {item.ourCeiling}%
            </span>{' '}
            is our ceiling ·{' '}
            <span className="font-mono tabular-nums text-[var(--text-muted)]">
              {item.communityCeiling}%
            </span>{' '}
            is the community&apos;s
            {item.ceilingLocked
              ? ' 🔒, and the last stretch of this one is protocol or Foundation policy'
              : ''}
          </p>
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
 * One row's track, in four zones rather than one bar.
 *
 * A single bar answers "how much is done" and hides the question that actually matters here, which
 * is *who has to do the rest*. The tracker has carried two ceilings per item for days and the card
 * showed neither, so a reader saw 42% and had no way to know that 45% is everything The Night's
 * Watch can reach on that item and the remaining 35 points need somebody else entirely.
 *
 *   solid   done
 *   tinted  still ours to do
 *   faint   needs another operator, auditor or counterparty
 *   empty   protocol or Foundation policy, closed to everyone outside
 */
function CeilingTrack({ item, band }: { item: CatalystItem; band: (typeof BAND_META)[CoverageBand] }) {
  const ours = Math.max(item.ourCeiling, item.coverage);
  const community = Math.max(item.communityCeiling, ours);
  return (
    <span
      className="relative block h-1.5 w-full rounded-full bg-[var(--bg-elevated)] overflow-hidden"
      role="img"
      aria-label={`${item.coverage}% done, our ceiling ${item.ourCeiling}%, community ceiling ${item.communityCeiling}%`}
    >
      <span
        className="absolute inset-y-0 left-0 bg-[var(--text-faint)] opacity-25"
        style={{ width: `${community}%` }}
      />
      <span
        className="absolute inset-y-0 left-0 opacity-40"
        style={{ width: `${ours}%`, background: band.fill }}
      />
      <span
        className="absolute inset-y-0 left-0"
        style={{ width: `${item.coverage}%`, background: band.fill }}
      />
      {/* An explicit tick, because where coverage has reached our ceiling the tinted zone has zero
          width and the reader would otherwise see a full-looking bar with nothing marking why. */}
      <span
        className="absolute inset-y-0 w-px bg-[var(--text)] opacity-60"
        style={{ left: `${ours}%` }}
      />
    </span>
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
        {/* The sentence the single number cannot say. We are within a few points of everything
            reachable without becoming a different organisation: one that operates services, buys
            audits and holds an entity. The distance above that is not work outstanding on our side,
            it is other people. */}
        <p className="text-[13px] text-[var(--text-muted)] mb-2">
          <strong className="text-[var(--text)] font-mono tabular-nums">
            {summary.ourCeiling.toFixed(0)}%
          </strong>{' '}
          is the most this can reach without us running services, buying audits or holding a legal
          entity, and{' '}
          <strong className="text-[var(--text)] font-mono tabular-nums">
            {summary.communityCeiling.toFixed(0)}%
          </strong>{' '}
          is the most the community could reach with other people running them. The rest is
          Foundation policy.
        </p>
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

        <div className="mt-3 pt-3 border-t border-[var(--border)] flex flex-wrap gap-x-4 gap-y-1">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-4 h-1.5 rounded-full bg-[var(--green)] shrink-0" />
            <span className="text-[11px] text-[var(--text-faint)]">done</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-4 h-1.5 rounded-full bg-[var(--green)] opacity-40 shrink-0" />
            <span className="text-[11px] text-[var(--text-faint)]">still ours to do</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-4 h-1.5 rounded-full bg-[var(--text-faint)] opacity-25 shrink-0" />
            <span className="text-[11px] text-[var(--text-faint)]">
              needs another operator or counterparty
            </span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-4 h-1.5 rounded-full bg-[var(--bg-elevated)] shrink-0" />
            <span className="text-[11px] text-[var(--text-faint)]">
              Foundation policy · 🔒 marks an item whose last stretch cannot be engineered from
              outside
            </span>
          </span>
        </div>

        <div className="mt-3 pt-3 border-t border-[var(--border)] flex flex-wrap gap-x-4 gap-y-1">
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
