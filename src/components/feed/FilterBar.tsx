'use client';

import { cn } from '@/lib/utils';
import type { FeedItemType } from '@/lib/feed';

const FILTERS: { label: string; value: FeedItemType | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Governance', value: 'governance' },
  { label: 'GIPs', value: 'gip' },
  { label: 'Epochs', value: 'epoch' },
  { label: 'News', value: 'announcement' },
];

interface FilterBarProps {
  active: FeedItemType | 'all';
  onChange: (filter: FeedItemType | 'all') => void;
}

export function FilterBar({ active, onChange }: FilterBarProps) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
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
