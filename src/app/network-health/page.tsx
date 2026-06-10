'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { StatCard, StatGrid } from '@/components/ui/StatCard';
import { shortenAddress, cn } from '@/lib/utils';
import { qosGrade } from '@/lib/qos-score';

interface Row {
  address: string;
  name: string | null;
  ens_name: string | null;
  q_score: number | null;
  reliability: number | null;
  lat_util: number | null;
  fresh_util: number | null;
  coverage: number | null;
  served_gap: number | null;
  efficiency: number | null;
  old_grade: string | null;
  allocation_count: number | null;
}
interface Resp {
  data: {
    indexers: Row[];
    summary: { total: number; medianQ: number; flaggedGap: number; failing: number };
  };
}

type SortKey = 'q_score' | 'served_gap';

function pct(v: number | null): string {
  return v == null ? '—' : `${Math.round(v * 100)}`;
}

export default function NetworkHealthPage() {
  const [sort, setSort] = useState<SortKey>('q_score');
  const { data, isLoading } = useQuery<Resp>({
    queryKey: ['networkHealth'],
    queryFn: async () => {
      const r = await fetch('/api/network-health');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    staleTime: 30 * 60 * 1000,
  });

  const indexers = (data?.data.indexers ?? []).filter((r) => r.q_score != null);
  const summary = data?.data.summary;
  const rows = [...indexers].sort((a, b) =>
    sort === 'q_score'
      ? (b.q_score ?? 0) - (a.q_score ?? 0)
      : (b.served_gap ?? -1) - (a.served_gap ?? -1),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--text)]">Network Health &amp; Integrity</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1 max-w-3xl">
          Selection-bias-aware QoS quality scoring across all indexers the gateway routed traffic to.
          Ranks on actual service quality — Wilson-reliability, latency, freshness — not raw query volume,
          and flags indexers holding allocations the gateway routes around.
        </p>
      </div>

      {summary && (
        <StatGrid>
          <StatCard label="Indexers Scored" value={String(summary.total)} />
          <StatCard label="Median Q-Score" value={summary.medianQ.toFixed(0)} subtitle="out of 100" />
          <StatCard label="Low Quality (Q<30)" value={String(summary.failing)} subtitle="poor / barely-serving" />
          <StatCard label="Routed-Around" value={String(summary.flaggedGap)} subtitle="served-gap > 30%" />
        </StatGrid>
      )}

      <Card>
        <CardContent className="py-0 px-0 sm:px-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-7 h-7 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : rows.length === 0 ? (
            <p className="text-center text-sm text-[var(--text-faint)] py-20">No QoS scores computed yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="px-3 py-2.5 text-left text-[11px] font-medium text-[var(--text-muted)]">#</th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-medium text-[var(--text-muted)]">Indexer</th>
                    <th className="px-3 py-2.5 text-right text-[11px] font-medium text-[var(--text-muted)]">
                      <button onClick={() => setSort('q_score')} className={cn('hover:text-[var(--text)]', sort === 'q_score' && 'text-[var(--accent)]')}>
                        Q-Score ↓
                      </button>
                    </th>
                    <th className="px-3 py-2.5 text-right text-[11px] font-medium text-[var(--text-muted)] hidden sm:table-cell">Reliab.</th>
                    <th className="px-3 py-2.5 text-right text-[11px] font-medium text-[var(--text-muted)] hidden md:table-cell">Latency</th>
                    <th className="px-3 py-2.5 text-right text-[11px] font-medium text-[var(--text-muted)] hidden md:table-cell">Fresh</th>
                    <th className="px-3 py-2.5 text-right text-[11px] font-medium text-[var(--text-muted)]">
                      <button onClick={() => setSort('served_gap')} className={cn('hover:text-[var(--text)]', sort === 'served_gap' && 'text-[var(--accent)]')}>
                        Gap
                      </button>
                    </th>
                    <th className="px-3 py-2.5 text-center text-[11px] font-medium text-[var(--text-muted)] hidden lg:table-cell" title="Existing delegator-risk grade, for contrast">Old Grade</th>
                    <th className="px-3 py-2.5 text-right text-[11px] font-medium text-[var(--text-muted)] hidden lg:table-cell">Allocs</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {rows.map((r, i) => {
                    const q = r.q_score ?? 0;
                    const g = qosGrade(q);
                    const gap = r.served_gap;
                    const flagged = (gap ?? 0) > 0.3;
                    const name = r.ens_name || r.name || shortenAddress(r.address);
                    return (
                      <tr key={r.address} className="hover:bg-[var(--bg-elevated)]">
                        <td className="px-3 py-2.5 text-sm text-[var(--text-faint)] tabular-nums">{i + 1}</td>
                        <td className="px-3 py-2.5">
                          <Link href={`/indexers/${r.address}`} className="text-sm text-[var(--text)] hover:text-[var(--accent)] transition-colors">
                            {name}
                          </Link>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <span className={cn('font-mono text-sm font-semibold', q >= 75 ? 'text-[var(--green)]' : q >= 45 ? 'text-[var(--amber)]' : 'text-[var(--red)]')}>
                              {q.toFixed(0)}
                            </span>
                            <Badge variant={g.variant}>{g.grade}</Badge>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-xs text-[var(--text-muted)] hidden sm:table-cell">{pct(r.reliability)}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-xs text-[var(--text-muted)] hidden md:table-cell">{pct(r.lat_util)}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-xs text-[var(--text-muted)] hidden md:table-cell">{pct(r.fresh_util)}</td>
                        <td className={cn('px-3 py-2.5 text-right font-mono text-xs', flagged ? 'text-[var(--red)] font-semibold' : gap != null && gap < 0 ? 'text-[var(--green)]' : 'text-[var(--text-faint)]')}>
                          {gap == null ? '—' : `${gap >= 0 ? '+' : ''}${(gap * 100).toFixed(0)}%`}
                        </td>
                        <td className="px-3 py-2.5 text-center hidden lg:table-cell">
                          {r.old_grade && <span className="text-xs font-mono text-[var(--text-faint)]">{r.old_grade}</span>}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-xs text-[var(--text-muted)] hidden lg:table-cell tabular-nums">{r.allocation_count ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-[11px] text-[var(--text-faint)] leading-relaxed max-w-3xl">
        Q-Score = Wilson-reliability × latency-decay × freshness (weighted product), EWMA-decayed over
        30 days, normalised per-deployment, weighted by served-query share. <strong>Gap</strong> = allocation
        share minus served-query share (high positive = the gateway routes around this indexer despite its
        allocations). Source: QoS Oracle V1. Informational; absence of routed data ≠ absence of problems.
        Clustering &amp; crowding-out analysis coming next.
      </p>
    </div>
  );
}
