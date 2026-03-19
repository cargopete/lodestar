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
  icon?: React.ReactNode;
  loading?: boolean;
  className?: string;
}

export function StatCard({
  label,
  value,
  delta,
  icon,
  loading = false,
  className,
}: StatCardProps) {
  return (
    <Card className={cn('relative overflow-hidden group', className)} hover>
      {/* Subtle accent glow on hover */}
      <div className="absolute inset-0 bg-gradient-to-br from-[var(--accent-dim)] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
      <div className="relative flex items-start justify-between">
        <div className="flex-1">
          <p className="text-[11px] text-[var(--text-muted)] uppercase tracking-[0.06em] mb-1.5">{label}</p>
          {loading ? (
            <div className="h-8 w-24 shimmer rounded" />
          ) : (
            <p className="text-[22px] font-medium font-mono text-[var(--text)] tracking-tight">
              {value}
            </p>
          )}
          {delta && !loading && (
            <p
              className={cn(
                'text-[11px] font-mono mt-1.5 px-1.5 py-0.5 rounded-[var(--radius-badge)] inline-block',
                delta.positive ? 'text-[var(--green)] bg-[var(--green-dim)]' : 'text-[var(--red)] bg-[var(--red-dim)]'
              )}
            >
              {delta.positive ? '+' : ''}{delta.value}
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
    <div className={cn('grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5', className)}>
      {children}
    </div>
  );
}
