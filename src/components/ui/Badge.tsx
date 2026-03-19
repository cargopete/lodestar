'use client';

import { cn } from '@/lib/utils';
import { ReactNode } from 'react';

type BadgeVariant = 'default' | 'accent' | 'success' | 'warning' | 'error';

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-[var(--bg-elevated)] text-[var(--text-muted)]',
  accent: 'bg-[var(--accent-dim)] text-[var(--accent)]',
  success: 'bg-[var(--green-dim)] text-[var(--green)]',
  warning: 'bg-[var(--amber-dim)] text-[var(--amber)]',
  error: 'bg-[var(--red-dim)] text-[var(--red)]',
};

export function Badge({ children, variant = 'default', className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 text-[11px] font-mono',
        'rounded-[var(--radius-badge)]',
        variantStyles[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
