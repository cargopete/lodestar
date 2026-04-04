'use client';

import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';
import {
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
  return 'error'; // delayed
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

// ─── Item card ────────────────────────────────────────────────────────────

function ItemCard({ item }: { item: RoadmapItem }) {
  const hasRange = !!item.quarterEnd && item.quarterEnd !== item.quarterStart;

  return (
    <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] flex flex-col gap-3">
      {/* Quarter range */}
      <div className="flex items-start justify-between gap-2">
        <span className="text-[10px] font-mono text-[var(--text-faint)] bg-[var(--bg-elevated)] px-1.5 py-0.5 rounded flex-shrink-0">
          {hasRange ? `${item.quarterStart} → ${item.quarterEnd}` : item.quarterStart}
        </span>
        <Badge variant={officialStatusVariant(item.officialStatus)}>
          {OFFICIAL_STATUS_LABEL[item.officialStatus]}
        </Badge>
      </div>

      {/* Title + description */}
      <div>
        <p className="text-sm font-semibold text-[var(--text)] leading-snug mb-1">{item.title}</p>
        <p className="text-[11px] text-[var(--text-muted)] leading-relaxed line-clamp-2">
          {item.description}
        </p>
      </div>

      {/* Tags + GIP */}
      {(item.tags?.length || item.gipId) && (
        <div className="flex flex-wrap gap-1">
          {item.tags?.map((tag) => (
            <span key={tag} className="px-1.5 py-0.5 text-[10px] rounded bg-[var(--bg-elevated)] text-[var(--text-faint)] font-mono">
              {tag}
            </span>
          ))}
          {item.gipId && (
            item.forumUrl ? (
              <a
                href={item.forumUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-1.5 py-0.5 text-[10px] rounded bg-[var(--accent)]/10 text-[var(--accent)] font-mono hover:underline"
              >
                {item.gipId}
              </a>
            ) : (
              <span className="px-1.5 py-0.5 text-[10px] rounded bg-[var(--accent)]/10 text-[var(--accent)] font-mono">
                {item.gipId}
              </span>
            )
          )}
        </div>
      )}

      {/* Lodestar status */}
      {item.lodestarStatus && (
        <div className="border-t border-[var(--border-mid)] pt-3">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] uppercase tracking-[0.06em] text-[var(--text-faint)]">Lodestar:</span>
            <Badge variant={lodestarStatusVariant(item.lodestarStatus)}>
              {LODESTAR_STATUS_LABEL[item.lodestarStatus]}
            </Badge>
            {item.lodestarNote && (
              <p className="text-[10px] text-[var(--text-muted)] w-full mt-0.5">{item.lodestarNote}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Layer section ────────────────────────────────────────────────────────

interface LayerSectionProps {
  layer: RoadmapLayer;
  items: RoadmapItem[];
  activeFilter: OfficialStatus | null;
}

function LayerSection({ layer, items, activeFilter }: LayerSectionProps) {
  const filtered = activeFilter ? items.filter((i) => i.officialStatus === activeFilter) : items;
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
          <ItemCard key={item.id} item={item} />
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

export default function RoadmapPage() {
  const [activeFilter, setActiveFilter] = useState<OfficialStatus | null>(null);

  const { data, isLoading } = useQuery<{ items: RoadmapItem[] }>({
    queryKey: ['roadmap'],
    queryFn: async () => {
      const res = await fetch('/api/roadmap');
      if (!res.ok) throw new Error('Failed to load roadmap');
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const byLayer = useMemo(() => {
    const map: Record<RoadmapLayer, RoadmapItem[]> = { product: [], protocol: [], economics: [] };
    for (const item of data?.items ?? []) map[item.layer].push(item);
    return map;
  }, [data]);

  const shippedCount = useMemo(
    () => (data?.items ?? []).filter((i) => i.officialStatus === 'shipped').length,
    [data]
  );

  return (
    <div className="space-y-10">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-3">
          <h1 className="text-2xl font-bold text-[var(--text)]">Graph Protocol Roadmap</h1>
        </div>
        <p className="text-sm text-[var(--text-muted)] max-w-2xl">
          Protocol, product, and economics milestones from{' '}
          <a
            href="https://thegraph.com/roadmap/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--accent)] hover:underline"
          >
            thegraph.com/roadmap
          </a>
          {' '}— with Lodestar&apos;s read on actual progress.
        </p>
        <div className="flex items-center gap-4 mt-3 text-[12px] text-[var(--text-faint)]">
          <span>{data?.items.length ?? '—'} items tracked</span>
          <span>·</span>
          <span>{shippedCount} shipped</span>
          <span>·</span>
          <span>Last updated Q1 2026</span>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2">
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.value ?? 'all'}
            onClick={() => setActiveFilter(opt.value)}
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

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-24">
          <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Layers */}
      {!isLoading && LAYERS.map((layer) => (
        <LayerSection
          key={layer}
          layer={layer}
          items={byLayer[layer]}
          activeFilter={activeFilter}
        />
      ))}

      {/* Disclaimer */}
      {!isLoading && (
        <p className="text-[11px] text-[var(--text-faint)]">
          Roadmap data sourced from{' '}
          <a href="https://thegraph.com/roadmap/" target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline">
            thegraph.com/roadmap
          </a>
          . &ldquo;Lodestar&rdquo; status reflects independent assessment — not an official position of The Graph Foundation.
        </p>
      )}
    </div>
  );
}
