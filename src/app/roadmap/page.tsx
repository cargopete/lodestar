'use client';

import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';
import {
  LAYER_LABELS,
  LAYER_DESCRIPTIONS,
  OFFICIAL_STATUS_LABEL,
  COMMUNITY_STATUS_LABEL,
  type RoadmapLayer,
  type RoadmapItem,
  type OfficialStatus,
  type CommunityStatus,
} from '@/lib/roadmap-data';
import type { CommunityUpdate } from '@/app/api/roadmap/route';

// Quarter ordering for sorting
const QUARTER_ORDER: Record<string, number> = {
  'Q1 2024': 0, 'Q2 2024': 1, 'Q3 2024': 2, 'Q4 2024': 3,
  'Q1 2025': 4, 'Q2 2025': 5, 'Q3 2025': 6, 'Q4 2025': 7,
  'Q1 2026': 8, 'Q2 2026': 9, 'Q3 2026': 10, 'Q4 2026': 11,
};

type RoadmapItemWithCommunity = RoadmapItem & { communityStatus: CommunityUpdate | null };

interface RoadmapResponse {
  items: RoadmapItemWithCommunity[];
}

// ─── Status badge helpers ──────────────────────────────────────────────────

function officialStatusVariant(s: OfficialStatus): 'success' | 'accent' | 'default' | 'warning' {
  if (s === 'shipped') return 'success';
  if (s === 'in_progress') return 'accent';
  if (s === 'experimental') return 'warning';
  return 'default';
}

function communityStatusVariant(s: CommunityStatus): 'success' | 'accent' | 'warning' | 'error' {
  if (s === 'shipped') return 'success';
  if (s === 'on_track') return 'accent';
  if (s === 'uncertain') return 'warning';
  return 'error';
}

const COMMUNITY_STATUS_OPTIONS: { value: CommunityStatus; label: string; description: string }[] = [
  { value: 'on_track', label: 'On Track', description: 'Progressing as expected per the roadmap.' },
  { value: 'delayed', label: 'Delayed', description: 'Behind schedule or no recent progress.' },
  { value: 'shipped', label: 'Shipped', description: 'Live on mainnet / publicly available.' },
  { value: 'uncertain', label: 'Uncertain', description: 'Unclear status, conflicting signals.' },
];

const LAYER_COLORS: Record<RoadmapLayer, string> = {
  product: 'text-[var(--accent)] border-[var(--accent)]',
  protocol: 'text-[var(--green)] border-[var(--green)]',
  economics: 'text-[var(--amber)] border-[var(--amber)]',
};

const LAYER_BG: Record<RoadmapLayer, string> = {
  product: 'bg-[var(--accent)]/8',
  protocol: 'bg-[rgba(0,200,150,0.08)]',
  economics: 'bg-[rgba(255,140,66,0.08)]',
};

// ─── Status update modal ──────────────────────────────────────────────────

interface StatusModalProps {
  item: RoadmapItemWithCommunity;
  onClose: () => void;
}

function StatusModal({ item, onClose }: StatusModalProps) {
  const queryClient = useQueryClient();
  const [selectedStatus, setSelectedStatus] = useState<CommunityStatus | null>(null);
  const [note, setNote] = useState('');
  const [submittedBy, setSubmittedBy] = useState('');
  const [success, setSuccess] = useState(false);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/roadmap/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: item.id,
          status: selectedStatus,
          note: note || undefined,
          submittedBy: submittedBy || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Submission failed');
      }
    },
    onSuccess: () => {
      setSuccess(true);
      queryClient.invalidateQueries({ queryKey: ['roadmap'] });
      setTimeout(onClose, 1500);
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-md bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl shadow-xl p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.06em] text-[var(--text-muted)] mb-1">Community Update</p>
            <h3 className="text-base font-semibold text-[var(--text)]">{item.title}</h3>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--text-faint)] hover:text-[var(--text)] transition-colors ml-4 flex-shrink-0"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {success ? (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <div className="w-12 h-12 rounded-full bg-[rgba(0,200,150,0.15)] flex items-center justify-center">
              <svg className="w-6 h-6 text-[var(--green)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-sm font-medium text-[var(--green)]">Status submitted — cheers!</p>
          </div>
        ) : (
          <>
            <p className="text-[12px] text-[var(--text-muted)] mb-4">
              What&apos;s the community&apos;s read on this item? Your update helps everyone track real progress.
            </p>

            {/* Status options */}
            <div className="grid grid-cols-2 gap-2 mb-4">
              {COMMUNITY_STATUS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setSelectedStatus(opt.value)}
                  className={cn(
                    'p-3 rounded-lg border text-left transition-all',
                    selectedStatus === opt.value
                      ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                      : 'border-[var(--border)] hover:border-[var(--border-active)]'
                  )}
                >
                  <p className={cn(
                    'text-[12px] font-semibold',
                    selectedStatus === opt.value ? 'text-[var(--accent)]' : 'text-[var(--text)]'
                  )}>
                    {opt.label}
                  </p>
                  <p className="text-[10px] text-[var(--text-faint)] mt-0.5 leading-tight">{opt.description}</p>
                </button>
              ))}
            </div>

            {/* Note */}
            <div className="mb-3">
              <label className="block text-[11px] text-[var(--text-muted)] mb-1.5">
                Note <span className="text-[var(--text-faint)]">(optional, max 500 chars)</span>
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 500))}
                placeholder="Why do you think this? Forum post, tweet, dev update..."
                rows={2}
                className={cn(
                  'w-full px-3 py-2 text-sm rounded-lg',
                  'bg-[var(--bg-elevated)] border border-[var(--border)]',
                  'text-[var(--text)] placeholder:text-[var(--text-faint)]',
                  'focus:outline-none focus:border-[var(--accent)] resize-none'
                )}
              />
              {note.length > 0 && (
                <p className="text-[10px] text-[var(--text-faint)] mt-1 text-right">{note.length}/500</p>
              )}
            </div>

            {/* Name */}
            <div className="mb-5">
              <label className="block text-[11px] text-[var(--text-muted)] mb-1.5">
                Your name / handle <span className="text-[var(--text-faint)]">(optional)</span>
              </label>
              <input
                type="text"
                value={submittedBy}
                onChange={(e) => setSubmittedBy(e.target.value.slice(0, 100))}
                placeholder="anon"
                className={cn(
                  'w-full px-3 py-2 text-sm rounded-lg',
                  'bg-[var(--bg-elevated)] border border-[var(--border)]',
                  'text-[var(--text)] placeholder:text-[var(--text-faint)]',
                  'focus:outline-none focus:border-[var(--accent)]'
                )}
              />
            </div>

            {mutation.isError && (
              <p className="text-[12px] text-[var(--red)] mb-3">
                {(mutation.error as Error).message}
              </p>
            )}

            <button
              onClick={() => mutation.mutate()}
              disabled={!selectedStatus || mutation.isPending}
              className={cn(
                'w-full py-2.5 text-sm font-semibold rounded-lg transition-opacity',
                'bg-[var(--accent)] text-white',
                (!selectedStatus || mutation.isPending) ? 'opacity-40 cursor-not-allowed' : 'hover:opacity-90'
              )}
            >
              {mutation.isPending ? 'Submitting...' : 'Submit Update'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Roadmap item card ────────────────────────────────────────────────────

interface ItemCardProps {
  item: RoadmapItemWithCommunity;
  onUpdate: (item: RoadmapItemWithCommunity) => void;
}

function ItemCard({ item, onUpdate }: ItemCardProps) {
  const hasRange = !!item.quarterEnd && item.quarterEnd !== item.quarterStart;
  const community = item.communityStatus;

  return (
    <div className={cn(
      'p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]',
      'hover:border-[var(--border-active)] transition-colors'
    )}>
      {/* Quarter + official status */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="text-[10px] font-mono text-[var(--text-faint)] bg-[var(--bg-elevated)] px-1.5 py-0.5 rounded flex-shrink-0">
          {hasRange ? `${item.quarterStart} → ${item.quarterEnd}` : item.quarterStart}
        </span>
        <Badge variant={officialStatusVariant(item.officialStatus)}>
          {OFFICIAL_STATUS_LABEL[item.officialStatus]}
        </Badge>
      </div>

      {/* Title */}
      <p className="text-sm font-semibold text-[var(--text)] mb-1 leading-snug">{item.title}</p>

      {/* Description */}
      <p className="text-[11px] text-[var(--text-muted)] leading-relaxed mb-3 line-clamp-2">
        {item.description}
      </p>

      {/* Tags */}
      {item.tags && item.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {item.tags.map((tag) => (
            <span
              key={tag}
              className="px-1.5 py-0.5 text-[10px] rounded bg-[var(--bg-elevated)] text-[var(--text-faint)] font-mono"
            >
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

      {/* Separator */}
      <div className="border-t border-[var(--border-mid)] my-3" />

      {/* Community status */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          {community ? (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] uppercase tracking-[0.06em] text-[var(--text-faint)]">Community:</span>
              <Badge variant={communityStatusVariant(community.status)}>
                {COMMUNITY_STATUS_LABEL[community.status]}
              </Badge>
              {community.note && (
                <p className="text-[10px] text-[var(--text-muted)] truncate max-w-[160px]" title={community.note}>
                  &ldquo;{community.note}&rdquo;
                </p>
              )}
            </div>
          ) : (
            <span className="text-[10px] text-[var(--text-faint)] italic">No community assessment yet</span>
          )}
        </div>
        <button
          onClick={() => onUpdate(item)}
          className={cn(
            'flex-shrink-0 px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors',
            'bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent)]/10'
          )}
        >
          Update
        </button>
      </div>

      {/* Submitted by + date */}
      {community && (
        <p className="text-[10px] text-[var(--text-faint)] mt-1.5 font-mono">
          by {community.submitted_by || 'anon'} · {new Date(community.created_at).toLocaleDateString()}
        </p>
      )}
    </div>
  );
}

// ─── Layer section ────────────────────────────────────────────────────────

interface LayerSectionProps {
  layer: RoadmapLayer;
  items: RoadmapItemWithCommunity[];
  onUpdate: (item: RoadmapItemWithCommunity) => void;
  activeFilter: OfficialStatus | null;
}

function LayerSection({ layer, items, onUpdate, activeFilter }: LayerSectionProps) {
  const filtered = activeFilter ? items.filter((i) => i.officialStatus === activeFilter) : items;
  const sorted = [...filtered].sort(
    (a, b) => (QUARTER_ORDER[a.quarterStart] ?? 99) - (QUARTER_ORDER[b.quarterStart] ?? 99)
  );

  if (sorted.length === 0) return null;

  return (
    <section>
      <div className={cn(
        'flex items-start gap-3 p-4 rounded-xl border mb-4',
        LAYER_BG[layer]
      )}>
        <div className={cn('w-1 self-stretch rounded-full flex-shrink-0', {
          'bg-[var(--accent)]': layer === 'product',
          'bg-[var(--green)]': layer === 'protocol',
          'bg-[var(--amber)]': layer === 'economics',
        })} />
        <div>
          <h2 className={cn('text-base font-bold', LAYER_COLORS[layer])}>
            {LAYER_LABELS[layer]}
          </h2>
          <p className="text-[12px] text-[var(--text-muted)] mt-0.5">{LAYER_DESCRIPTIONS[layer]}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {sorted.map((item) => (
          <ItemCard key={item.id} item={item} onUpdate={onUpdate} />
        ))}
      </div>
    </section>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────

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
  const [modalItem, setModalItem] = useState<RoadmapItemWithCommunity | null>(null);

  const { data, isLoading } = useQuery<RoadmapResponse>({
    queryKey: ['roadmap'],
    queryFn: async () => {
      const res = await fetch('/api/roadmap');
      if (!res.ok) throw new Error('Failed to load roadmap');
      return res.json();
    },
    staleTime: 60 * 1000,
  });

  const byLayer = useMemo(() => {
    const items = data?.items ?? [];
    const map: Record<RoadmapLayer, RoadmapItemWithCommunity[]> = {
      product: [], protocol: [], economics: [],
    };
    for (const item of items) {
      map[item.layer].push(item);
    }
    return map;
  }, [data]);

  const communityCount = useMemo(
    () => (data?.items ?? []).filter((i) => i.communityStatus !== null).length,
    [data]
  );

  return (
    <div className="space-y-10">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-3">
          <h1 className="text-2xl font-bold text-[var(--text)]">Graph Protocol Roadmap</h1>
          <Badge variant="accent">Community Tracker</Badge>
        </div>
        <p className="text-sm text-[var(--text-muted)] max-w-2xl">
          Official roadmap items from{' '}
          <a
            href="https://thegraph.com/roadmap/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--accent)] hover:underline"
          >
            thegraph.com/roadmap
          </a>
          {' '}with community-sourced status assessments. The foundation updates the roadmap page approximately quarterly — the community updates this daily.
        </p>
        <div className="flex items-center gap-4 mt-3 text-[12px] text-[var(--text-faint)]">
          <span>{data?.items.length ?? '—'} items tracked</span>
          <span>·</span>
          <span>{communityCount} community assessments</span>
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

      {/* Legend */}
      <div className="flex flex-wrap gap-x-6 gap-y-2 p-4 rounded-lg bg-[var(--bg-elevated)] text-[11px] text-[var(--text-muted)]">
        <span className="font-semibold uppercase tracking-wider">Official status:</span>
        {(['shipped', 'in_progress', 'planned', 'experimental'] as OfficialStatus[]).map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <Badge variant={officialStatusVariant(s)}>{OFFICIAL_STATUS_LABEL[s]}</Badge>
            <span className="text-[var(--text-faint)]">= foundation</span>
          </span>
        ))}
        <span className="w-full sm:w-auto sm:border-l sm:border-[var(--border)] sm:pl-6 font-semibold uppercase tracking-wider">Community:</span>
        {(['on_track', 'delayed', 'shipped', 'uncertain'] as CommunityStatus[]).map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <Badge variant={communityStatusVariant(s)}>{COMMUNITY_STATUS_LABEL[s]}</Badge>
          </span>
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
          onUpdate={setModalItem}
          activeFilter={activeFilter}
        />
      ))}

      {/* Disclaimer */}
      {!isLoading && (
        <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] text-[11px] text-[var(--text-faint)]">
          Community assessments reflect the collective view of The Graph community — not official positions of The Graph Foundation or Edge & Node.
          Roadmap data is sourced from{' '}
          <a
            href="https://thegraph.com/roadmap/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--accent)] hover:underline"
          >
            thegraph.com/roadmap
          </a>
          {' '}and updated manually by Lodestar maintainers. Last seeded: Q1 2026.
        </div>
      )}

      {/* Status update modal */}
      {modalItem && (
        <StatusModal
          item={modalItem}
          onClose={() => setModalItem(null)}
        />
      )}
    </div>
  );
}
