'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { cn, shortenAddress } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { StatCard, StatGrid } from '@/components/ui/StatCard';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Stats {
  total_probes: number;
  total_divergences: number;
  opted_in_indexers: number;
  deployments_covered: number;
  divergence_rate_24h: number;
  probes_24h: number;
  divergences_24h: number;
}

interface DeploymentSummary {
  deployment_id: string;
  total_probes: number;
  avg_latency_ms: number | null;
  p50_latency_ms: number | null;
  p95_latency_ms: number | null;
  last_probe_at: string | null;
  unique_indexers: number;
}

interface IndexerQuality {
  indexer_address: string;
  total_probes: number;
  divergent_probes: number;
  divergence_rate: number;
  avg_latency_ms: number | null;
  last_seen: string | null;
}

interface FeedEvent {
  probe_id: string;
  deployment_id: string;
  block_number: number;
  block_hash: string;
  query_category: string;
  dispatched_at: string;
  cluster_count: number;
  indexer_count: number;
  diff_patch_count: number;
}

// ── Deployment metadata ───────────────────────────────────────────────────────

const DEPLOYMENT_INFO: Record<string, { label: string; network: string }> = {
  '0x45c636b73728d75a77b84c782e2a44624a294c1414326e59f12d60e0a6e58f51': {
    label: 'Graph Network',
    network: 'Arbitrum One',
  },
  '0xde0a7b5368f846f7d863d9f64949b688ad9818243151d488b4c6b206145b9ea3': {
    label: 'Premia Finance',
    network: 'Arbitrum One',
  },
  '0xce57e4bc7b885a6255edd3e9d1617bb8819559f3903b84c18bb5db31afe17d06': {
    label: 'ENS',
    network: 'Ethereum',
  },
  '0xe7b79e8051d136a6ab0ffd6016c7b7fd96dc63e220fe4071021844f36796398b': {
    label: 'Aave V2',
    network: 'Ethereum',
  },
};

// ── Hooks ─────────────────────────────────────────────────────────────────────

function useFoghornStats() {
  return useQuery<Stats>({
    queryKey: ['foghorn-stats'],
    queryFn: async () => {
      const r = await fetch('/api/foghorn/stats');
      if (!r.ok) throw new Error(`${r.status}`);
      return r.json();
    },
    staleTime: 60_000,
    retry: 1,
  });
}

function useFoghornDeployments() {
  return useQuery<{ deployments: DeploymentSummary[] }>({
    queryKey: ['foghorn-deployments'],
    queryFn: async () => {
      const r = await fetch('/api/foghorn/deployments');
      if (!r.ok) throw new Error(`${r.status}`);
      return r.json();
    },
    staleTime: 60_000,
    retry: 1,
  });
}

function useDeploymentQuality(deploymentId: string, enabled: boolean) {
  return useQuery<{ deployment_id: string; indexers: IndexerQuality[] }>({
    queryKey: ['foghorn-deployment-quality', deploymentId],
    queryFn: async () => {
      const r = await fetch(`/api/foghorn/deployment/${encodeURIComponent(deploymentId)}/quality?days=7`);
      if (!r.ok) throw new Error(`${r.status}`);
      return r.json();
    },
    enabled,
    staleTime: 300_000,
    retry: 1,
  });
}

function useFoghornFeed() {
  return useQuery<{ events: FeedEvent[]; count: number }>({
    queryKey: ['foghorn-feed'],
    queryFn: async () => {
      const r = await fetch('/api/foghorn/feed');
      if (!r.ok) throw new Error(`${r.status}`);
      return r.json();
    },
    staleTime: 60_000,
    retry: 1,
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function latencyColor(ms: number | null): string {
  if (ms === null) return 'text-[var(--text-faint)]';
  if (ms < 80) return 'text-[var(--green)]';
  if (ms < 200) return 'text-[var(--text)]';
  if (ms < 500) return 'text-[var(--amber)]';
  return 'text-[var(--red)]';
}

function latencyLabel(ms: number | null): string {
  if (ms === null) return '—';
  return `${ms}ms`;
}

function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return '<1h ago';
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const CATEGORY_LABELS: Record<string, string> = {
  Q_byid: 'By ID',
  Q_agg: 'Aggregate',
  Q_freshness: 'Freshness',
  Q_timetravel: 'Time-travel',
};

// ── Deployment row ────────────────────────────────────────────────────────────

type SortKey = 'latency' | 'probes' | 'last_seen';

function DeploymentRow({ summary }: { summary: DeploymentSummary }) {
  const [expanded, setExpanded] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('latency');
  const { data, isLoading } = useDeploymentQuality(summary.deployment_id, expanded);

  const info = DEPLOYMENT_INFO[summary.deployment_id];
  const label = info?.label ?? shortenAddress(summary.deployment_id);
  const network = info?.network ?? 'Unknown';

  const sorted = [...(data?.indexers ?? [])].sort((a, b) => {
    if (sortKey === 'latency') return (a.avg_latency_ms ?? 9999) - (b.avg_latency_ms ?? 9999);
    if (sortKey === 'probes') return b.total_probes - a.total_probes;
    if (sortKey === 'last_seen') return new Date(b.last_seen ?? 0).getTime() - new Date(a.last_seen ?? 0).getTime();
    return 0;
  });

  return (
    <div className="border border-[var(--border)] rounded-lg overflow-hidden">
      {/* Summary row */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-4 px-4 py-3 bg-[var(--bg-elevated)] hover:bg-[var(--bg-card)] text-left transition-colors"
      >
        <svg
          className={cn('w-4 h-4 text-[var(--text-faint)] shrink-0 transition-transform', expanded && 'rotate-90')}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[var(--text)]">{label}</span>
            <Badge variant="default" className="text-[10px]">{network}</Badge>
          </div>
          <span className="font-mono text-[10px] text-[var(--text-faint)]">
            {summary.deployment_id.slice(0, 18)}…
          </span>
        </div>

        <div className="flex items-center gap-6 shrink-0 text-right">
          <div>
            <div className={cn('font-mono text-sm font-medium', latencyColor(summary.avg_latency_ms))}>
              {latencyLabel(summary.avg_latency_ms)}
            </div>
            <div className="text-[10px] text-[var(--text-faint)]">avg</div>
          </div>
          <div>
            <div className={cn('font-mono text-sm font-medium', latencyColor(summary.p95_latency_ms))}>
              {latencyLabel(summary.p95_latency_ms)}
            </div>
            <div className="text-[10px] text-[var(--text-faint)]">p95</div>
          </div>
          <div>
            <div className="font-mono text-sm font-medium text-[var(--text)]">
              {summary.unique_indexers}
            </div>
            <div className="text-[10px] text-[var(--text-faint)]">indexers</div>
          </div>
          <div>
            <div className="text-sm text-[var(--text-muted)]">{timeAgo(summary.last_probe_at)}</div>
            <div className="text-[10px] text-[var(--text-faint)]">last probe</div>
          </div>
        </div>
      </button>

      {/* Expanded indexer table */}
      {expanded && (
        <div className="border-t border-[var(--border)]">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="px-4 py-2 text-left text-[11px] font-medium text-[var(--text-muted)]">
                      Allocation key
                    </th>
                    <th
                      className={cn(
                        'px-4 py-2 text-right text-[11px] font-medium cursor-pointer select-none',
                        sortKey === 'latency' ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'
                      )}
                      onClick={() => setSortKey('latency')}
                    >
                      Avg latency {sortKey === 'latency' && '↑'}
                    </th>
                    <th
                      className={cn(
                        'px-4 py-2 text-right text-[11px] font-medium cursor-pointer select-none',
                        sortKey === 'probes' ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'
                      )}
                      onClick={() => setSortKey('probes')}
                    >
                      Probes {sortKey === 'probes' && '↓'}
                    </th>
                    <th
                      className={cn(
                        'px-4 py-2 text-right text-[11px] font-medium cursor-pointer select-none',
                        sortKey === 'last_seen' ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'
                      )}
                      onClick={() => setSortKey('last_seen')}
                    >
                      Last seen {sortKey === 'last_seen' && '↓'}
                    </th>
                    <th className="px-4 py-2 text-right text-[11px] font-medium text-[var(--text-muted)]">
                      Divergent
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {sorted.map((ix) => (
                    <tr key={ix.indexer_address} className="hover:bg-[var(--bg-elevated)]">
                      <td className="px-4 py-2">
                        <span className="font-mono text-xs text-[var(--text-muted)]">
                          {ix.indexer_address.slice(0, 10)}…{ix.indexer_address.slice(-6)}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <span className={cn('font-mono text-xs font-medium', latencyColor(ix.avg_latency_ms))}>
                          {latencyLabel(ix.avg_latency_ms)}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <span className="font-mono text-xs text-[var(--text-muted)]">
                          {ix.total_probes}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <span className="text-xs text-[var(--text-faint)]">
                          {timeAgo(ix.last_seen)}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <span className={cn(
                          'font-mono text-xs',
                          ix.divergent_probes > 0 ? 'text-[var(--amber)] font-medium' : 'text-[var(--text-faint)]'
                        )}>
                          {ix.divergent_probes > 0 ? ix.divergent_probes : '—'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function FoghornPage() {
  const { data: stats, isLoading: statsLoading } = useFoghornStats();
  const { data: deploymentsData, isLoading: deploymentsLoading } = useFoghornDeployments();
  const { data: feedData } = useFoghornFeed();

  const isUnavailable = !statsLoading && !stats;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-2xl font-semibold text-[var(--text)]">Foghorn</h1>
          <Badge variant="accent">Observability</Badge>
        </div>
        <p className="text-sm text-[var(--text-muted)] max-w-2xl">
          Block-pinned GraphQL probes dispatched via The Graph gateway. Latency and
          response consistency observed across all allocating indexers.
        </p>
      </div>

      {isUnavailable && (
        <div className="flex items-center gap-3 p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)]">
          <svg className="w-5 h-5 text-[var(--text-faint)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <p className="text-sm text-[var(--text-muted)]">
            Foghorn service is not reachable. Configure{' '}
            <code className="text-xs font-mono text-[var(--accent)]">FOGHORN_API_URL</code>{' '}
            in the environment to enable.
          </p>
        </div>
      )}

      {/* Stats */}
      {stats && (
        <StatGrid>
          <StatCard
            label="Total Probes"
            value={stats.total_probes.toLocaleString()}
            subtitle={`${stats.probes_24h.toLocaleString()} in last 24h`}
          />
          <StatCard
            label="Observed Allocations"
            value={stats.opted_in_indexers.toLocaleString()}
            subtitle={`across ${stats.deployments_covered} deployments`}
          />
          <StatCard
            label="Divergences"
            value={stats.total_divergences.toLocaleString()}
            subtitle={`${stats.divergences_24h} in last 24h`}
          />
          <StatCard
            label="Divergence Rate (24h)"
            value={`${(stats.divergence_rate_24h * 100).toFixed(1)}%`}
            subtitle="of probes with divergent clusters"
          />
        </StatGrid>
      )}

      {/* Deployments */}
      <div>
        <h2 className="text-sm font-semibold text-[var(--text)] mb-3">
          Deployments
          <span className="ml-2 text-xs font-normal text-[var(--text-faint)]">
            — click to expand per-indexer latency
          </span>
        </h2>
        {deploymentsLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="space-y-2">
            {(deploymentsData?.deployments ?? []).map((d) => (
              <DeploymentRow key={d.deployment_id} summary={d} />
            ))}
            {!deploymentsData?.deployments.length && !deploymentsLoading && (
              <p className="text-sm text-[var(--text-faint)] text-center py-8">No probe data yet.</p>
            )}
          </div>
        )}
      </div>

      {/* Divergence Events — only shown when there are some */}
      {!!feedData?.events.length && (
        <Card>
          <CardHeader>
            <CardTitle>Divergence Events</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="px-4 py-2 text-left text-[11px] font-medium text-[var(--text-muted)]">Probe ID</th>
                    <th className="px-4 py-2 text-left text-[11px] font-medium text-[var(--text-muted)]">Deployment</th>
                    <th className="px-4 py-2 text-left text-[11px] font-medium text-[var(--text-muted)]">Query</th>
                    <th className="px-4 py-2 text-right text-[11px] font-medium text-[var(--text-muted)]">Block</th>
                    <th className="px-4 py-2 text-right text-[11px] font-medium text-[var(--text-muted)]">Clusters</th>
                    <th className="px-4 py-2 text-right text-[11px] font-medium text-[var(--text-muted)]">Diff Ops</th>
                    <th className="px-4 py-2 text-right text-[11px] font-medium text-[var(--text-muted)]">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {feedData.events.map((ev) => (
                    <tr key={ev.probe_id} className="hover:bg-[var(--bg-elevated)]">
                      <td className="px-4 py-3">
                        <Link
                          href={`/foghorn/probe/${ev.probe_id}`}
                          className="font-mono text-xs text-[var(--accent)] hover:underline"
                        >
                          {ev.probe_id.slice(0, 8)}…
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs text-[var(--text-muted)]">
                          {shortenAddress(ev.deployment_id)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="default" className="text-[10px]">
                          {CATEGORY_LABELS[ev.query_category] ?? ev.query_category}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-mono text-xs text-[var(--text-muted)]">
                          {ev.block_number.toLocaleString()}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={cn(
                          'font-mono text-xs font-medium',
                          ev.cluster_count > 1 ? 'text-[var(--amber)]' : 'text-[var(--text)]'
                        )}>
                          {ev.cluster_count}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-mono text-xs text-[var(--text-muted)]">
                          {ev.diff_patch_count}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-xs text-[var(--text-faint)]">
                          {new Date(ev.dispatched_at).toLocaleString()}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Methodology */}
      <div className="text-[11px] text-[var(--text-faint)] leading-relaxed space-y-1 px-1">
        <p>
          <strong className="text-[var(--text-muted)]">Methodology.</strong> Foghorn dispatches
          identical GraphQL queries via The Graph gateway, which load-balances across allocating
          indexers. Responses are stripped of volatile fields, canonicalized via JCS (RFC 8785),
          and hashed with SHA-256. Latency is measured gateway-to-response. Allocation keys are
          recovered via EIP-712 ecrecover against the DisputeManager domain.
        </p>
        <p>
          <strong className="text-[var(--text-muted)]">No verdict.</strong> Foghorn does not label,
          rank, or flag indexers. Observations are neutral — consumers draw their own conclusions.
        </p>
      </div>
    </div>
  );
}
