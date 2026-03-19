'use client';

import { cn } from '@/lib/utils';

interface ProgressBarProps {
  value: number;
  max?: number;
  label?: string;
  showValue?: boolean;
  variant?: 'accent' | 'teal' | 'orange';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const variantColors: Record<string, string> = {
  accent: 'bg-gradient-to-r from-[var(--accent)] to-[var(--accent)]',
  teal: 'bg-gradient-to-r from-[var(--green)] to-[#6ee7b7]',
  orange: 'bg-gradient-to-r from-[var(--amber)] to-[#fbbf24]',
};

const sizeStyles: Record<string, string> = {
  sm: 'h-1',
  md: 'h-1.5',
  lg: 'h-2.5',
};

export function ProgressBar({
  value,
  max = 100,
  label,
  showValue = false,
  variant = 'accent',
  size = 'md',
  className,
}: ProgressBarProps) {
  const percentage = Math.min(Math.max((value / max) * 100, 0), 100);

  return (
    <div className={cn('w-full', className)}>
      {(label || showValue) && (
        <div className="flex justify-between items-center mb-1.5">
          {label && (
            <span className="text-[13px] text-[var(--text-muted)]">{label}</span>
          )}
          {showValue && (
            <span className="text-[13px] font-mono font-medium text-[var(--text)]">
              {percentage.toFixed(1)}%
            </span>
          )}
        </div>
      )}
      <div
        className={cn(
          'w-full rounded-full bg-[var(--bg-elevated)] overflow-hidden',
          sizeStyles[size]
        )}
      >
        <div
          className={cn(
            'h-full rounded-full transition-all duration-500 ease-out',
            variantColors[variant]
          )}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
