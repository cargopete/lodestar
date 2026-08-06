'use client';

import { useState, useMemo } from 'react';
import { ChartSkeleton } from '@/components/ui/ChartSkeleton';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from 'recharts';
import { useDelegationFlows } from '@/hooks/useNetworkStats';
import { formatGRT, formatGRTFull } from '@/lib/utils';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';

type Window = 30 | 90 | 180 | 365;

const WINDOW_LABEL: Record<Window, string> = { 30: '30d', 90: '90d', 180: '180d', 365: '1y' };

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

export function DelegationFlowChart() {
  const [days, setDays] = useState<Window>(90);
  // Always fetch 2× window so we can compare current vs previous period
  const { data, isLoading } = useDelegationFlows(days, true);

  const cutoff = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
  }, [days]);

  const { currentData, previousData } = useMemo(() => {
    const all = data ?? [];
    return {
      currentData:  all.filter(d => d.date >= cutoff),
      previousData: all.filter(d => d.date <  cutoff),
    };
  }, [data, cutoff]);

  const chartData = currentData.map((d) => ({
    date: formatDate(d.date),
    inflows: d.inflows,
    outflows: -d.outflows,
    net: d.net,
  }));

  const hasData = chartData.length > 0;

  const currentNet  = currentData.reduce((s, d)  => s + d.net, 0);
  const previousNet = previousData.reduce((s, d) => s + d.net, 0);
  const delta = previousNet !== 0 ? ((currentNet - previousNet) / Math.abs(previousNet)) * 100 : 0;
  const deltaPositive = delta >= 0;
  const netPositive   = currentNet >= 0;

  const windows: { label: string; value: Window }[] = [
    { label: '30d', value: 30 },
    { label: '90d', value: 90 },
    { label: '180d', value: 180 },
    { label: '1y', value: 365 },
  ];

  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Delegation Flows</CardTitle>
          <div className="flex items-center gap-1">
            {windows.map((w) => (
              <button
                key={w.value}
                onClick={() => setDays(w.value)}
                className={`px-2.5 py-1 text-xs rounded-[var(--radius-button)] transition-colors ${
                  days === w.value
                    ? 'bg-[var(--accent)] text-white'
                    : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <ChartSkeleton height="400px" />
        ) : !hasData ? (
          <div className="h-[300px] flex items-center justify-center">
            <p className="text-sm text-[var(--text-faint)]">No delegation flow data available</p>
          </div>
        ) : (
          <>
            {/* Period comparison summary */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="p-3 rounded-[var(--radius-button)] bg-[var(--bg-elevated)] border border-[var(--border)]">
                <p className="text-[10px] text-[var(--text-faint)] mb-1">Current {WINDOW_LABEL[days]}</p>
                <p className={`text-lg font-mono font-semibold ${netPositive ? 'text-[var(--green)]' : 'text-[var(--red-text)]'}`}>
                  {netPositive ? '+' : '−'}{formatGRT(Math.abs(currentNet))}
                </p>
                <p className="text-[10px] text-[var(--text-faint)] font-mono">{netPositive ? '+' : '−'}{formatGRTFull(Math.abs(currentNet))} GRT net</p>
              </div>
              <div className="p-3 rounded-[var(--radius-button)] bg-[var(--bg-elevated)] border border-[var(--border)]">
                <p className="text-[10px] text-[var(--text-faint)] mb-1">Previous {WINDOW_LABEL[days]}</p>
                <p className="text-lg font-mono font-semibold text-[var(--text-muted)]">
                  {previousNet >= 0 ? '+' : '−'}{formatGRT(Math.abs(previousNet))}
                </p>
                <p className="text-[10px] text-[var(--text-faint)] font-mono">{previousNet >= 0 ? '+' : '−'}{formatGRTFull(Math.abs(previousNet))} GRT net</p>
              </div>
              <div className="p-3 rounded-[var(--radius-button)] bg-[var(--bg-elevated)] border border-[var(--border)] flex flex-col justify-center items-center">
                <p className="text-[10px] text-[var(--text-faint)] mb-1">Change</p>
                <p className={`text-lg font-mono font-semibold ${deltaPositive ? 'text-[var(--green)]' : 'text-[var(--red-text)]'}`}>
                  {deltaPositive ? '+' : ''}{delta.toFixed(1)}%
                </p>
              </div>
            </div>
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }} stackOffset="sign">
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: 'var(--text-faint)', fontSize: 10 }}
                    interval={Math.max(0, Math.floor(chartData.length / 7) - 1)}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: 'var(--text-faint)', fontSize: 10 }}
                    tickFormatter={(v) => formatGRT(Math.abs(v))}
                    width={65}
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
                      formatGRTFull(Math.abs(Number(value))) + ' GRT',
                      name === 'inflows' ? 'Inflows' : name === 'outflows' ? 'Outflows' : 'Net Flow',
                    ]}
                  />
                  <Legend
                    formatter={(v) => v === 'inflows' ? 'Inflows' : v === 'outflows' ? 'Outflows' : 'Net'}
                    wrapperStyle={{ fontSize: 11, color: 'var(--text-muted)' }}
                  />
                  <ReferenceLine y={0} stroke="var(--text-faint)" strokeOpacity={0.5} />
                  <Bar dataKey="inflows" fill="var(--green)" fillOpacity={0.8} stackId="stack" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="outflows" fill="var(--red)" fillOpacity={0.7} stackId="stack" radius={[0, 0, 2, 2]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
        <p className="text-[10px] text-[var(--text-faint)] mt-2 text-right">
          Source: Delegation events from The Graph network
        </p>
      </CardContent>
    </Card>
  );
}
