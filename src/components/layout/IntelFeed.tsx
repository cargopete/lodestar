'use client';

import { useState, useEffect } from 'react';
import { useFeed } from '@/hooks/useFeed';
import { FeedCard } from '@/components/feed/FeedCard';
import { FilterBar } from '@/components/feed/FilterBar';
import { cn } from '@/lib/utils';
import { FEED_TYPE_CONFIG, timeAgo } from '@/lib/feed';
import type { FeedItem, FeedItemType } from '@/lib/feed';

export function IntelFeed() {
  const { data: items, isLoading } = useFeed();
  const [filter, setFilter] = useState<FeedItemType | 'all'>('all');
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const filtered = items?.filter((item) =>
    filter === 'all' ? true : item.type === filter
  ) ?? [];

  // Sync the active feed width CSS variable so layout + topbar respond
  useEffect(() => {
    document.documentElement.style.setProperty(
      '--feed-active-width',
      collapsed ? 'var(--feed-width-collapsed)' : 'var(--feed-width)'
    );
  }, [collapsed]);

  return (
    <>
      {/* ── Desktop panel ── */}
      <aside
        className={cn(
          'hidden lg:flex fixed right-0 top-[var(--topbar-height)] bottom-0 z-20 flex-col',
          'bg-[var(--bg-surface)] border-l border-[var(--border)] transition-all duration-200',
          collapsed ? 'w-[var(--feed-width-collapsed)]' : 'w-[var(--feed-width)]'
        )}
      >
        {collapsed ? (
          /* Collapsed strip with mini previews */
          <div className="flex flex-col h-full">
            {/* Expand button */}
            <button
              onClick={() => setCollapsed(false)}
              className="flex items-center justify-center py-2.5 border-b border-[var(--border)] hover:bg-[var(--bg-elevated)] transition-colors flex-shrink-0"
              title="Expand Intel Feed"
            >
              <svg className="w-3.5 h-3.5 text-[var(--text-faint)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            {/* Mini preview items */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden py-1.5 space-y-1 scrollbar-none">
              {(items ?? []).slice(0, 20).map((item) => {
                const config = FEED_TYPE_CONFIG[item.type];
                const isEpoch = item.type === 'epoch';
                const delta = parseFloat(item.metadata.rewardsDelta ?? '0');
                const color = isEpoch
                  ? delta >= 0 ? 'var(--green)' : 'var(--red)'
                  : config.borderColor;

                return (
                  <button
                    key={item.id}
                    onClick={() => setCollapsed(false)}
                    className="w-full px-1.5 group"
                    title={item.title}
                  >
                    <div
                      className="rounded border-l-2 bg-[var(--bg-elevated)] group-hover:bg-[color-mix(in_srgb,var(--bg-elevated)_85%,var(--accent)_15%)] transition-colors px-1.5 py-1.5"
                      style={{ borderLeftColor: color }}
                    >
                      <span
                        className="block text-[8px] font-bold uppercase tracking-wider leading-none mb-0.5"
                        style={{ color }}
                      >
                        {config.label.slice(0, 3)}
                      </span>
                      <span className="block text-[9px] text-[var(--text-muted)] leading-tight truncate">
                        {timeAgo(item.timestamp)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
              <h2 className="text-[13px] font-semibold text-[var(--text)] tracking-tight">
                Intel Feed
              </h2>
              <button
                onClick={() => setCollapsed(true)}
                className="p-1 rounded hover:bg-[var(--bg-elevated)] transition-colors"
                title="Collapse"
              >
                <svg className="w-4 h-4 text-[var(--text-faint)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>

            {/* Filters */}
            <div className="px-4 py-2 border-b border-[var(--border)]">
              <FilterBar active={filter} onChange={setFilter} />
            </div>

            {/* Feed content */}
            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
              <FeedContent items={filtered} isLoading={isLoading} />
            </div>
          </>
        )}
      </aside>

      {/* ── Mobile FAB ── */}
      <button
        onClick={() => setMobileOpen(true)}
        className={cn(
          'lg:hidden fixed right-4 z-40 w-12 h-12 rounded-full',
          'bg-[var(--accent)] text-white shadow-lg',
          'flex items-center justify-center',
          'hover:opacity-90 transition-opacity',
          'bottom-[calc(var(--bottom-nav-height)+var(--safe-bottom)+16px)]',
          'md:bottom-6'
        )}
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 01-2.25 2.25M16.5 7.5V18a2.25 2.25 0 002.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 002.25 2.25h13.5" />
        </svg>
      </button>

      {/* ── Mobile drawer ── */}
      {mobileOpen && (
        <>
          {/* Backdrop */}
          <div
            className="lg:hidden fixed inset-0 bg-black/50 z-50"
            onClick={() => setMobileOpen(false)}
          />

          {/* Drawer */}
          <div className="lg:hidden fixed bottom-0 left-0 right-0 z-50 max-h-[85vh] bg-[var(--bg-surface)] rounded-t-2xl border-t border-[var(--border)] flex flex-col animate-slide-up">
            {/* Handle */}
            <div className="flex justify-center py-2">
              <div className="w-10 h-1 rounded-full bg-[var(--text-faint)]" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-4 pb-2">
              <h2 className="text-[15px] font-semibold text-[var(--text)]">
                Intel Feed
              </h2>
              <button
                onClick={() => setMobileOpen(false)}
                className="p-2 rounded-lg hover:bg-[var(--bg-elevated)] transition-colors"
              >
                <svg className="w-5 h-5 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Filters */}
            <div className="px-4 pb-2">
              <FilterBar active={filter} onChange={setFilter} />
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2 pb-[env(safe-area-inset-bottom,16px)]">
              <FeedContent items={filtered} isLoading={isLoading} />
            </div>
          </div>
        </>
      )}
    </>
  );
}

function FeedContent({
  items,
  isLoading,
}: {
  items: FeedItem[];
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <>
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-20 animate-pulse rounded-lg bg-[var(--bg-elevated)]"
          />
        ))}
      </>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-[var(--text-muted)]">No items</p>
      </div>
    );
  }

  return (
    <>
      {items.map((item) => (
        <FeedCard key={item.id} item={item} />
      ))}
    </>
  );
}
