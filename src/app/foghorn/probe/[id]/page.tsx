'use client';

import { use } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

interface ProbeDetail {
  probe: {
    id: string;
    deployment_id: string;
    block_hash: string;
    block_number: number;
    query_category: string;
    query_text: string;
    dispatched_at: string;
  };
  observations: Array<{
    indexer_address: string;
    response_hash: string | null;
    latency_ms: number | null;
    meta_block_number: number | null;
    meta_block_hash: string | null;
    http_status: number | null;
    error_class: string | null;
    stake_weight: number;
  }>;
  divergence: {
    cluster_count: number;
    diff_patches: unknown[];
    largest_by_count: { hash: string; size: number };
    largest_by_stake: { hash: string; weight: number };
  } | null;
}

function useProbeDetail(id: string) {
  return useQuery<ProbeDetail>({
    queryKey: ['foghorn-probe', id],
    queryFn: async () => {
      const r = await fetch(`/api/foghorn/probe/${id}`);
      if (!r.ok) throw new Error(`${r.status}`);
      return r.json();
    },
    staleTime: 30 * 60_000, // immutable after write
  });
}

// Assign a deterministic short label and colour to each unique response hash
function hashLabel(hash: string | null, index: Map<string, number>): { label: string; color: string } {
  if (!hash) return { label: '—', color: 'var(--text-faint)' };
  if (!index.has(hash)) index.set(hash, index.size);
  const i = index.get(hash)!;
  const colors = ['var(--accent)', 'var(--amber)', 'var(--green)', 'var(--red)', 'var(--teal, var(--green))'];
  return {
    label: `C${i + 1}`,
    color: colors[i % colors.length],
  };
}

export default function ProbeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, isLoading, error } = useProbeDetail(id);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="text-center py-24">
        <p className="text-[var(--text-muted)]">Probe not found.</p>
        <Link href="/foghorn" className="text-sm text-[var(--accent-text)] hover:underline mt-4 inline-block">
          ← Back to Foghorn
        </Link>
      </div>
    );
  }

  const { probe, observations, divergence } = data;

  // Build hash→label index for consistent colouring
  const hashIndex = new Map<string, number>();
  observations.forEach((o) => o.response_hash && hashLabel(o.response_hash, hashIndex));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-1">
            <Link href="/foghorn" className="text-sm text-[var(--text-faint)] hover:text-[var(--text)]">
              ← Foghorn
            </Link>
          </div>
          <h1 className="text-lg font-semibold text-[var(--text)] font-mono truncate">
            Probe {probe.id}
          </h1>
          <div className="flex items-center gap-3 mt-1">
            <Badge variant={divergence ? 'warning' : 'success'}>
              {divergence ? `${divergence.cluster_count} clusters` : 'Consensus'}
            </Badge>
            <span className="text-xs text-[var(--text-faint)]">
              {new Date(probe.dispatched_at).toLocaleString()}
            </span>
          </div>
        </div>
      </div>

      {/* Probe metadata */}
      <Card>
        <CardHeader>
          <CardTitle>Probe Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            {[
              ['Deployment', <span key="d" className="font-mono text-xs">{probe.deployment_id}</span>],
              ['Block', <span key="b" className="font-mono text-xs">{probe.block_number.toLocaleString()}</span>],
              ['Block hash', <span key="bh" className="font-mono text-xs break-all">{probe.block_hash}</span>],
              ['Query category', <Badge key="qc" variant="default" className="text-[10px]">{probe.query_category}</Badge>],
            ].map(([label, value]) => (
              <div key={String(label)} className="flex items-start justify-between gap-4 py-1.5 border-b border-[var(--border)] last:border-0">
                <span className="text-[var(--text-muted)] flex-shrink-0">{label}</span>
                <span className="text-right">{value}</span>
              </div>
            ))}
          </div>
          {/* Query text */}
          <div className="mt-4">
            <p className="text-xs text-[var(--text-muted)] mb-2">Query</p>
            <pre className="text-xs font-mono text-[var(--text)] bg-[var(--bg)] p-3 rounded-lg overflow-x-auto border border-[var(--border)] whitespace-pre-wrap">
              {probe.query_text}
            </pre>
          </div>
        </CardContent>
      </Card>

      {/* Divergence diff */}
      {divergence && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>RFC 6902 Diff</CardTitle>
              <span className="text-xs text-[var(--text-faint)]">
                {Array.isArray(divergence.diff_patches) ? divergence.diff_patches.length : 0} operations
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4 mb-4 text-xs">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--accent)' }} />
                <span className="text-[var(--text-muted)]">
                  Cluster C1 · {divergence.largest_by_count.size} allocations (largest by count)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--amber)' }} />
                <span className="text-[var(--text-muted)]">Cluster C2 · remainder</span>
              </div>
            </div>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {Array.isArray(divergence.diff_patches) && divergence.diff_patches.length > 0 ? (
                (divergence.diff_patches as Array<{ op: string; path: string; value?: unknown; from?: string }>).map(
                  (op, i) => (
                    <div
                      key={i}
                      className={cn(
                        'flex items-start gap-3 p-2.5 rounded-lg text-xs font-mono',
                        op.op === 'add' && 'bg-[var(--green-dim)]',
                        op.op === 'remove' && 'bg-[var(--red-dim)]',
                        op.op === 'replace' && 'bg-[var(--amber-dim)]',
                        !['add', 'remove', 'replace'].includes(op.op) && 'bg-[var(--bg-elevated)]'
                      )}
                    >
                      <span className={cn(
                        'uppercase text-[10px] font-bold w-14 flex-shrink-0 pt-0.5',
                        op.op === 'add' && 'text-[var(--green)]',
                        op.op === 'remove' && 'text-[var(--red)]',
                        op.op === 'replace' && 'text-[var(--amber)]'
                      )}>
                        {op.op}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[var(--text)] break-all">{op.path}</p>
                        {op.value !== undefined && (
                          <p className="text-[var(--text-muted)] truncate mt-0.5">
                            → {JSON.stringify(op.value).slice(0, 120)}
                          </p>
                        )}
                      </div>
                    </div>
                  )
                )
              ) : (
                <p className="text-sm text-[var(--text-faint)]">No diff available.</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Observations */}
      <Card>
        <CardHeader>
          <CardTitle>Observations ({observations.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="px-4 py-2 text-left text-[11px] font-medium text-[var(--text-muted)]">Allocation</th>
                  <th className="px-4 py-2 text-left text-[11px] font-medium text-[var(--text-muted)]">Cluster</th>
                  <th className="px-4 py-2 text-right text-[11px] font-medium text-[var(--text-muted)]">Latency</th>
                  <th className="px-4 py-2 text-right text-[11px] font-medium text-[var(--text-muted)] hidden sm:table-cell">Meta block</th>
                  <th className="px-4 py-2 text-right text-[11px] font-medium text-[var(--text-muted)]">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {observations.map((obs) => {
                  const { label, color } = hashLabel(obs.response_hash, hashIndex);
                  return (
                    <tr key={obs.indexer_address} className="hover:bg-[var(--bg-elevated)]">
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs text-[var(--text)]" title={obs.indexer_address}>
                          {obs.indexer_address.slice(0, 10)}…
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                          <span className="text-xs font-mono" style={{ color }}>
                            {label}
                          </span>
                        </div>
                        {obs.response_hash && (
                          <p className="text-[10px] font-mono text-[var(--text-faint)] mt-0.5">
                            {obs.response_hash.slice(0, 12)}…
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={cn(
                          'text-xs font-mono',
                          obs.latency_ms !== null && obs.latency_ms < 500 ? 'text-[var(--green)]' :
                          obs.latency_ms !== null && obs.latency_ms < 2000 ? 'text-[var(--amber)]' : 'text-[var(--red)]'
                        )}>
                          {obs.latency_ms !== null ? `${obs.latency_ms}ms` : '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right hidden sm:table-cell">
                        <span className="text-xs font-mono text-[var(--text-muted)]">
                          {obs.meta_block_number?.toLocaleString() ?? '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {obs.error_class ? (
                          <Badge variant="error" className="text-[10px]">{obs.error_class}</Badge>
                        ) : (
                          <Badge variant="success" className="text-[10px]">OK</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Reproducibility */}
      <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)]">
        <p className="text-xs font-medium text-[var(--text-muted)] mb-2">Reproduce this probe</p>
        <pre className="text-[11px] font-mono text-[var(--text-faint)] whitespace-pre-wrap">
          {`curl -X POST https://<indexer-url>/subgraphs/id/<deployment> \\
  -H "Content-Type: application/json" \\
  -d '{"query": ${JSON.stringify(probe.query_text)}, "variables": {"block": {"hash": "${probe.block_hash}"}}}'`}
        </pre>
      </div>
    </div>
  );
}
