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
import { qosGrade } from '@/lib/qos-score';

interface QosScoreLatest {
  day: string | null;
  reliability: number | null;
  lat_util: number | null;
  fresh_util: number | null;
  coverage: number | null;
  served_gap: number | null;
  efficiency: number | null;
  q_score: number | null;
}
interface QosScoreResponse {
  data: {
    latest: QosScoreLatest | null;
    daily: { day: string | null; q_score: number | null }[];
  };
}

interface DeploymentRow {
  deployment_id: string;
  queries: number;
  weight: number;
  reliability: number | null;
  reliability_used: number | null;
  cohort_best_reliability: number | null;
  lat_util: number;
  fresh_util: number | null;
  time_behind_own_sec: number | null;
  q: number | null;
  measured: boolean;
  drag: number;
}

/** "~69 min behind", "~3 h behind", "~2 d behind". */
function formatBehind(seconds: number): string {
  if (seconds < 90) return `~${Math.round(seconds)}s behind`;
  const min = seconds / 60;
  if (min < 90) return `~${Math.round(min)} min behind`;
  const hours = min / 60;
  if (hours < 48) return `~${Math.round(hours)} h behind`;
  return `~${Math.round(hours / 24)} d behind`;
}

/**
 * Which of the three axes is actually costing this deployment its score, and by how much.
 *
 * Without this the panel showed a deployment at 100% success wearing the longest red bar on the
 * page, which reads as a contradiction and tells an operator nothing. The score is a product,
 * `R · U_lat · U_fresh^0.5`, so the axis to name is whichever factor is furthest below 1 once the
 * freshness exponent is applied.
 */
function dominantDeficit(d: DeploymentRow): { label: string; color: string; loss: number } | null {
  const candidates = [
    { key: 'reliability', loss: 1 - (d.reliability_used ?? 1), color: 'var(--red)' },
    { key: 'latency', loss: 1 - d.lat_util, color: 'var(--accent)' },
    // Freshness enters the product at exponent 0.5, so its effective drag is 1 - sqrt(U_fresh).
    { key: 'freshness', loss: d.fresh_util === null ? 0 : 1 - Math.sqrt(d.fresh_util), color: 'var(--amber)' },
  ];
  const worst = candidates.reduce((a, b) => (b.loss > a.loss ? b : a));
  if (worst.loss < 0.02) return null;

  if (worst.key === 'freshness') {
    return {
      label: d.time_behind_own_sec != null ? formatBehind(d.time_behind_own_sec) : 'behind chain head',
      color: worst.color,
      loss: worst.loss,
    };
  }
  if (worst.key === 'latency') return { label: 'slow vs peers', color: worst.color, loss: worst.loss };
  return { label: 'serving errors', color: worst.color, loss: worst.loss };
}

/**
 * Which deployments are holding the score down, heaviest first.
 *
 * The panel used to show four bars and a grade, which is enough to tell an operator they have a
 * problem and nothing whatever about where it is. The one who prompted this had a single subgraph
 * carrying 78% of his traffic and failing on a mapping fault; every other deployment he served was
 * at 99-100%. None of that was visible here.
 */
function DeploymentDrag({ addr }: { addr: string }) {
  const { data } = useQuery<{ data: { deployments: DeploymentRow[] } }>({
    queryKey: ['indexerQosDeployments', addr],
    queryFn: async () => {
      const r = await fetch(`/api/indexer/${addr}/qos-deployments`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    staleTime: 30 * 60 * 1000,
    retry: 1,
  });

  const rows = (data?.data.deployments ?? []).filter((d) => d.measured && d.drag > 0.005).slice(0, 5);
  if (rows.length === 0) return null;

  return (
    <div className="mb-4">
      <div className="flex items-baseline justify-between mb-1.5">
        <p className="text-xs font-medium text-[var(--text)]">What is holding the score down</p>
        <p className="text-[10px] text-[var(--text-faint)]">bar = share of the score lost here</p>
      </div>
      <div className="space-y-1.5">
        {rows.map((d) => {
          const cohortBroken =
            d.cohort_best_reliability != null && d.cohort_best_reliability < 0.9;
          const deficit = dominantDeficit(d);
          return (
            <div key={d.deployment_id} className="flex items-center gap-2 text-[11px]">
              <code className="text-[var(--text-muted)] truncate max-w-[8rem]" title={d.deployment_id}>
                {d.deployment_id.slice(0, 10)}…
              </code>
              <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
                {/* Coloured by the axis actually failing, so a deployment serving perfectly but
                    lagging never reads as an error. */}
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.min(100, d.drag * 100)}%`,
                    backgroundColor: deficit?.color ?? 'var(--text-faint)',
                  }}
                />
              </div>
              <span className="font-mono text-[var(--text-muted)] tabular-nums shrink-0">
                {(d.weight * 100).toFixed(0)}% of traffic
              </span>
              <span
                className="font-mono text-[var(--text-faint)] tabular-nums w-10 text-right shrink-0"
                title="Success rate over the window"
              >
                {d.reliability != null ? `${(d.reliability * 100).toFixed(0)}%` : '—'}
              </span>
              <span
                className="tabular-nums w-[6.5rem] text-right shrink-0"
                style={{ color: deficit?.color ?? 'var(--text-faint)' }}
                title={deficit ? `The largest single factor costing this deployment score` : undefined}
              >
                {deficit?.label ?? 'healthy'}
              </span>
              {cohortBroken && (
                <span
                  className="text-[10px] text-[var(--text-faint)] shrink-0"
                  title="Every indexer measured on this deployment is struggling, so it is graded against what the cohort achieves rather than against perfection."
                >
                  cohort
                </span>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-[var(--text-faint)] mt-1.5 leading-relaxed">
        Share of served queries, success rate, then the biggest single reason that deployment is
        costing you score — a subgraph can be answered perfectly and still drag the grade by lagging
        chain head. A deployment marked “cohort” is failing for every indexer serving it, which is
        usually the subgraph rather than the operator.
      </p>
    </div>
  );
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
              Selection-bias-aware service quality, not raw query volume
            </p>
          </div>
          {grade && (
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'text-2xl font-mono font-bold',
                  q! >= 75 ? 'text-[var(--green)]' : q! >= 45 ? 'text-[var(--amber)]' : 'text-[var(--red-text)]',
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
              No QoS quality score yet; the oracle records data only for queries the gateway routed
              to this indexer.
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-3 mb-4">
              <Bar label="Reliability (Wilson)" value={latest.reliability} hint="Wilson lower-bound success rate, so small samples can't fake a high score" />
              <Bar label="Latency" value={latest.lat_util} hint="Exponential-decay utility, normalised to the per-deployment peer cohort" />
              <Bar label="Freshness" value={latest.fresh_util} hint="Closeness to chain head (seconds behind)" />
              <Bar label="Coverage" value={latest.coverage} hint="Breadth of deployments served with credible volume" />
            </div>

            {/* Selection-bias: served-vs-allocated gap (the routed-around / crowding signal) */}
            {latest.served_gap != null && (() => {
              const gap = Number(latest.served_gap);
              const flagged = gap > 0.3;
              return (
                <div className={cn(
                  'flex items-start gap-2.5 p-2.5 mb-4 rounded-lg border',
                  flagged ? 'bg-[var(--red-dim)] border-[var(--red)]' : 'bg-[var(--bg-elevated)] border-[var(--border)]',
                )}>
                  <span className={cn('text-sm font-mono font-semibold mt-0.5', flagged ? 'text-[var(--red-text)]' : gap < 0 ? 'text-[var(--green)]' : 'text-[var(--text-muted)]')}>
                    {gap >= 0 ? '+' : ''}{(gap * 100).toFixed(0)}%
                  </span>
                  <div>
                    <p className="text-xs font-medium text-[var(--text)]">Served-vs-allocated gap</p>
                    <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                      {flagged
                        ? 'Holds allocation but the gateway routes queries around it, capturing rewards without serving proportional traffic.'
                        : gap < 0
                          ? 'Serves more query traffic than its allocation share, pulling its weight.'
                          : 'Served share roughly tracks allocation share.'}
                    </p>
                  </div>
                </div>
              );
            })()}

            <DeploymentDrag addr={addr} />

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
              and normalised per-deployment, then weighted by queries served. QoS Oracle V1 data;
              latency uses averages (p90/p99 pending V2). Absence of data ≠ absence of problems: a low
              score can mean the gateway routes around this indexer.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
