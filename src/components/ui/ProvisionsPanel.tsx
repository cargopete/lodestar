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
};

function resolveServiceName(id: string): string {
  return SERVICE_NAMES[id.toLowerCase()] || shortenAddress(id);
}

interface ProvisionsPanelProps {
  provisions: Provision[];
  isLoading?: boolean;
}

export function ProvisionsPanel({ provisions, isLoading }: ProvisionsPanelProps) {
  const totals = useMemo(() => {
    if (!provisions.length) return { provisioned: 0, thawing: 0, available: 0 };

    return provisions.reduce(
      (acc, p) => {
        const tokens = weiToGRT(p.tokensProvisioned);
        const thawing = weiToGRT(p.tokensThawing);
        return {
          provisioned: acc.provisioned + tokens,
          thawing: acc.thawing + thawing,
          available: acc.available + (tokens - thawing),
        };
      },
      { provisioned: 0, thawing: 0, available: 0 }
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

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Service Provisions</CardTitle>
          <Badge variant="accent">{provisions.length} services</Badge>
        </div>
      </CardHeader>
      <CardContent>
        {/* Summary stats */}
        <div className="grid grid-cols-3 gap-4 mb-6 p-4 rounded-lg bg-[var(--bg-elevated)]">
          <div className="text-center">
            <p className="text-xs text-[var(--text-faint)]">Total Provisioned</p>
            <p className="text-lg font-mono font-semibold text-[var(--text)]">
              {formatGRT(totals.provisioned)}
            </p>
          </div>
          <div className="text-center">
            <p className="text-xs text-[var(--text-faint)]">Thawing</p>
            <p className="text-lg font-mono font-semibold text-[var(--amber)]">
              {formatGRT(totals.thawing)}
            </p>
          </div>
          <div className="text-center">
            <p className="text-xs text-[var(--text-faint)]">Available</p>
            <p className="text-lg font-mono font-semibold text-[var(--green)]">
              {formatGRT(totals.available)}
            </p>
          </div>
        </div>

        {/* Provisions list */}
        <div className="space-y-4">
          {provisions.map((provision) => (
            <ProvisionCard key={provision.id} provision={provision} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

interface ProvisionCardProps {
  provision: Provision;
}

function ProvisionCard({ provision }: ProvisionCardProps) {
  const tokens = weiToGRT(provision.tokensProvisioned);
  const thawing = weiToGRT(provision.tokensThawing);
  const available = tokens - thawing;
  const thawingPercent = tokens > 0 ? (thawing / tokens) * 100 : 0;

  const serviceName = resolveServiceName(provision.dataService.id);
  const serviceTokens = weiToGRT(provision.dataService.totalTokensProvisioned);
  const sharePercent = serviceTokens > 0 ? (tokens / serviceTokens) * 100 : 0;

  return (
    <div className="p-4 rounded-lg border border-[var(--border)] hover:border-[var(--accent-hover)] transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h4 className="font-semibold text-[var(--text)]">{serviceName}</h4>
          <p className="text-xs text-[var(--text-faint)] font-mono">
            {shortenAddress(provision.dataService.id)}
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-[var(--text)]">{formatGRT(tokens)} GRT</p>
          <p className="text-xs text-[var(--text-faint)]">
            {sharePercent.toFixed(2)}% of service
          </p>
        </div>
      </div>

      {/* Provision utilization */}
      <div className="mb-3">
        <div className="flex justify-between text-xs mb-1">
          <span className="text-[var(--text-faint)]">Utilization</span>
          <span className="text-[var(--text-muted)]">
            {thawingPercent.toFixed(1)}% thawing
          </span>
        </div>
        <ProgressBar
          value={100 - thawingPercent}
          max={100}
          variant={thawingPercent > 50 ? 'orange' : 'teal'}
          size="sm"
        />
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2 text-center">
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
