'use client';

import { useState } from 'react';
import { useParameterHistory } from '@/hooks/useNetworkStats';
import { formatPPM } from '@/lib/utils';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';

function formatParamValue(paramName: string, value: number): string {
  if (paramName === 'reward_cut' || paramName === 'query_fee_cut') {
    return formatPPM(value);
  }
  return String(value);
}

function paramLabel(paramName: string): string {
  if (paramName === 'reward_cut') return 'Reward Cut';
  if (paramName === 'query_fee_cut') return 'Fee Cut';
  return paramName;
}

function timeAgo(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days < 1) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months === 1) return '1 month ago';
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(months / 12);
  return years === 1 ? '1 year ago' : `${years}y ago`;
}

function formatDate(isoDate: string): string {
  const d = new Date(isoDate);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function ParameterHistory({ address }: { address: string }) {
  const { data, isLoading } = useParameterHistory(address);
  // Mount-stable "now" (ms) — keeps render pure (no Date.now() during render).
  const [now] = useState(() => Date.now());

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Parameter History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-20 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.length === 0) {
    // Compute stability label
    const stabilityLabel = 'No parameter changes recorded';

    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Parameter History</CardTitle>
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-[10px] font-medium">
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Stable
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[var(--text-faint)]">{stabilityLabel}</p>
        </CardContent>
      </Card>
    );
  }

  // Compute stability
  const sixMonthsAgo = now - 180 * 86_400_000;
  const threeMonthsAgo = now - 90 * 86_400_000;
  const recentChanges = data.filter((c) => new Date(c.detected_at).getTime() > threeMonthsAgo);
  const recentIncreases = data.filter(
    (c) => c.param_name === 'reward_cut' && c.old_value !== null && c.new_value > c.old_value && new Date(c.detected_at).getTime() > threeMonthsAgo
  );
  const lastChangeTime = new Date(data[0].detected_at).getTime();

  let stabilityVariant: 'stable' | 'caution' | 'warning';
  let stabilityText: string;

  if (lastChangeTime < sixMonthsAgo) {
    stabilityVariant = 'stable';
    stabilityText = `Unchanged for ${timeAgo(data[0].detected_at).replace(' ago', '')}`;
  } else if (recentIncreases.length >= 2) {
    stabilityVariant = 'warning';
    stabilityText = `${recentIncreases.length} reward cut increases in 3 months`;
  } else if (recentChanges.length >= 3) {
    stabilityVariant = 'caution';
    stabilityText = `${recentChanges.length} changes in 3 months`;
  } else {
    stabilityVariant = 'stable';
    stabilityText = `Last change ${timeAgo(data[0].detected_at)}`;
  }

  const badgeStyles = {
    stable: 'bg-emerald-500/10 text-emerald-400',
    caution: 'bg-amber-500/10 text-amber-400',
    warning: 'bg-red-500/10 text-red-400',
  };

  const badgeIcons = {
    stable: <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />,
    caution: <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />,
    warning: <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />,
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Parameter History</CardTitle>
          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium ${badgeStyles[stabilityVariant]}`}>
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              {badgeIcons[stabilityVariant]}
            </svg>
            {stabilityText}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-[7px] top-2 bottom-2 w-px bg-[var(--border)]" />

          <div className="space-y-0">
            {data.map((change, i) => {
              const isIncrease = change.old_value !== null && change.new_value > change.old_value;
              const isDecrease = change.old_value !== null && change.new_value < change.old_value;

              return (
                <div key={i} className="flex items-start gap-3 py-2 group">
                  {/* Dot */}
                  <div className={`relative z-10 mt-1.5 w-[15px] h-[15px] rounded-full border-2 shrink-0 ${
                    isIncrease
                      ? 'border-red-400 bg-red-400/20'
                      : isDecrease
                        ? 'border-emerald-400 bg-emerald-400/20'
                        : 'border-[var(--text-faint)] bg-[var(--bg-surface)]'
                  }`} />

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium text-[var(--text)]">
                        {paramLabel(change.param_name)}
                      </span>
                      {change.old_value !== null ? (
                        <span className="text-xs text-[var(--text-muted)]">
                          {formatParamValue(change.param_name, change.old_value)}
                          <span className="mx-1 text-[var(--text-faint)]">&rarr;</span>
                          <span className={isIncrease ? 'text-red-400' : isDecrease ? 'text-emerald-400' : ''}>
                            {formatParamValue(change.param_name, change.new_value)}
                          </span>
                        </span>
                      ) : (
                        <span className="text-xs text-[var(--text-muted)]">
                          set to {formatParamValue(change.param_name, change.new_value)}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-[var(--text-faint)] mt-0.5">
                      {formatDate(change.detected_at)}
                      {change.epoch != null && ` · Epoch ${change.epoch}`}
                      <span className="ml-1">({timeAgo(change.detected_at)})</span>
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
