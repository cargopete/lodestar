'use client';

import { useState } from 'react';
import { useNetworkStats } from '@/hooks/useNetworkStats';
import { cn, formatPPM } from '@/lib/utils';
import { Card, CardHeader, CardTitle, CardContent } from './Card';
import { Badge } from './Badge';

type ParameterStatus = 'active' | 'deprecated' | 'new' | 'legacy-only';

interface ParameterInfo {
  name: string;
  description: string;
  status: ParameterStatus;
  value: string | number | null;
  unit: string;
  contract: string;
  contractAddress?: string;
  details: string;
}

const statusConfig: Record<ParameterStatus, { label: string; variant: 'accent' | 'success' | 'warning' | 'error' }> = {
  active: { label: 'Active', variant: 'success' },
  deprecated: { label: 'Deprecated', variant: 'error' },
  new: { label: 'New in Horizon', variant: 'accent' },
  'legacy-only': { label: 'Legacy Only', variant: 'warning' },
};

function formatStalenessValue(seconds: string | number | null): string {
  if (seconds === null || seconds === undefined) return '—';
  const secs = typeof seconds === 'string' ? parseInt(seconds, 10) : seconds;
  if (isNaN(secs)) return '—';

  const hours = Math.floor(secs / 3600);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h (${secs.toLocaleString()}s)`;
  }
  if (hours > 0) {
    return `${hours}h (${secs.toLocaleString()}s)`;
  }
  return `${secs.toLocaleString()}s`;
}

export function HorizonParameters() {
  const { data, isLoading } = useNetworkStats();
  const [expandedParam, setExpandedParam] = useState<string | null>(null);

  const network = data?.graphNetwork;

  const parameters: ParameterInfo[] = [
    {
      name: 'maxPOIStaleness',
      description: 'Maximum time without POI submission before allocation becomes stale',
      status: 'new',
      value: network?.maxPOIStaleness ?? null,
      unit: 'seconds',
      contract: 'SubgraphService',
      contractAddress: '0xb2Bb92d0DE618878E438b55D5846cfecD9301105',
      details: `Introduced in Horizon to replace the old epoch-based allocation limits. Stale allocations forfeit rewards and can be force-closed by anyone. Uses timestamp-based logic (block.timestamp) rather than epochs. This reflects Horizon's shift toward continuous indexer participation rather than periodic allocation cycling.`,
    },
    {
      name: 'delegationTaxPercentage',
      description: 'Tax burned on newly delegated GRT (removed in Horizon)',
      status: 'deprecated',
      value: network?.delegationTaxPercentage ?? 5000,
      unit: 'PPM',
      contract: 'HorizonStaking',
      contractAddress: '0x00669A4CF01450B64E8A2A20E9b1FCB71E61eF03',
      details: `The 0.5% delegation tax was eliminated at the code level in Horizon. The storage slot still holds the legacy value (5,000 PPM) for proxy compatibility, but HorizonStaking._delegate() completely bypasses it. No governance proposal zeroed it — the new implementation simply ignores it. Slashable delegation (enabled ~3 months post-Horizon) provides the attack deterrent that the tax originally offered.`,
    },
    {
      name: 'maxAllocationEpochs',
      description: 'Maximum allocation lifetime in epochs (legacy allocations only)',
      status: 'legacy-only',
      value: network?.maxAllocationEpochs ?? 28,
      unit: 'epochs',
      contract: 'Staking (Legacy)',
      details: `Still active for legacy allocations being wound down during the transition period. The setter function remains functional (not marked __DEPRECATED_). New allocations under SubgraphService have no epoch-based lifetime limit — freshness is enforced via maxPOIStaleness instead. The indexer-agent currently cycles allocations every ~28 days for compatibility; a future version will use long-lived allocations natively.`,
    },
  ];

  const toggleExpanded = (name: string) => {
    setExpandedParam(expandedParam === name ? null : name);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Horizon Parameters</CardTitle>
          <Badge variant="accent">Q4 2025</Badge>
        </div>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          Key protocol parameters changed in the Horizon upgrade
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {parameters.map((param) => {
            const isExpanded = expandedParam === param.name;
            const statusInfo = statusConfig[param.status];

            return (
              <div
                key={param.name}
                className={cn(
                  'border border-[var(--border)] rounded-lg overflow-hidden transition-all duration-200',
                  isExpanded && 'border-[var(--accent-hover)]'
                )}
              >
                {/* Header - always visible */}
                <button
                  onClick={() => toggleExpanded(param.name)}
                  className="w-full p-4 flex items-center justify-between hover:bg-[var(--bg-elevated)] transition-colors text-left"
                >
                  <div className="flex items-center gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <code className="text-sm font-mono text-[var(--accent)]">
                          {param.name}
                        </code>
                        <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
                      </div>
                      <p className="text-sm text-[var(--text-muted)] mt-0.5">
                        {param.description}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    {isLoading ? (
                      <div className="h-5 w-16 animate-pulse rounded bg-[var(--bg-elevated)]" />
                    ) : (
                      <span className="font-mono text-[var(--text)]">
                        {param.name === 'maxPOIStaleness'
                          ? formatStalenessValue(param.value)
                          : param.name === 'delegationTaxPercentage'
                          ? `${formatPPM(typeof param.value === 'number' ? param.value : 5000)} (dead code)`
                          : `${param.value ?? '—'} ${param.unit}`}
                      </span>
                    )}
                    <svg
                      className={cn(
                        'w-5 h-5 text-[var(--text-faint)] transition-transform',
                        isExpanded && 'rotate-180'
                      )}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </button>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-[var(--border)] bg-[var(--bg-elevated)]">
                    <div className="pt-4 space-y-3">
                      {/* Contract info */}
                      <div className="flex flex-wrap gap-4 text-sm">
                        <div>
                          <span className="text-[var(--text-faint)]">Contract: </span>
                          <span className="text-[var(--text)]">{param.contract}</span>
                        </div>
                        {param.contractAddress && (
                          <div>
                            <span className="text-[var(--text-faint)]">Address: </span>
                            <a
                              href={`https://arbiscan.io/address/${param.contractAddress}#readProxyContract`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-mono text-[var(--accent)] hover:underline"
                            >
                              {param.contractAddress.slice(0, 10)}...{param.contractAddress.slice(-8)}
                            </a>
                          </div>
                        )}
                        <div>
                          <span className="text-[var(--text-faint)]">Unit: </span>
                          <span className="text-[var(--text)]">{param.unit}</span>
                        </div>
                      </div>

                      {/* Details */}
                      <p className="text-sm text-[var(--text-muted)] leading-relaxed">
                        {param.details}
                      </p>

                      {/* On-chain read hint for maxPOIStaleness */}
                      {param.name === 'maxPOIStaleness' && (
                        <div className="mt-3 p-3 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)]">
                          <p className="text-xs text-[var(--text-faint)]">
                            <strong className="text-[var(--text-muted)]">To verify on-chain:</strong>{' '}
                            Call <code className="text-[var(--accent)]">maxPOIStaleness()</code> on Arbiscan
                            or query the Graph Network subgraph with{' '}
                            <code className="text-[var(--accent)]">
                              {'{ graphNetwork(id: "1") { maxPOIStaleness } }'}
                            </code>
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Summary note */}
        <div className="mt-4 p-3 rounded-lg bg-[var(--accent-dim)] border border-[var(--accent-hover)]">
          <p className="text-sm text-[var(--text-muted)]">
            <strong className="text-[var(--accent)]">Horizon Summary:</strong>{' '}
            Shifted from epoch-counting to POI-freshness enforcement. Allocations are now long-lived
            with continuous participation incentives, rather than requiring periodic 28-epoch cycling.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
