'use client';

import { useState } from 'react';
import { ChartSkeleton } from '@/components/ui/ChartSkeleton';
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
  Legend,
  ReferenceLine,
} from 'recharts';
import { useTokenMetrics } from '@/hooks/useNetworkStats';
import { formatGRT, formatGRTFull } from '@/lib/utils';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';

type Tab = 'net' | 'breakdown';
type Window = 50 | 100 | 200 | 500;

export function TokenIssuanceChart() {
  const [tab, setTab] = useState<Tab>('net');
  const [count, setCount] = useState<Window>(100);
  const { data, isLoading } = useTokenMetrics(count);

  const chartData = (data ?? []).map((d) => ({
    epoch: `E${d.epoch}`,
    issuance: d.issuance,
    queryFeeTaxBurn: -d.queryFeeTaxBurn,
    disputeBurn: -d.disputeBurn,
    net: d.net,
  }));

  const hasData = chartData.length > 0;

  const windows: { label: string; value: Window }[] = [
    { label: '50', value: 50 },
    { label: '100', value: 100 },
    { label: '200', value: 200 },
    { label: '500', value: 500 },
  ];

  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle>Token Issuance &amp; Burn</CardTitle>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setTab('net')}
                className={`px-2.5 py-1 text-xs rounded-[var(--radius-button)] transition-colors ${
                  tab === 'net'
                    ? 'bg-[var(--accent)] text-white'
                    : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                }`}
              >
                Net Issuance
              </button>
              <button
                onClick={() => setTab('breakdown')}
                className={`px-2.5 py-1 text-xs rounded-[var(--radius-button)] transition-colors ${
                  tab === 'breakdown'
                    ? 'bg-[var(--accent)] text-white'
                    : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                }`}
              >
                Burn Breakdown
              </button>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-[var(--text-faint)]">Epochs:</span>
              {windows.map((w) => (
                <button
                  key={w.value}
                  onClick={() => setCount(w.value)}
                  className={`px-2 py-0.5 text-[10px] rounded-[var(--radius-button)] transition-colors ${
                    count === w.value
                      ? 'bg-[var(--bg-elevated)] text-[var(--text)]'
                      : 'text-[var(--text-faint)] hover:text-[var(--text)]'
                  }`}
                >
                  {w.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <ChartSkeleton height="330px" />
        ) : !hasData ? (
          <div className="h-[300px] flex items-center justify-center">
            <p className="text-sm text-[var(--text-faint)]">No epoch data available</p>
          </div>
        ) : tab === 'net' ? (
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="netPositiveGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--green)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="var(--green)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="epoch"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: 'var(--text-faint)', fontSize: 10 }}
                  interval={Math.max(0, Math.floor(chartData.length / 7) - 1)}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: 'var(--text-faint)', fontSize: 10 }}
                  tickFormatter={(v) => formatGRT(v)}
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
                  formatter={(value) => [formatGRTFull(Number(value)) + ' GRT', 'Net Issuance']}
                />
                <ReferenceLine y={0} stroke="var(--text-faint)" strokeOpacity={0.5} />
                <Area
                  type="monotone"
                  dataKey="net"
                  stroke="var(--green)"
                  strokeWidth={2}
                  fill="url(#netPositiveGrad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }} stackOffset="sign">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="epoch"
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
                    name === 'issuance' ? 'Issuance' :
                    name === 'queryFeeTaxBurn' ? 'Query Fee Tax' : 'Dispute Burn',
                  ]}
                />
                <Legend
                  formatter={(v) =>
                    v === 'issuance' ? 'Issuance' :
                    v === 'queryFeeTaxBurn' ? 'Query Fee Tax Burn' : 'Dispute Burn'
                  }
                  wrapperStyle={{ fontSize: 11, color: 'var(--text-muted)' }}
                />
                <ReferenceLine y={0} stroke="var(--text-faint)" strokeOpacity={0.5} />
                <Bar dataKey="issuance" fill="var(--green)" fillOpacity={0.8} stackId="stack" radius={[2, 2, 0, 0]} />
                <Bar dataKey="queryFeeTaxBurn" fill="var(--red)" fillOpacity={0.7} stackId="stack" />
                <Bar dataKey="disputeBurn" fill="var(--amber)" fillOpacity={0.7} stackId="stack" radius={[0, 0, 2, 2]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        <p className="text-[10px] text-[var(--text-faint)] mt-2 text-right">
          Per-epoch: issuance = indexing rewards, burn = query fee tax + dispute slashing
        </p>
      </CardContent>
    </Card>
  );
}
