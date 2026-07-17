'use client';

import { useMemo } from 'react';
import { ChartSkeleton } from '@/components/ui/ChartSkeleton';
import {
  ComposedChart,
  Bar,
  Line,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { useDeveloperActivity } from '@/hooks/useNetworkStats';
import { formatNumber } from '@/lib/utils';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { NuthatchBadge } from '@/components/ui/NuthatchBadge';

function formatWeek(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
}

export function DeveloperActivityChart() {
  const { data, isLoading } = useDeveloperActivity();

  const chartData = useMemo(
    () =>
      (data?.weeks ?? []).map((w) => ({
        week: formatWeek(w.weekStart),
        published: w.count,
        cumulative: w.cumulative,
        partial: w.partial,
      })),
    [data]
  );

  const hasData = chartData.length > 0;
  const wow = data?.weekOverWeekPct;
  const wowPositive = (wow ?? 0) >= 0;

  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <CardTitle>Developer Activity</CardTitle>
              {data?.source === 'nuthatch' && <NuthatchBadge />}
            </div>
            <p className="text-sm text-[var(--text-muted)] mt-1">
              Subgraphs published per week{data ? ` — last ${data.windowMonths} months` : ''}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <ChartSkeleton height="300px" />
        ) : !hasData ? (
          <div className="h-[300px] flex items-center justify-center">
            <p className="text-sm text-[var(--text-faint)]">No developer activity data available</p>
          </div>
        ) : (
          <>
            {/* Summary row */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="p-3 rounded-[var(--radius-button)] bg-[var(--bg-elevated)] border border-[var(--border)]">
                <p className="text-[10px] text-[var(--text-faint)] mb-1">Published ({data!.windowMonths}m)</p>
                <p className="text-lg font-mono font-semibold text-[var(--accent)]">
                  {formatNumber(data!.totalInWindow)}
                </p>
              </div>
              <div className="p-3 rounded-[var(--radius-button)] bg-[var(--bg-elevated)] border border-[var(--border)]">
                <p className="text-[10px] text-[var(--text-faint)] mb-1">Latest full week</p>
                <p className="text-lg font-mono font-semibold text-[var(--text)]">
                  {formatNumber(data!.lastWeekCount)}
                </p>
              </div>
              <div className="p-3 rounded-[var(--radius-button)] bg-[var(--bg-elevated)] border border-[var(--border)] flex flex-col justify-center">
                <p className="text-[10px] text-[var(--text-faint)] mb-1">Week over week</p>
                <p
                  className={`text-lg font-mono font-semibold ${
                    wow == null
                      ? 'text-[var(--text-muted)]'
                      : wowPositive
                        ? 'text-[var(--green)]'
                        : 'text-[var(--red)]'
                  }`}
                >
                  {wow == null ? '—' : `${wowPositive ? '+' : ''}${wow.toFixed(1)}%`}
                </p>
              </div>
            </div>
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="week"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: 'var(--text-faint)', fontSize: 10 }}
                    interval={Math.max(0, Math.floor(chartData.length / 8) - 1)}
                  />
                  <YAxis
                    yAxisId="left"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: 'var(--text-faint)', fontSize: 10 }}
                    tickFormatter={(v) => formatNumber(Number(v))}
                    width={45}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: 'var(--text-faint)', fontSize: 10 }}
                    tickFormatter={(v) => formatNumber(Number(v))}
                    width={45}
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
                    formatter={(value, name, item) => [
                      formatNumber(Number(value)),
                      name === 'published'
                        ? item?.payload?.partial
                          ? 'Published (week in progress)'
                          : 'Published'
                        : 'Cumulative',
                    ]}
                  />
                  <Legend
                    formatter={(v) => (v === 'published' ? 'Published / week' : 'Cumulative')}
                    wrapperStyle={{ fontSize: 11, color: 'var(--text-muted)' }}
                  />
                  <Bar yAxisId="left" dataKey="published" radius={[2, 2, 0, 0]}>
                    {chartData.map((d, i) => (
                      <Cell
                        key={i}
                        fill="var(--accent)"
                        fillOpacity={d.partial ? 0.3 : 0.8}
                      />
                    ))}
                  </Bar>
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="cumulative"
                    stroke="var(--green)"
                    strokeWidth={2}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
        <p className="text-[10px] text-[var(--text-faint)] mt-2 text-right">
          Faded bar = current week (in progress) · Source: Subgraph publish events from The Graph network
        </p>
      </CardContent>
    </Card>
  );
}
