'use client';

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

const DEPLOYMENT_INFO: Record<string, { label: string; network: string; url?: string }> = {
  '0x45c636b73728d75a77b84c782e2a44624a294c1414326e59f12d60e0a6e58f51': {
    label: 'Graph Network',
    network: 'Arbitrum One',
    url: 'https://thegraph.com/explorer/subgraphs/DZz4kDTdmzWLWsV373w2bSmoar3umKKH9y82SUKr5qmp',
  },
  '0xde0a7b5368f846f7d863d9f64949b688ad9818243151d488b4c6b206145b9ea3': {
    label: 'Premia Finance',
    network: 'Arbitrum One',
    // url: '' — not found on Graph Explorer; add manually if known
  },
  '0xce57e4bc7b885a6255edd3e9d1617bb8819559f3903b84c18bb5db31afe17d06': {
    label: 'ENS',
    network: 'Ethereum',
    url: 'https://thegraph.com/explorer/subgraphs/5XqPmWe6gjyrJtFn9cLy237i4cWw2j9HcUJEXsP5qGtH',
  },
  '0xe7b79e8051d136a6ab0ffd6016c7b7fd96dc63e220fe4071021844f36796398b': {
    label: 'Aave V2',
    network: 'Ethereum',
    url: 'https://thegraph.com/explorer/subgraphs/84CvqQHYhydZzr2KSth8s1AFYpBRzUbVJXq6PWuZm9U9',
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

function DeploymentRow({ summary }: { summary: DeploymentSummary }) {
  const info = DEPLOYMENT_INFO[summary.deployment_id];
  const label = info?.label ?? shortenAddress(summary.deployment_id);
  const network = info?.network ?? 'Unknown';

  return (
    <div className="border border-[var(--border)] rounded-lg overflow-hidden">
      <div className="flex items-center gap-4 px-4 py-3 bg-[var(--bg-elevated)]">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[var(--text)]">{label}</span>
            <Badge variant="default" className="text-[10px]">{network}</Badge>
          </div>
          {info?.url ? (
            <a
              href={info.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[10px] text-[var(--accent)] hover:underline"
            >
              {summary.deployment_id.slice(0, 18)}…
            </a>
          ) : (
            <span className="font-mono text-[10px] text-[var(--text-faint)]">
              {summary.deployment_id.slice(0, 18)}…
            </span>
          )}
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
            <div className="text-[10px] text-[var(--text-faint)]">allocations</div>
          </div>
          <div>
            <div className="text-sm text-[var(--text-muted)]">{timeAgo(summary.last_probe_at)}</div>
            <div className="text-[10px] text-[var(--text-faint)]">last probe</div>
          </div>
        </div>
      </div>
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
        <h2 className="text-sm font-semibold text-[var(--text)] mb-3">Deployments</h2>
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
