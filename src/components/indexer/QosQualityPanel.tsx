'use client';

import { useQuery } from '@tanstack/react-query';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { ChartSkeleton } from '@/components/ui/ChartSkeleton';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';

interface QosScoreLatest {
  day: string | null;
  reliability: number | null;
  lat_util: number | null;
  fresh_util: number | null;
  coverage: number | null;
  q_score: number | null;
}
interface QosScoreResponse {
  data: {
    latest: QosScoreLatest | null;
    daily: { day: string | null; q_score: number | null }[];
  };
}

export function qosGrade(q: number): { grade: string; variant: 'success' | 'accent' | 'warning' | 'error' } {
  if (q >= 75) return { grade: 'A', variant: 'success' };
  if (q >= 60) return { grade: 'B', variant: 'accent' };
  if (q >= 45) return { grade: 'C', variant: 'warning' };
  if (q >= 30) return { grade: 'D', variant: 'warning' };
  return { grade: 'F', variant: 'error' };
}

function Bar({ label, value, hint }: { label: string; value: number | null; hint?: string }) {
  const pct = Math.round((value ?? 0) * 100);
  const color = pct >= 80 ? 'var(--green)' : pct >= 50 ? 'var(--amber)' : 'var(--red)';
  return (
    <div title={hint}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-[var(--text-muted)]">{label}</span>
        <span className="text-xs font-mono text-[var(--text)]">{value == null ? '—' : `${pct}`}</span>
      </div>
      <div className="w-full h-1.5 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

export function QosQualityPanel({ indexer }: { indexer: string }) {
  const addr = indexer.toLowerCase();
  const { data, isLoading } = useQuery<QosScoreResponse>({
    queryKey: ['indexerQosScore', addr],
    queryFn: async () => {
      const r = await fetch(`/api/indexer/${addr}/qos-score`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    staleTime: 30 * 60 * 1000,
    retry: 1,
  });

  const latest = data?.data.latest ?? null;
  const series = (data?.data.daily ?? [])
    .filter((d) => d.q_score != null)
    .map((d) => ({ date: d.day ? new Date(d.day).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '', q: d.q_score as number }));

  const q = latest?.q_score != null ? Number(latest.q_score) : null;
  const grade = q != null ? qosGrade(q) : null;

  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>QoS Quality</CardTitle>
            <p className="text-[11px] text-[var(--text-faint)] mt-0.5">
              Selection-bias-aware service quality — not raw query volume
            </p>
          </div>
          {grade && (
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'text-2xl font-mono font-bold',
                  q! >= 75 ? 'text-[var(--green)]' : q! >= 45 ? 'text-[var(--amber)]' : 'text-[var(--red)]',
                )}
              >
                {q!.toFixed(0)}
              </span>
              <Badge variant={grade.variant}>{grade.grade}</Badge>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <ChartSkeleton height="180px" />
        ) : !latest || q == null ? (
          <div className="h-[120px] flex items-center justify-center text-center">
            <p className="text-sm text-[var(--text-faint)]">
              No QoS quality score yet — the oracle records data only for queries the gateway routed
              to this indexer.
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-3 mb-4">
              <Bar label="Reliability (Wilson)" value={latest.reliability} hint="Wilson lower-bound success rate — small samples can't fake a high score" />
              <Bar label="Latency" value={latest.lat_util} hint="Exponential-decay utility, normalised to the per-deployment peer cohort" />
              <Bar label="Freshness" value={latest.fresh_util} hint="Closeness to chain head (seconds behind)" />
              <Bar label="Coverage" value={latest.coverage} hint="Breadth of deployments served with credible volume" />
            </div>

            {series.length > 1 ? (
              <div className="h-[140px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={series} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="qosGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: 'var(--text-faint)', fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis domain={[0, 100]} axisLine={false} tickLine={false} tick={{ fill: 'var(--text-faint)', fontSize: 10 }} width={28} />
                    <Tooltip
                      contentStyle={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-mid)', borderRadius: 'var(--radius-button)', color: 'var(--text)', fontSize: 12 }}
                      formatter={(v) => [Number(v).toFixed(1), 'Q-score']}
                    />
                    <Area type="monotone" dataKey="q" stroke="var(--accent)" strokeWidth={2} fill="url(#qosGrad)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-[10px] text-[var(--text-faint)]">History builds daily as the scoring cron runs.</p>
            )}

            <p className="text-[10px] text-[var(--text-faint)] mt-3 leading-relaxed">
              Wilson-reliability × latency-decay × freshness (weighted product), EWMA-decayed over 30 days
              and normalised per-deployment, then weighted by served-query share. QoS Oracle V1 data;
              latency uses averages (p90/p99 pending V2). Absence of data ≠ absence of problems — a low
              score can mean the gateway routes around this indexer.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
