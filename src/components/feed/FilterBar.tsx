'use client';

import { cn } from '@/lib/utils';
import type { FeedItemType } from '@/lib/feed';

const FILTERS: { label: string; value: FeedItemType | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'GIPs', value: 'gip' },
  { label: 'Votes', value: 'vote' },
  { label: 'Epochs', value: 'epoch' },
  { label: 'News', value: 'news' },
  { label: 'Issues', value: 'issue' },
  { label: 'PRs', value: 'pr' },
  { label: 'Releases', value: 'release' },
];

interface FilterBarProps {
  active: FeedItemType | 'all';
  onChange: (filter: FeedItemType | 'all') => void;
}

export function FilterBar({ active, onChange }: FilterBarProps) {
  return (
    // Wraps rather than scrolls. In a rail this narrow the last three filters
    // (Issues, PRs, Releases) fell off the right edge, and `scrollbar-none` left
    // no hint they were there at all.
    <div className="flex flex-wrap gap-1.5 pb-1">
      {FILTERS.map((f) => (
        <button
          key={f.value}
          onClick={() => onChange(f.value)}
          className={cn(
            'px-2.5 py-1 text-[11px] font-medium rounded-full whitespace-nowrap transition-colors',
            active === f.value
              ? 'bg-[var(--accent)] text-white'
              : 'bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text)]'
          )}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}
