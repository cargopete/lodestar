'use client';

import { useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from './Card';
import { Badge } from './Badge';
import { ProgressBar } from './ProgressBar';
import { weiToGRT, formatGRT, shortenAddress, cn } from '@/lib/utils';
import type { Provision } from '@/lib/queries';

// Known data service addresses → friendly names
const SERVICE_NAMES: Record<string, string> = {
  '0xb2bb92d0de618878e438b55d5846cfecd9301105': 'Subgraph Service',
  '0x73846272813065c3e4efdb3fb82e0d128c8c2364': 'Dispatch (JSON-RPC)',
};

// Colors for up to 6 services — enough for the 2026 roadmap
const SERVICE_COLORS = [
  'var(--accent)',
  'var(--green)',
  'var(--amber)',
  'var(--teal, #14b8a6)',
  'var(--red)',
  '#8b5cf6',
];

function resolveServiceName(id: string): string {
  return SERVICE_NAMES[id.toLowerCase()] || shortenAddress(id);
}

interface ProvisionsPanelProps {
  provisions: Provision[];
  isLoading?: boolean;
  selfStakeGRT?: number;
}

export function ProvisionsPanel({ provisions, isLoading, selfStakeGRT }: ProvisionsPanelProps) {
  const serviceBreakdown = useMemo(() => {
    if (!provisions.length) return [];

    const total = provisions.reduce((sum, p) => sum + weiToGRT(p.tokensProvisioned), 0);

    return provisions.map((p, i) => {
      const provisioned = weiToGRT(p.tokensProvisioned);
      const allocated = weiToGRT(p.tokensAllocated);
      const thawing = weiToGRT(p.tokensThawing);
      return {
        name: resolveServiceName(p.dataService.id),
        provisioned,
        allocated,
        thawing,
        available: provisioned - thawing,
        percent: total > 0 ? (provisioned / total) * 100 : 0,
        color: SERVICE_COLORS[i % SERVICE_COLORS.length],
      };
    });
  }, [provisions]);

  const totals = useMemo(() => {
    if (!provisions.length) return { provisioned: 0, allocated: 0, thawing: 0, available: 0 };

    return provisions.reduce(
      (acc, p) => {
        const tokens = weiToGRT(p.tokensProvisioned);
        const allocated = weiToGRT(p.tokensAllocated);
        const thawing = weiToGRT(p.tokensThawing);
        return {
          provisioned: acc.provisioned + tokens,
          allocated: acc.allocated + allocated,
          thawing: acc.thawing + thawing,
          available: acc.available + (tokens - thawing),
        };
      },
      { provisioned: 0, allocated: 0, thawing: 0, available: 0 }
    );
  }, [provisions]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Service Provisions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[1, 2].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-lg bg-[var(--bg-elevated)]" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!provisions.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Service Provisions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-[var(--text-muted)]">No provisions found</p>
            <p className="text-sm text-[var(--text-faint)] mt-1">
              This indexer has not provisioned stake to any data services yet.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const provisionRatio = selfStakeGRT && selfStakeGRT > 0
    ? Math.min((totals.provisioned / selfStakeGRT) * 100, 100)
    : null;
  const allocationRatio = totals.provisioned > 0
    ? (totals.allocated / totals.provisioned) * 100
    : 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Service Provisions</CardTitle>
          <Badge variant="accent">{provisions.length} {provisions.length === 1 ? 'service' : 'services'}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        {/* Distribution bar — shows how stake flows across services */}
        <div className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-[var(--text-muted)]">Stake distribution</span>
            <span className="text-xs font-mono text-[var(--text-faint)]">
              {formatGRT(totals.provisioned)} GRT total
            </span>
          </div>
          {/* Stacked horizontal bar */}
          <div className="w-full h-3 rounded-full bg-[var(--bg-elevated)] overflow-hidden flex">
            {serviceBreakdown.map((s, i) => (
              <div
                key={i}
                className="h-full transition-all duration-500 first:rounded-l-full last:rounded-r-full"
                style={{
                  width: `${Math.max(s.percent, 1)}%`,
                  backgroundColor: s.color,
                  opacity: 0.85,
                }}
              />
            ))}
          </div>
          {/* Legend */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
            {serviceBreakdown.map((s, i) => (
              <div key={i} className="flex items-center gap-1.5 text-[11px]">
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: s.color }}
                />
                <span className="text-[var(--text-muted)]">{s.name}</span>
                <span className="font-mono text-[var(--text-faint)]">{s.percent.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>

        {/* Provision & allocation ratios */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
          {provisionRatio !== null && (
            <div className="p-3 rounded-lg bg-[var(--bg-elevated)]">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-[var(--text-faint)]">Stake provisioned</span>
                <span className="text-xs font-mono text-[var(--text)]">{provisionRatio.toFixed(1)}%</span>
              </div>
              <ProgressBar
                value={provisionRatio}
                variant={provisionRatio >= 80 ? 'teal' : provisionRatio >= 40 ? 'accent' : 'orange'}
                size="sm"
              />
            </div>
          )}
          <div className="p-3 rounded-lg bg-[var(--bg-elevated)]">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-[var(--text-faint)]">Provisions allocated</span>
              <span className="text-xs font-mono text-[var(--text)]">{allocationRatio.toFixed(1)}%</span>
            </div>
            <ProgressBar
              value={allocationRatio}
              variant={allocationRatio >= 80 ? 'teal' : allocationRatio >= 40 ? 'accent' : 'orange'}
              size="sm"
            />
          </div>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6 p-4 rounded-lg bg-[var(--bg-elevated)]">
          <div className="text-center">
            <p className="text-xs text-[var(--text-faint)]">Provisioned</p>
            <p className="text-base font-mono font-semibold text-[var(--text)]">
              {formatGRT(totals.provisioned)}
            </p>
          </div>
          <div className="text-center">
            <p className="text-xs text-[var(--text-faint)]">Allocated</p>
            <p className="text-base font-mono font-semibold text-[var(--accent)]">
              {formatGRT(totals.allocated)}
            </p>
          </div>
          <div className="text-center">
            <p className="text-xs text-[var(--text-faint)]">Thawing</p>
            <p className="text-base font-mono font-semibold text-[var(--amber)]">
              {formatGRT(totals.thawing)}
            </p>
          </div>
          <div className="text-center">
            <p className="text-xs text-[var(--text-faint)]">Available</p>
            <p className="text-base font-mono font-semibold text-[var(--green)]">
              {formatGRT(totals.available)}
            </p>
          </div>
        </div>

        {/* Provisions list */}
        <div className="space-y-4">
          {provisions.map((provision, i) => (
            <ProvisionCard
              key={provision.id}
              provision={provision}
              color={SERVICE_COLORS[i % SERVICE_COLORS.length]}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

interface ProvisionCardProps {
  provision: Provision;
  color: string;
}

function ProvisionCard({ provision, color }: ProvisionCardProps) {
  const tokens = weiToGRT(provision.tokensProvisioned);
  const allocated = weiToGRT(provision.tokensAllocated);
  const thawing = weiToGRT(provision.tokensThawing);
  const available = tokens - thawing;
  const allocPercent = tokens > 0 ? (allocated / tokens) * 100 : 0;
  const thawingPercent = tokens > 0 ? (thawing / tokens) * 100 : 0;

  const serviceName = resolveServiceName(provision.dataService.id);
  const serviceTokens = weiToGRT(provision.dataService.totalTokensProvisioned);
  const sharePercent = serviceTokens > 0 ? (tokens / serviceTokens) * 100 : 0;

  return (
    <div className="p-4 rounded-lg border border-[var(--border)] hover:border-[var(--accent-hover)] transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
          <div>
            <h4 className="font-semibold text-[var(--text)]">{serviceName}</h4>
            <p className="text-xs text-[var(--text-faint)] font-mono">
              {shortenAddress(provision.dataService.id)}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="font-mono text-[var(--text)]">{formatGRT(tokens)} GRT</p>
          <p className="text-xs text-[var(--text-faint)]">
            {sharePercent.toFixed(2)}% of service
          </p>
        </div>
      </div>

      {/* Stacked allocation/thawing bar */}
      <div className="mb-3">
        <div className="flex justify-between text-xs mb-1">
          <span className="text-[var(--text-faint)]">
            {allocPercent.toFixed(1)}% allocated
          </span>
          <span className="text-[var(--text-faint)]">
            {thawingPercent > 0 ? `${thawingPercent.toFixed(1)}% thawing` : 'No thawing'}
          </span>
        </div>
        <div className="w-full h-2 rounded-full bg-[var(--bg-elevated)] overflow-hidden flex">
          <div
            className="h-full transition-all duration-500 rounded-l-full"
            style={{ width: `${allocPercent}%`, backgroundColor: color, opacity: 0.9 }}
          />
          {thawingPercent > 0 && (
            <div
              className="h-full bg-[var(--amber)] transition-all duration-500"
              style={{ width: `${thawingPercent}%`, opacity: 0.7 }}
            />
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-2 text-center">
        <div className="p-2 rounded bg-[var(--bg-elevated)]">
          <p className="text-xs text-[var(--text-faint)]">Allocated</p>
          <p className="text-sm font-mono" style={{ color }}>{formatGRT(allocated)}</p>
        </div>
        <div className="p-2 rounded bg-[var(--bg-elevated)]">
          <p className="text-xs text-[var(--text-faint)]">Available</p>
          <p className="text-sm font-mono text-[var(--green)]">{formatGRT(available)}</p>
        </div>
        <div className="p-2 rounded bg-[var(--bg-elevated)]">
          <p className="text-xs text-[var(--text-faint)]">Thawing</p>
          <p className="text-sm font-mono text-[var(--amber)]">{formatGRT(thawing)}</p>
        </div>
        <div className="p-2 rounded bg-[var(--bg-elevated)]">
          <p className="text-xs text-[var(--text-faint)]">Thaw Period</p>
          <p className="text-sm font-mono text-[var(--text)]">
            {Math.round(Number(provision.thawingPeriod) / 86400)}d
          </p>
        </div>
      </div>
    </div>
  );
}
