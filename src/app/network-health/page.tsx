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
interface TierCapture {
  tier: 'zero' | 'low' | 'fair' | 'good' | 'unscored';
  label: string;
  indexers: number;
  alloc_grt: number;
  alloc_share: number;
}
interface Concentration {
  totalAllocatedGrt: number;
  indexerCount: number;
  gini: number;
  nakamoto: number;
  topNShare: number;
  topN: number;
  tiers: TierCapture[];
  lowValueGrt: number;
  lowValueShare: number;
  productiveUpliftFactor: number;
}
interface Resp {
  data: {
    indexers: Row[];
    summary: { total: number; medianQ: number; flaggedGap: number; failing: number };
    concentration: Concentration;
  };
}

const TIER_COLOR: Record<TierCapture['tier'], string> = {
  zero: 'var(--red)',
  low: 'var(--amber)',
  unscored: 'var(--text-faint)',
  fair: 'var(--accent)',
  good: 'var(--green)',
};

type SortKey = 'q_score' | 'served_gap';

function pct(v: number | null): string {
  return v == null ? '—' : `${Math.round(v * 100)}`;
}

function ConcStat({ label, value, sub, bad }: { label: string; value: string; sub?: string; bad?: boolean }) {
  return (
    <div className="rounded-lg bg-[var(--bg-elevated)] px-3 py-2.5">
      <p className="text-[10px] text-[var(--text-faint)] mb-0.5">{label}</p>
      <p className={cn('text-lg font-semibold font-mono', bad ? 'text-[var(--red)]' : 'text-[var(--text)]')}>{value}</p>
      {sub && <p className="text-[10px] text-[var(--text-faint)] mt-0.5">{sub}</p>}
    </div>
  );
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
  const conc = data?.data.concentration;
  const fmtGrt = (g: number) =>
    g >= 1e6 ? `${(g / 1e6).toFixed(1)}M` : g >= 1e3 ? `${(g / 1e3).toFixed(0)}K` : g.toFixed(0);
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

      {conc && conc.totalAllocatedGrt > 0 && (
        <Card>
          <CardContent className="py-5">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-semibold text-[var(--text)]">Reward Distribution by Service Quality</h2>
              <span className="text-[11px] text-[var(--text-faint)]">{fmtGrt(conc.totalAllocatedGrt)} GRT allocated · {conc.indexerCount} indexers</span>
            </div>
            <p className="text-[11px] text-[var(--text-muted)] mb-4">
              Share of allocated stake (which earns indexing rewards) by QoS quality band.
            </p>

            {/* The harm chart: stacked allocation share by quality tier */}
            <div className="flex w-full h-8 rounded-lg overflow-hidden border border-[var(--border)]">
              {conc.tiers.map((t) => (
                <div
                  key={t.tier}
                  style={{ width: `${t.alloc_share * 100}%`, backgroundColor: TIER_COLOR[t.tier] }}
                  className="h-full"
                  title={`${t.label}: ${(t.alloc_share * 100).toFixed(1)}% · ${t.indexers} indexers · ${fmtGrt(t.alloc_grt)} GRT`}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
              {conc.tiers.map((t) => (
                <div key={t.tier} className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: TIER_COLOR[t.tier] }} />
                  <span className="text-[11px] text-[var(--text-muted)]">{t.label}</span>
                  <span className="text-[11px] font-mono text-[var(--text)]">{(t.alloc_share * 100).toFixed(0)}%</span>
                </div>
              ))}
            </div>

            {/* Concentration + crowding-out stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
              <ConcStat label="Low-value capture" value={`${(conc.lowValueShare * 100).toFixed(0)}%`} sub={`${fmtGrt(conc.lowValueGrt)} GRT to ~0-value`} bad={conc.lowValueShare > 0.2} />
              <ConcStat label="Counterfactual uplift" value={conc.productiveUpliftFactor === Infinity ? '∞' : `${conc.productiveUpliftFactor.toFixed(2)}×`} sub="if redistributed to productive" />
              <ConcStat label={`Top ${conc.topN} share`} value={`${(conc.topNShare * 100).toFixed(0)}%`} sub="stake concentration" bad={conc.topNShare > 0.5} />
              <ConcStat label="Gini / Nakamoto" value={`${conc.gini.toFixed(2)} / ${conc.nakamoto}`} sub="inequality · entities >50%" />
            </div>
          </CardContent>
        </Card>
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
