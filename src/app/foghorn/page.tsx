'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { cn, shortenAddress } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { StatCard, StatGrid } from '@/components/ui/StatCard';

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

interface Stats {
  total_probes: number;
  total_divergences: number;
  opted_in_indexers: number;
  deployments_covered: number;
  divergence_rate_24h: number;
  probes_24h: number;
  divergences_24h: number;
}

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

function useFoghornFeed(deploymentId?: string) {
  return useQuery<{ events: FeedEvent[]; count: number }>({
    queryKey: ['foghorn-feed', deploymentId],
    queryFn: async () => {
      const qs = deploymentId ? `?deployment_id=${encodeURIComponent(deploymentId)}` : '';
      const r = await fetch(`/api/foghorn/feed${qs}`);
      if (!r.ok) throw new Error(`${r.status}`);
      return r.json();
    },
    staleTime: 60_000,
    retry: 1,
  });
}

const CATEGORY_LABELS: Record<string, string> = {
  Q_byid: 'By ID',
  Q_agg: 'Aggregate',
  Q_freshness: 'Freshness',
  Q_timetravel: 'Time-travel',
};

export default function FoghornPage() {
  const [deploymentFilter, setDeploymentFilter] = useState('');

  const { data: stats, isLoading: statsLoading } = useFoghornStats();
  const { data: feedData, isLoading: feedLoading } = useFoghornFeed(
    deploymentFilter || undefined
  );

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
          Block-pinned query probes fired at opted-in indexers. Responses are
          canonicalized, hashed, and clustered. Divergence events appear here when
          indexers return different data for the same deterministic query.
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
            label="Divergences"
            value={stats.total_divergences.toLocaleString()}
            subtitle={`${stats.divergences_24h} in last 24h`}
          />
          <StatCard
            label="Divergence Rate (24h)"
            value={`${(stats.divergence_rate_24h * 100).toFixed(1)}%`}
            subtitle="of probes with divergent clusters"
          />
          <StatCard
            label="Opted-in Indexers"
            value={stats.opted_in_indexers.toLocaleString()}
            subtitle={`across ${stats.deployments_covered} deployments`}
          />
        </StatGrid>
      )}

      {/* Feed */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <CardTitle>Divergence Events</CardTitle>
            <input
              type="text"
              placeholder="Filter by deployment ID..."
              value={deploymentFilter}
              onChange={(e) => setDeploymentFilter(e.target.value)}
              className="text-xs px-3 py-1.5 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-[var(--radius-button)] text-[var(--text)] placeholder-[var(--text-faint)] outline-none focus:ring-1 focus:ring-[var(--accent)] w-56"
            />
          </div>
        </CardHeader>
        <CardContent>
          {feedLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : !feedData?.events.length ? (
            <div className="text-center py-12">
              <p className="text-sm text-[var(--text-faint)]">
                {stats ? 'No divergence events yet — probes running.' : 'No data available.'}
              </p>
            </div>
          ) : (
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
          )}
        </CardContent>
      </Card>

      {/* Methodology note */}
      <div className="text-[11px] text-[var(--text-faint)] leading-relaxed space-y-1 px-1">
        <p>
          <strong className="text-[var(--text-muted)]">Methodology.</strong> Foghorn dispatches
          identical, block-hash-pinned GraphQL queries to opted-in indexers. Responses are stripped
          of volatile fields, canonicalized via JCS (RFC 8785), and hashed with SHA-256. Indexers
          returning the same hash belong to the same cluster. When clusters diverge, an RFC 6902
          JSON-Patch diff between cluster representatives is computed and stored.
        </p>
        <p>
          <strong className="text-[var(--text-muted)]">No verdict.</strong> Foghorn does not label,
          rank, or flag indexers. Cluster membership and diffs are neutral observations — consumers
          draw their own conclusions.
        </p>
      </div>
    </div>
  );
}
