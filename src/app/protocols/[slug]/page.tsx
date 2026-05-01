'use client';

import { use } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { getProtocol } from '@/lib/protocols/config';
import { useProtocolDetail } from '@/hooks/useProtocols';
import { formatUSD } from '@/lib/utils';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { ChartSkeleton } from '@/components/ui/ChartSkeleton';

const TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: 'var(--bg-elevated)',
    border: '1px solid var(--border-mid)',
    borderRadius: 'var(--radius-button)',
    color: 'var(--text)',
    fontSize: 12,
  },
  labelStyle: { color: 'var(--text)' },
  itemStyle: { color: 'var(--text-muted)' },
};

function formatDate(timestamp: number) {
  return new Date(timestamp * 1000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="p-4 rounded-[var(--radius-button)] bg-[var(--bg-elevated)] border border-[var(--border)]">
      <p className="text-[11px] text-[var(--text-faint)] mb-1">{label}</p>
      <p className="text-xl font-mono font-semibold text-[var(--accent)]">{value}</p>
      {sub && <p className="text-[10px] text-[var(--text-faint)] mt-0.5">{sub}</p>}
    </div>
  );
}

export default function ProtocolDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const config = getProtocol(slug);

  if (!config) notFound();

  const { data, isLoading } = useProtocolDetail(slug);
  const { summary, snapshots = [] } = data ?? {};

  const chartData = snapshots.map((s) => ({
    date: formatDate(s.timestamp),
    tvl: s.tvlUSD,
    volume: s.volumeUSD,
    fees: s.feesUSD,
  }));

  const isLending = config.category === 'Lending';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="pb-2 border-b border-[var(--border)]">
        <div className="flex items-center gap-2 text-xs text-[var(--text-faint)] mb-2">
          <Link href="/protocols" className="hover:text-[var(--accent)] transition-colors">Protocols</Link>
          <span>/</span>
          <span>{config.name}</span>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: config.color }} />
            <div>
              <h1 className="text-2xl font-semibold text-[var(--text)]">{config.name}</h1>
              <p className="text-sm text-[var(--text-muted)] mt-0.5 max-w-2xl">{config.description}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-xs text-[var(--text-faint)] bg-[var(--bg-elevated)] border border-[var(--border)] px-2 py-1 rounded-[var(--radius-button)]">
              {config.chains.join(' · ')}
            </span>
            <a
              href={config.website}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-[var(--accent)] hover:underline"
            >
              {config.website.replace('https://', '')} ↗
            </a>
          </div>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard
          label="Total Value Locked"
          value={isLoading ? '—' : formatUSD(summary?.tvlUSD ?? 0)}
        />
        <MetricCard
          label={isLending ? 'Active Borrows' : '30d Volume'}
          value={isLoading ? '—' : isLending
            ? formatUSD(summary?.totalBorrowUSD ?? 0)
            : formatUSD(summary?.volume30dUSD ?? 0)
          }
          sub={isLending ? undefined : 'last 30 days'}
        />
        <MetricCard
          label="30d Fees"
          value={isLoading ? '—' : formatUSD(summary?.fees30dUSD ?? 0)}
          sub="last 30 days"
        />
        <MetricCard
          label={isLending ? 'Total Borrowed' : 'Total Volume'}
          value={isLoading ? '—' : formatUSD(summary?.cumulativeVolumeUSD ?? 0)}
          sub="all time"
        />
      </div>

      {/* TVL chart */}
      <Card>
        <CardHeader>
          <CardTitle>Total Value Locked (90 days)</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <ChartSkeleton height="220px" />
          ) : (
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="tvlGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={config.color} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={config.color} stopOpacity={0} />
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
                    tickFormatter={(v) => formatUSD(v)}
                    width={70}
                  />
                  <Tooltip
                    {...TOOLTIP_STYLE}
                    formatter={(value) => [formatUSD(Number(value)), 'TVL']}
                  />
                  <Area
                    type="monotone"
                    dataKey="tvl"
                    stroke={config.color}
                    strokeWidth={2}
                    fill="url(#tvlGradient)"
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Volume + Fees charts side-by-side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{isLending ? 'Daily Borrowing (90 days)' : 'Daily Volume (90 days)'}</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <ChartSkeleton height="180px" />
            ) : (
              <div className="h-[180px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis
                      dataKey="date"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: 'var(--text-faint)', fontSize: 10 }}
                      interval={Math.max(0, Math.floor(chartData.length / 5) - 1)}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: 'var(--text-faint)', fontSize: 10 }}
                      tickFormatter={(v) => formatUSD(v)}
                      width={70}
                    />
                    <Tooltip
                      {...TOOLTIP_STYLE}
                      formatter={(value) => [formatUSD(Number(value)), isLending ? 'Borrowed' : 'Volume']}
                    />
                    <Bar dataKey="volume" fill={config.color} fillOpacity={0.7} radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Daily Fees (90 days)</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <ChartSkeleton height="180px" />
            ) : (
              <div className="h-[180px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis
                      dataKey="date"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: 'var(--text-faint)', fontSize: 10 }}
                      interval={Math.max(0, Math.floor(chartData.length / 5) - 1)}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: 'var(--text-faint)', fontSize: 10 }}
                      tickFormatter={(v) => formatUSD(v)}
                      width={70}
                    />
                    <Tooltip
                      {...TOOLTIP_STYLE}
                      formatter={(value) => [formatUSD(Number(value)), 'Fees']}
                    />
                    <Bar dataKey="fees" fill="var(--accent)" fillOpacity={0.7} radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Attribution */}
      <div className="flex items-center justify-between text-xs text-[var(--text-faint)]">
        <span>
          Data sourced from{' '}
          <a
            href={`https://thegraph.com/explorer/subgraphs/${config.subgraphId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--accent)] hover:underline"
          >
            The Graph ↗
          </a>
        </span>
        <Link href="/protocols" className="hover:text-[var(--accent)] transition-colors">
          ← All protocols
        </Link>
      </div>
    </div>
  );
}

