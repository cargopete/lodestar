'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { ChartSkeleton } from '@/components/ui/ChartSkeleton';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { formatGRT, formatGRTFull, formatUSD, cn } from '@/lib/utils';

const WINDOWS = [7, 30, 90, 365] as const;
type Window = (typeof WINDOWS)[number];

// Default archive-node selection when the panel first loads.
const DEFAULT_CHAINS = ['arbitrum', 'mainnet'];

interface RevenueDay {
  date: string;
  rav_grt: number;
  indexing_rewards_grt: number;
  total_grt: number;
}
interface RevenueResponse {
  data: {
    rav_grt: number;
    indexing_rewards_grt: number;
    total_grt: number;
    daily: RevenueDay[];
  };
}
interface ChainCost {
  key: string;
  label: string;
  storageTb: number | null;
  monthlyUsd: number;
}
interface DeploymentPnl {
  deployment_id: string | null;
  revenue_grt: number;
  revenue_usd: number | null;
}
interface PnlResponse {
  data: {
    pnl: {
      revenue_grt: number;
      revenue_usd: number | null;
      infra_cost_usd: number;
      infra_monthly_usd: number;
      net_usd: number | null;
      margin_pct: number | null;
      breakeven_grt_price: number | null;
      perDeployment: DeploymentPnl[];
    };
    costModel: { totalMonthlyUsd: number };
    defaultChainCosts: Record<string, ChainCost>;
  };
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function PnlPanel({ indexer, grtPrice }: { indexer: string; grtPrice: number }) {
  const [window, setWindow] = useState<Window>(30);
  const [chains, setChains] = useState<string[]>(DEFAULT_CHAINS);

  const addr = indexer.toLowerCase();
  const priceQuery = grtPrice > 0 ? `&grtPrice=${grtPrice}` : '';

  const revenue = useQuery<RevenueResponse>({
    queryKey: ['indexerRevenue', addr, window],
    queryFn: async () => {
      const r = await fetch(`/api/indexer/${addr}/revenue?window=${window}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const pnl = useQuery<PnlResponse>({
    queryKey: ['indexerPnl', addr, window, chains.join(','), grtPrice],
    queryFn: async () => {
      const chainParam = chains.length ? `&chains=${chains.join(',')}` : '';
      const r = await fetch(`/api/indexer/${addr}/pnl?window=${window}${priceQuery}${chainParam}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const daily = revenue.data?.data.daily ?? [];
  const p = pnl.data?.data.pnl;
  const defaultChains = pnl.data?.data.defaultChainCosts ?? {};

  const chartData = useMemo(
    () =>
      daily.map((d) => ({
        date: new Date(d.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
        rav: d.rav_grt,
        rewards: d.indexing_rewards_grt,
      })),
    [daily],
  );

  const toggleChain = (key: string) =>
    setChains((c) => (c.includes(key) ? c.filter((k) => k !== key) : [...c, key]));

  const exportCsv = () => {
    const header = ['Date', 'Query Fees (GRT)', 'Indexing Rewards (GRT)', 'Total (GRT)'];
    const rows = daily.map((d) => [
      d.date,
      d.rav_grt.toFixed(2),
      d.indexing_rewards_grt.toFixed(2),
      d.total_grt.toFixed(2),
    ]);
    const csv = [header, ...rows].map((r) => r.join(',')).join('\n');
    downloadCsv(`pnl-${addr}-${window}d.csv`, csv);
  };

  const isLoading = revenue.isLoading || pnl.isLoading;
  const hasData = daily.length > 0;

  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <CardTitle>Indexer P&amp;L</CardTitle>
            <p className="text-[11px] text-[var(--text-faint)] mt-0.5">
              Query-fee revenue + indexing rewards, net of modeled infra cost
            </p>
          </div>
          <div className="flex items-center gap-1">
            {WINDOWS.map((w) => (
              <button
                key={w}
                onClick={() => setWindow(w)}
                className={cn(
                  'px-2.5 py-1 text-xs rounded-[var(--radius-button)] transition-colors',
                  window === w
                    ? 'bg-[var(--accent)] text-white'
                    : 'text-[var(--text-muted)] hover:text-[var(--text)]',
                )}
              >
                {w}d
              </button>
            ))}
            <button
              onClick={exportCsv}
              disabled={!hasData}
              className={cn(
                'ml-1 px-2.5 py-1 text-xs rounded-[var(--radius-button)] border border-[var(--border)]',
                'hover:border-[var(--accent-hover)] transition-colors disabled:opacity-40',
              )}
              title="Export daily P&L as CSV"
            >
              CSV
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <ChartSkeleton height="280px" />
        ) : !hasData ? (
          <div className="h-[200px] flex items-center justify-center">
            <p className="text-sm text-[var(--text-faint)]">No revenue recorded in this window yet</p>
          </div>
        ) : (
          <>
            {/* Financial summary */}
            {p && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
                <Stat label="Total Revenue" value={`${formatGRT(p.revenue_grt)} GRT`} sub={p.revenue_usd != null ? formatUSD(p.revenue_usd) : undefined} />
                <Stat label={`Infra Cost (${window}d)`} value={formatUSD(p.infra_cost_usd)} sub={`${formatUSD(p.infra_monthly_usd)}/mo`} />
                <Stat
                  label="Net"
                  value={p.net_usd != null ? formatUSD(p.net_usd) : '—'}
                  valueClass={p.net_usd != null ? (p.net_usd >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]') : undefined}
                  sub={p.margin_pct != null ? `${p.margin_pct.toFixed(1)}% margin` : 'set GRT price'}
                />
              </div>
            )}

            {/* Daily stacked revenue */}
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="pnlRavGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="pnlRewardsGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--green)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--green)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: 'var(--text-faint)', fontSize: 10 }}
                    interval={Math.max(0, Math.floor(chartData.length / 6) - 1)}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: 'var(--text-faint)', fontSize: 10 }}
                    tickFormatter={(v) => formatGRT(v)}
                    width={60}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--bg-elevated)',
                      border: '1px solid var(--border-mid)',
                      borderRadius: 'var(--radius-button)',
                      color: 'var(--text)',
                      fontSize: 12,
                    }}
                    labelStyle={{ color: 'var(--text)' }}
                    itemStyle={{ color: 'var(--text-muted)' }}
                    formatter={(value, name) => [
                      formatGRTFull(Number(value)) + ' GRT',
                      name === 'rav' ? 'Query Fees' : 'Indexing Rewards',
                    ]}
                  />
                  <Legend
                    formatter={(v) => (v === 'rav' ? 'Query Fees (RAV)' : 'Indexing Rewards')}
                    wrapperStyle={{ fontSize: 11, color: 'var(--text-muted)' }}
                  />
                  <Area type="monotone" dataKey="rewards" stackId="1" stroke="var(--green)" strokeWidth={2} fill="url(#pnlRewardsGrad)" />
                  <Area type="monotone" dataKey="rav" stackId="1" stroke="var(--accent)" strokeWidth={2} fill="url(#pnlRavGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Break-even */}
            {p?.breakeven_grt_price != null && (
              <p className="text-[11px] text-[var(--text-muted)] mt-2">
                Break-even GRT price for this window:{' '}
                <span className="font-mono text-[var(--text)]">${p.breakeven_grt_price.toFixed(4)}</span>
                {grtPrice > 0 && (
                  <span className="text-[var(--text-faint)]">
                    {' '}· {grtPrice >= p.breakeven_grt_price ? 'profitable at current price' : 'underwater at current price'}
                  </span>
                )}
              </p>
            )}

            {/* Archive-node cost selector */}
            <div className="mt-4 pt-4 border-t border-[var(--border)]">
              <p className="text-[11px] text-[var(--text-muted)] mb-2">
                Archive nodes run (toggle to model infra cost; these are editable estimates, not gospel):
              </p>
              <div className="flex flex-wrap gap-1.5">
                {Object.values(defaultChains).map((c) => (
                  <button
                    key={c.key}
                    onClick={() => toggleChain(c.key)}
                    className={cn(
                      'px-2 py-1 text-[11px] rounded-[var(--radius-button)] border transition-colors',
                      chains.includes(c.key)
                        ? 'border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--text)]'
                        : 'border-[var(--border)] text-[var(--text-faint)] hover:text-[var(--text-muted)]',
                    )}
                    title={`~${formatUSD(c.monthlyUsd)}/mo`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Per-deployment breakdown */}
            {p && p.perDeployment.length > 0 && (
              <div className="mt-4">
                <p className="text-[11px] text-[var(--text-muted)] mb-2">Top deployments by revenue</p>
                <div className="space-y-1">
                  {p.perDeployment.slice(0, 8).map((d) => (
                    <div
                      key={d.deployment_id ?? 'unattributed'}
                      className="flex items-center justify-between text-xs py-1.5 px-2 rounded bg-[var(--bg-elevated)]"
                    >
                      <span className="font-mono text-[var(--text-muted)] truncate max-w-[55%]">
                        {d.deployment_id ? `${d.deployment_id.slice(0, 10)}…${d.deployment_id.slice(-6)}` : 'Unattributed'}
                      </span>
                      <span className="font-mono text-[var(--text)]">
                        {formatGRT(d.revenue_grt)} GRT
                        {d.revenue_usd != null && (
                          <span className="text-[var(--text-faint)] ml-1.5">{formatUSD(d.revenue_usd)}</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p className="text-[10px] text-[var(--text-faint)] mt-4 leading-relaxed">
              Revenue: query-fee redemptions (RAV) + indexing rewards realised at allocation close.
              Infra cost is a modeled estimate from archive-node selection; override per operator.
              Informational only, not financial advice.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  sub,
  valueClass,
}: {
  label: string;
  value: string;
  sub?: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-lg bg-[var(--bg-elevated)] px-3 py-2.5">
      <p className="text-[10px] text-[var(--text-faint)] mb-0.5">{label}</p>
      <p className={cn('text-base font-semibold font-mono', valueClass ?? 'text-[var(--text)]')}>{value}</p>
      {sub && <p className="text-[10px] text-[var(--text-faint)] mt-0.5">{sub}</p>}
    </div>
  );
}
