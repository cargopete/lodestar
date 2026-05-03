'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

interface IndexerQuality {
  indexer_address: string;
  days: number;
  total_probes: number;
  divergent_probes: number;
  divergence_rate: number;
  avg_latency_ms: number | null;
  p50_latency_ms: number | null;
  p95_latency_ms: number | null;
  by_deployment: Array<{
    deployment_id: string;
    total_probes: number;
    divergent_probes: number;
    divergence_rate: number;
  }>;
  recent_probes: Array<{
    probe_id: string;
    deployment_id: string;
    query_category: string;
    dispatched_at: string;
    response_hash: string | null;
    divergent: boolean;
  }>;
}

function useIndexerQuality(address: string) {
  return useQuery<IndexerQuality>({
    queryKey: ['foghorn-indexer-quality', address],
    queryFn: async () => {
      const r = await fetch(`/api/foghorn/indexer/${encodeURIComponent(address)}/quality`);
      if (!r.ok) throw new Error(`${r.status}`);
      return r.json();
    },
    staleTime: 60_000,
    retry: 1,
  });
}

export function FoghornQuality({ address }: { address: string }) {
  const { data, isLoading, error } = useIndexerQuality(address.toLowerCase());

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Foghorn Quality</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 py-4">
            <div className="w-4 h-4 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-[var(--text-muted)]">Loading…</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Foghorn Quality</CardTitle>
            <Badge variant="default" className="text-[10px]">Unavailable</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[var(--text-faint)]">
            Foghorn is not configured or this indexer has not opted in.{' '}
            <Link href="/foghorn" className="text-[var(--accent)] hover:underline">
              Learn more →
            </Link>
          </p>
        </CardContent>
      </Card>
    );
  }

  const divergencePercent = (data.divergence_rate * 100).toFixed(1);
  const hasData = data.total_probes > 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Foghorn Quality</CardTitle>
          <Link
            href="/foghorn"
            className="text-xs text-[var(--accent)] hover:underline"
          >
            View all →
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <p className="text-sm text-[var(--text-faint)]">
            No probes recorded for this indexer yet.
          </p>
        ) : (
          <div className="space-y-4">
            {/* Top metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="text-center p-3 rounded-lg bg-[var(--bg-elevated)]">
                <p className="text-[10px] text-[var(--text-faint)] mb-1">Probes (30d)</p>
                <p className="text-lg font-mono font-semibold text-[var(--text)]">
                  {data.total_probes.toLocaleString()}
                </p>
              </div>
              <div className="text-center p-3 rounded-lg bg-[var(--bg-elevated)]">
                <p className="text-[10px] text-[var(--text-faint)] mb-1">Divergence Rate</p>
                <p className={cn(
                  'text-lg font-mono font-semibold',
                  data.divergence_rate === 0 ? 'text-[var(--green)]' :
                  data.divergence_rate < 0.05 ? 'text-[var(--amber)]' : 'text-[var(--red)]'
                )}>
                  {divergencePercent}%
                </p>
              </div>
              <div className="text-center p-3 rounded-lg bg-[var(--bg-elevated)]">
                <p className="text-[10px] text-[var(--text-faint)] mb-1">P50 Latency</p>
                <p className="text-lg font-mono font-semibold text-[var(--text)]">
                  {data.p50_latency_ms !== null ? `${Math.round(data.p50_latency_ms)}ms` : '—'}
                </p>
              </div>
              <div className="text-center p-3 rounded-lg bg-[var(--bg-elevated)]">
                <p className="text-[10px] text-[var(--text-faint)] mb-1">P95 Latency</p>
                <p className={cn(
                  'text-lg font-mono font-semibold',
                  data.p95_latency_ms !== null && data.p95_latency_ms < 1000 ? 'text-[var(--green)]' :
                  data.p95_latency_ms !== null && data.p95_latency_ms < 3000 ? 'text-[var(--amber)]' : 'text-[var(--red)]'
                )}>
                  {data.p95_latency_ms !== null ? `${Math.round(data.p95_latency_ms)}ms` : '—'}
                </p>
              </div>
            </div>

            {/* Per-deployment breakdown */}
            {data.by_deployment.length > 0 && (
              <div>
                <p className="text-[11px] text-[var(--text-faint)] mb-2">By deployment</p>
                <div className="space-y-2">
                  {data.by_deployment.map((dep) => (
                    <div key={dep.deployment_id} className="flex items-center gap-3">
                      <span className="font-mono text-xs text-[var(--text-muted)] w-24 flex-shrink-0 truncate">
                        {dep.deployment_id.slice(0, 10)}…
                      </span>
                      <div className="flex-1 h-1.5 rounded-full bg-[var(--bg)] overflow-hidden">
                        <div
                          className={cn(
                            'h-full rounded-full',
                            dep.divergence_rate === 0 ? 'bg-[var(--green)]' :
                            dep.divergence_rate < 0.05 ? 'bg-[var(--amber)]' : 'bg-[var(--red)]'
                          )}
                          style={{ width: `${Math.min(dep.divergence_rate * 100, 100)}%` }}
                        />
                      </div>
                      <span className="text-xs font-mono text-[var(--text-muted)] w-10 text-right">
                        {(dep.divergence_rate * 100).toFixed(1)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Cluster timeline — last 20 probes */}
            {data.recent_probes.length > 0 && (
              <div>
                <p className="text-[11px] text-[var(--text-faint)] mb-2">
                  Recent probe cluster membership (latest 20)
                </p>
                <div className="flex gap-1 flex-wrap">
                  {data.recent_probes.map((p) => (
                    <Link
                      key={p.probe_id}
                      href={`/foghorn/probe/${p.probe_id}`}
                      title={`${p.query_category} @ ${new Date(p.dispatched_at).toLocaleString()}`}
                      className={cn(
                        'w-4 h-4 rounded-sm transition-opacity hover:opacity-70',
                        p.divergent ? 'bg-[var(--amber)]' : 'bg-[var(--green)]',
                        !p.response_hash && 'bg-[var(--red)]'
                      )}
                    />
                  ))}
                </div>
                <p className="text-[10px] text-[var(--text-faint)] mt-1.5">
                  <span className="inline-block w-2.5 h-2.5 rounded-sm bg-[var(--green)] mr-1 align-middle" />consensus
                  <span className="inline-block w-2.5 h-2.5 rounded-sm bg-[var(--amber)] ml-3 mr-1 align-middle" />divergent
                  <span className="inline-block w-2.5 h-2.5 rounded-sm bg-[var(--red)] ml-3 mr-1 align-middle" />no response
                </p>
              </div>
            )}

            <p className="text-[10px] text-[var(--text-faint)] leading-relaxed border-t border-[var(--border)] pt-3">
              Source: Foghorn — block-pinned query probes against opted-in indexers. Observations are
              neutral; cluster membership and diffs carry no verdict about indexer behaviour.{' '}
              <Link href="/foghorn" className="text-[var(--accent)] hover:underline">Methodology →</Link>
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
