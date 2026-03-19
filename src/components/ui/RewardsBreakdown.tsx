'use client';

import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from './Card';
import { Badge } from './Badge';
import { formatGRT, formatUSD, cn } from '@/lib/utils';

interface RewardsBreakdownProps {
  pending: number;
  unrealized: number;
  realized: number;
  grtPrice: number;
  isLoading?: boolean;
}

export function RewardsBreakdown({
  pending,
  unrealized,
  realized,
  grtPrice,
  isLoading = false,
}: RewardsBreakdownProps) {
  const [showUSD, setShowUSD] = useState(false);

  const total = pending + unrealized + realized;

  const formatValue = (value: number) => {
    if (showUSD) {
      return formatUSD(value * grtPrice);
    }
    return `${formatGRT(value)} GRT`;
  };

  const categories = [
    {
      label: 'Pending',
      description: 'Claimable now',
      value: pending,
      color: 'var(--accent)',
      bgColor: 'var(--accent-dim)',
    },
    {
      label: 'Unrealized',
      description: 'Accruing in pool',
      value: unrealized,
      color: 'var(--green)',
      bgColor: 'rgba(0, 201, 160, 0.15)',
    },
    {
      label: 'Realized',
      description: 'Already claimed',
      value: realized,
      color: 'var(--amber)',
      bgColor: 'rgba(255, 140, 66, 0.15)',
    },
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Rewards Breakdown</CardTitle>
          <button
            onClick={() => setShowUSD(!showUSD)}
            className={cn(
              'px-2 py-1 text-xs font-medium rounded-md transition-colors',
              'border border-[var(--border)] hover:border-[var(--accent-hover)]',
              showUSD ? 'bg-[var(--accent-dim)] text-[var(--accent)]' : 'text-[var(--text-muted)]'
            )}
          >
            {showUSD ? 'USD' : 'GRT'}
          </button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-lg bg-[var(--bg-elevated)]" />
            ))}
          </div>
        ) : (
          <>
            {/* Total */}
            <div className="mb-6 p-4 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)]">
              <p className="text-sm text-[var(--text-muted)] mb-1">Total Rewards</p>
              <p className="text-2xl font-mono font-semibold text-[var(--text)]">
                {formatValue(total)}
              </p>
              {showUSD && (
                <p className="text-sm text-[var(--text-faint)] font-mono">
                  {formatGRT(total)} GRT
                </p>
              )}
            </div>

            {/* Categories */}
            <div className="space-y-3">
              {categories.map((cat) => {
                const percentage = total > 0 ? (cat.value / total) * 100 : 0;

                return (
                  <div
                    key={cat.label}
                    className="p-4 rounded-lg"
                    style={{ backgroundColor: cat.bgColor }}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <span
                          className="text-sm font-medium"
                          style={{ color: cat.color }}
                        >
                          {cat.label}
                        </span>
                        <span className="text-xs text-[var(--text-faint)] ml-2">
                          {cat.description}
                        </span>
                      </div>
                      <span className="text-xs text-[var(--text-muted)]">
                        {percentage.toFixed(1)}%
                      </span>
                    </div>
                    <p className="text-lg font-mono text-[var(--text)]">
                      {formatValue(cat.value)}
                    </p>
                    {/* Progress bar */}
                    <div className="mt-2 h-1 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${percentage}%`,
                          backgroundColor: cat.color,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
