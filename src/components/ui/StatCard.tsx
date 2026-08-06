'use client';

import { cn } from '@/lib/utils';
import { Card } from './Card';

interface StatCardProps {
  label: string;
  value: string;
  delta?: {
    value: string;
    positive?: boolean;
  };
  subtitle?: string;
  tag?: string;
  tooltip?: string;
  icon?: React.ReactNode;
  loading?: boolean;
  className?: string;
}

export function StatCard({
  label,
  value,
  delta,
  subtitle,
  tag,
  tooltip,
  icon,
  loading = false,
  className,
}: StatCardProps) {
  return (
    <Card className={cn('relative overflow-hidden group p-5', className)} hover>
      {/* Subtle accent glow on hover */}
      <div className="absolute inset-0 bg-gradient-to-br from-[var(--accent-dim)] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
      <div className="relative flex items-start justify-between">
        <div className="flex-1">
          <p className="text-[11px] text-[var(--text-muted)] mb-1.5 flex items-center gap-1.5">
            {label}
            {tag && (
              <span className="text-[9px] font-medium px-1 py-0.5 rounded bg-[var(--accent-dim)] text-[var(--accent-text)] uppercase tracking-wide leading-none">
                {tag}
              </span>
            )}
            {tooltip && (
              <span className="relative group/stattip inline-flex items-center">
                <svg className="w-3 h-3 text-[var(--text-faint)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <circle cx="12" cy="12" r="10" />
                  <path strokeLinecap="round" d="M12 16v-4m0-4h.01" />
                </svg>
                <span className="absolute left-0 top-full mt-1.5 w-60 p-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)] shadow-xl opacity-0 pointer-events-none group-hover/stattip:opacity-100 transition-opacity z-50 text-[11px] font-normal normal-case tracking-normal text-[var(--text)]">
                  {tooltip}
                </span>
              </span>
            )}
          </p>
          {loading ? (
            <div className="h-8 w-24 shimmer rounded" />
          ) : (
            <p className={cn('font-semibold font-mono text-[var(--text)] tracking-tight', value.length > 9 ? 'text-[20px]' : 'text-[24px]')}>
              {value}
            </p>
          )}
          {delta && !loading && (
            <p
              className={cn(
                'text-[11px] font-mono mt-3 px-1.5 py-0.5 rounded-[var(--radius-badge)] inline-block',
                delta.positive ? 'text-[var(--green)] bg-[var(--green-dim)]' : 'text-[var(--red-text)] bg-[var(--red-dim)]'
              )}
            >
              {delta.positive ? '+' : ''}{delta.value}
            </p>
          )}
          {subtitle && !loading && (
            <p className="text-[11px] font-mono mt-1.5 text-[var(--text-muted)]">
              {subtitle}
            </p>
          )}
        </div>
        {icon && (
          <div className="text-[var(--text-faint)]">{icon}</div>
        )}
      </div>
    </Card>
  );
}

interface StatGridProps {
  children: React.ReactNode;
  className?: string;
}

export function StatGrid({ children, className }: StatGridProps) {
  return (
    <div className={cn('grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 stat-grid-stagger', className)}>
      {children}
    </div>
  );
}
