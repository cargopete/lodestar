'use client';

import { cn } from '@/lib/utils';

interface PaginationProps {
  page: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
}

export function Pagination({ page, pageSize, totalItems, onPageChange }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const start = page * pageSize + 1;
  const end = Math.min((page + 1) * pageSize, totalItems);

  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-sm text-[var(--text-faint)]">
        Showing {start}–{end} of {totalItems}
      </span>
      <div className="flex items-center gap-3">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page === 0}
          className={cn(
            'px-3 py-1.5 text-sm rounded-[var(--radius-button)] border transition-colors',
            page === 0
              ? 'border-[var(--border)] text-[var(--text-faint)] cursor-not-allowed opacity-40'
              : 'border-[var(--border)] text-[var(--text)] hover:border-[var(--accent-hover)]'
          )}
        >
          Prev
        </button>
        <span className="text-sm font-mono text-[var(--text-muted)]">
          {page + 1}/{totalPages}
        </span>
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages - 1}
          className={cn(
            'px-3 py-1.5 text-sm rounded-[var(--radius-button)] border transition-colors',
            page >= totalPages - 1
              ? 'border-[var(--border)] text-[var(--text-faint)] cursor-not-allowed opacity-40'
              : 'border-[var(--border)] text-[var(--text)] hover:border-[var(--accent-hover)]'
          )}
        >
          Next
        </button>
      </div>
    </div>
  );
}
