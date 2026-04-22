'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';
import {
  ROADMAP_ITEMS,
  ROADMAP_LAST_UPDATED,
  LAYER_LABELS,
  LAYER_DESCRIPTIONS,
  OFFICIAL_STATUS_LABEL,
  LODESTAR_STATUS_LABEL,
  type RoadmapLayer,
  type RoadmapItem,
  type OfficialStatus,
  type LodestarStatus,
} from '@/lib/roadmap-data';

const QUARTER_ORDER: Record<string, number> = {
  'Q1 2024': 0, 'Q2 2024': 1, 'Q3 2024': 2, 'Q4 2024': 3,
  'Q1 2025': 4, 'Q2 2025': 5, 'Q3 2025': 6, 'Q4 2025': 7,
  'Q1 2026': 8, 'Q2 2026': 9, 'Q3 2026': 10, 'Q4 2026': 11,
};

function officialStatusVariant(s: OfficialStatus): 'success' | 'accent' | 'default' | 'warning' {
  if (s === 'shipped') return 'success';
  if (s === 'in_progress') return 'accent';
  if (s === 'experimental') return 'warning';
  return 'default';
}

function lodestarStatusVariant(s: LodestarStatus): 'success' | 'accent' | 'warning' | 'error' {
  if (s === 'shipped') return 'success';
  if (s === 'on_track') return 'accent';
  if (s === 'uncertain') return 'warning';
  return 'error';
}

const LAYER_BG: Record<RoadmapLayer, string> = {
  product: 'bg-[var(--accent)]/8',
  protocol: 'bg-[rgba(0,200,150,0.08)]',
  economics: 'bg-[rgba(255,140,66,0.08)]',
};

const LAYER_ACCENT: Record<RoadmapLayer, string> = {
  product: 'bg-[var(--accent)]',
  protocol: 'bg-[var(--green)]',
  economics: 'bg-[var(--amber)]',
};

const LAYER_TEXT: Record<RoadmapLayer, string> = {
  product: 'text-[var(--accent)]',
  protocol: 'text-[var(--green)]',
  economics: 'text-[var(--amber)]',
};

// ─── Detail drawer ────────────────────────────────────────────────────────

function DetailDrawer({ item, onClose }: { item: RoadmapItem; onClose: () => void }) {
  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const hasRange = !!item.quarterEnd && item.quarterEnd !== item.quarterStart;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-lg bg-[var(--bg-surface)] border-l border-[var(--border)] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-[var(--border)] flex-shrink-0">
          <div className="min-w-0 pr-4">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <span className={cn(
                'text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border',
                LAYER_TEXT[item.layer], {
                  'border-[var(--accent)]': item.layer === 'product',
                  'border-[var(--green)]': item.layer === 'protocol',
                  'border-[var(--amber)]': item.layer === 'economics',
                }
              )}>
                {LAYER_LABELS[item.layer]}
              </span>
              <span className="text-[10px] font-mono text-[var(--text-faint)] bg-[var(--bg-elevated)] px-1.5 py-0.5 rounded">
                {hasRange ? `${item.quarterStart} → ${item.quarterEnd}` : item.quarterStart}
              </span>
            </div>
            <h2 className="text-base font-bold text-[var(--text)] leading-snug">{item.title}</h2>
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 text-[var(--text-faint)] hover:text-[var(--text)] transition-colors mt-0.5"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* Status row */}
          <div className="flex flex-wrap gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.06em] text-[var(--text-faint)] mb-1">Official</p>
              <Badge variant={officialStatusVariant(item.officialStatus)}>
                {OFFICIAL_STATUS_LABEL[item.officialStatus]}
              </Badge>
            </div>
            {item.lodestarStatus && (
              <div>
                <p className="text-[10px] uppercase tracking-[0.06em] text-[var(--text-faint)] mb-1">Lodestar</p>
                <Badge variant={lodestarStatusVariant(item.lodestarStatus)}>
                  {LODESTAR_STATUS_LABEL[item.lodestarStatus]}
                </Badge>
              </div>
            )}
            {item.gipId && (
              <div>
                <p className="text-[10px] uppercase tracking-[0.06em] text-[var(--text-faint)] mb-1">GIP</p>
                <span className="text-[12px] font-mono font-semibold text-[var(--accent)]">{item.gipId}</span>
              </div>
            )}
          </div>

          {/* Lodestar note */}
          {item.lodestarNote && (
            <div className="p-3 rounded-lg bg-[var(--bg-elevated)] border-l-2 border-[var(--accent)]">
              <p className="text-[10px] uppercase tracking-[0.06em] text-[var(--accent)] mb-1">Lodestar Assessment</p>
              <p className="text-[12px] text-[var(--text-muted)] leading-relaxed">{item.lodestarNote}</p>
            </div>
          )}

          {/* Description */}
          <div>
            <p className="text-[10px] uppercase tracking-[0.06em] text-[var(--text-faint)] mb-2">Overview</p>
            <p className="text-sm text-[var(--text-muted)] leading-relaxed">
              {item.detail || item.description}
            </p>
          </div>

          {/* Indexer impact */}
          {item.indexerImpact && (
            <div className="p-4 rounded-lg bg-[rgba(0,200,150,0.06)] border border-[var(--green)]/30">
              <p className="text-[10px] uppercase tracking-[0.06em] text-[var(--green)] mb-2 flex items-center gap-1.5">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
                </svg>
                Indexer Impact
              </p>
              <p className="text-[12px] text-[var(--text-muted)] leading-relaxed">{item.indexerImpact}</p>
            </div>
          )}

          {/* Delegator impact */}
          {item.delegatorImpact && (
            <div className="p-4 rounded-lg bg-[var(--accent)]/6 border border-[var(--accent)]/30">
              <p className="text-[10px] uppercase tracking-[0.06em] text-[var(--accent)] mb-2 flex items-center gap-1.5">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Delegator Impact
              </p>
              <p className="text-[12px] text-[var(--text-muted)] leading-relaxed">{item.delegatorImpact}</p>
            </div>
          )}

          {/* Tags */}
          {item.tags && item.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {item.tags.map((tag) => (
                <span key={tag} className="px-2 py-1 text-[10px] rounded-full bg-[var(--bg-elevated)] text-[var(--text-faint)] font-mono">
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Links */}
          {item.links && item.links.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-[0.06em] text-[var(--text-faint)] mb-2">Links</p>
              <div className="space-y-1.5">
                {item.links.map((link) => (
                  <a
                    key={link.url}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-[12px] text-[var(--accent)] hover:underline"
                  >
                    <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                    {link.label}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Item card ────────────────────────────────────────────────────────────

function ItemCard({ item, onClick }: { item: RoadmapItem; onClick: () => void }) {
  const hasRange = !!item.quarterEnd && item.quarterEnd !== item.quarterStart;
  const hasDetail = !!(item.detail || item.indexerImpact || item.delegatorImpact || (item.links?.length));

  return (
    <button
      onClick={hasDetail ? onClick : undefined}
      className={cn(
        'w-full text-left p-4 rounded-lg border bg-[var(--bg-surface)] flex flex-col gap-3 transition-all',
        hasDetail
          ? 'border-[var(--border)] hover:border-[var(--accent)]/50 hover:shadow-md cursor-pointer'
          : 'border-[var(--border)] cursor-default'
      )}
    >
      {/* Quarter + status */}
      <div className="flex items-start justify-between gap-2">
        <span className="text-[10px] font-mono text-[var(--text-faint)] bg-[var(--bg-elevated)] px-1.5 py-0.5 rounded flex-shrink-0">
          {hasRange ? `${item.quarterStart} → ${item.quarterEnd}` : item.quarterStart}
        </span>
        <Badge variant={officialStatusVariant(item.officialStatus)}>
          {OFFICIAL_STATUS_LABEL[item.officialStatus]}
        </Badge>
      </div>

      {/* Title */}
      <p className="text-sm font-semibold text-[var(--text)] leading-snug">{item.title}</p>

      {/* Description */}
      <p className="text-[11px] text-[var(--text-muted)] leading-relaxed line-clamp-2 flex-1">
        {item.description}
      </p>

      {/* Tags */}
      {item.tags && item.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {item.tags.map((tag) => (
            <span key={tag} className="px-1.5 py-0.5 text-[10px] rounded bg-[var(--bg-elevated)] text-[var(--text-faint)] font-mono">
              {tag}
            </span>
          ))}
          {item.gipId && (
            <span className="px-1.5 py-0.5 text-[10px] rounded bg-[var(--accent)]/10 text-[var(--accent)] font-mono">
              {item.gipId}
            </span>
          )}
        </div>
      )}

      {/* Lodestar status + expand hint */}
      <div className="flex items-center justify-between gap-2 pt-1 border-t border-[var(--border-mid)]">
        <div>
          {item.lodestarStatus ? (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-[0.06em] text-[var(--text-faint)]">Lodestar:</span>
              <Badge variant={lodestarStatusVariant(item.lodestarStatus)}>
                {LODESTAR_STATUS_LABEL[item.lodestarStatus]}
              </Badge>
            </div>
          ) : (
            <span className="text-[10px] text-[var(--text-faint)] italic">No assessment yet</span>
          )}
        </div>
        {hasDetail && (
          <svg className="w-4 h-4 text-[var(--text-faint)] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
        )}
      </div>
    </button>
  );
}

// ─── Layer section ────────────────────────────────────────────────────────

function LayerSection({
  layer, items, activeFilter, lodestarFilter, onSelect,
}: {
  layer: RoadmapLayer;
  items: RoadmapItem[];
  activeFilter: OfficialStatus | null;
  lodestarFilter: LodestarStatus | null;
  onSelect: (item: RoadmapItem) => void;
}) {
  const filtered = items.filter((i) => {
    if (activeFilter && i.officialStatus !== activeFilter) return false;
    if (lodestarFilter && i.lodestarStatus !== lodestarFilter) return false;
    return true;
  });
  const sorted = [...filtered].sort(
    (a, b) => (QUARTER_ORDER[a.quarterStart] ?? 99) - (QUARTER_ORDER[b.quarterStart] ?? 99)
  );
  if (sorted.length === 0) return null;

  return (
    <section>
      <div className={cn('flex items-start gap-3 p-4 rounded-xl border border-[var(--border)] mb-4', LAYER_BG[layer])}>
        <div className={cn('w-1 self-stretch rounded-full flex-shrink-0', LAYER_ACCENT[layer])} />
        <div>
          <h2 className={cn('text-base font-bold', LAYER_TEXT[layer])}>{LAYER_LABELS[layer]}</h2>
          <p className="text-[12px] text-[var(--text-muted)] mt-0.5">{LAYER_DESCRIPTIONS[layer]}</p>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {sorted.map((item) => (
          <ItemCard key={item.id} item={item} onClick={() => onSelect(item)} />
        ))}
      </div>
    </section>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────

const LAYERS: RoadmapLayer[] = ['product', 'protocol', 'economics'];

const FILTER_OPTIONS: { value: OfficialStatus | null; label: string }[] = [
  { value: null, label: 'All' },
  { value: 'shipped', label: 'Shipped' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'planned', label: 'Planned' },
  { value: 'experimental', label: 'Experimental' },
];

const LODESTAR_FILTER_OPTIONS: { value: LodestarStatus | null; label: string }[] = [
  { value: null, label: 'All' },
  { value: 'shipped', label: 'Shipped' },
  { value: 'on_track', label: 'On Track' },
  { value: 'delayed', label: 'Delayed' },
  { value: 'uncertain', label: 'Uncertain' },
];

export default function RoadmapPage() {
  const [activeFilter, setActiveFilter] = useState<OfficialStatus | null>(null);
  const [lodestarFilter, setLodestarFilter] = useState<LodestarStatus | null>(null);
  const [selected, setSelected] = useState<RoadmapItem | null>(null);

  // Close drawer on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelected(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const byLayer = useMemo(() => {
    const map: Record<RoadmapLayer, RoadmapItem[]> = { product: [], protocol: [], economics: [] };
    for (const item of ROADMAP_ITEMS) map[item.layer].push(item);
    return map;
  }, []);

  const shippedCount = ROADMAP_ITEMS.filter((i) => i.officialStatus === 'shipped').length;
  const delayedCount = ROADMAP_ITEMS.filter((i) => i.lodestarStatus === 'delayed').length;

  return (
    <div className="space-y-10">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-3">
          <h1 className="text-2xl font-bold text-[var(--text)]">Graph Protocol Roadmap</h1>
        </div>
        <p className="text-sm text-[var(--text-muted)] max-w-2xl">
          Protocol, product, and economics milestones from{' '}
          <a href="https://thegraph.com/roadmap/" target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline">
            thegraph.com/roadmap
          </a>
          {' '}with Lodestar&apos;s independent assessment. Click any item for detail.
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-[12px] text-[var(--text-faint)]">
          <span>{ROADMAP_ITEMS.length} items tracked</span>
          <span>·</span>
          <span className="text-[var(--green)]">{shippedCount} shipped</span>
          {delayedCount > 0 && (
            <>
              <span>·</span>
              <span className="text-[var(--red)]">{delayedCount} flagged delayed</span>
            </>
          )}
          <span>·</span>
          <span>Last updated {ROADMAP_LAST_UPDATED}</span>
        </div>
      </div>

      {/* Filter bars */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] w-14 flex-shrink-0">Official</span>
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value ?? 'all'}
              onClick={() => setActiveFilter(activeFilter === opt.value ? null : opt.value)}
              className={cn(
                'px-3 py-1.5 text-[12px] font-medium rounded-full border transition-all',
                activeFilter === opt.value
                  ? 'bg-[var(--accent)] border-[var(--accent)] text-white'
                  : 'border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] w-14 flex-shrink-0">Lodestar</span>
          {LODESTAR_FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value ?? 'all'}
              onClick={() => setLodestarFilter(lodestarFilter === opt.value ? null : opt.value)}
              className={cn(
                'px-3 py-1.5 text-[12px] font-medium rounded-full border transition-all',
                lodestarFilter === opt.value
                  ? 'bg-[var(--accent)] border-[var(--accent)] text-white'
                  : 'border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Layers */}
      {LAYERS.map((layer) => (
        <LayerSection
          key={layer}
          layer={layer}
          items={byLayer[layer]}
          activeFilter={activeFilter}
          lodestarFilter={lodestarFilter}
          onSelect={setSelected}
        />
      ))}

      {/* Disclaimer */}
      <p className="text-[11px] text-[var(--text-faint)]">
        Roadmap data sourced from{' '}
        <a href="https://thegraph.com/roadmap/" target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline">
          thegraph.com/roadmap
        </a>
        . Lodestar assessments are independent views — not official positions of The Graph Foundation.
      </p>

      {/* Detail drawer */}
      {selected && (
        <DetailDrawer item={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
