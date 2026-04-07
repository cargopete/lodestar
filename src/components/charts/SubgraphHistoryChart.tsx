'use client';

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
import { formatGRT } from '@/lib/utils';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import type { SubgraphHistoryPoint } from '@/hooks/useNetworkStats';

interface Props {
  data: SubgraphHistoryPoint[];
  isLoading: boolean;
}

export function SubgraphHistoryChart({ data, isLoading }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Signal &amp; Allocation History</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-[280px] flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            <span className="ml-3 text-sm text-[var(--text-muted)]">Loading history...</span>
          </div>
        ) : data.length === 0 ? (
          <div className="h-[280px] flex items-center justify-center">
            <p className="text-sm text-[var(--text-muted)]">No historical data available for this deployment.</p>
          </div>
        ) : (
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="sgHistSignal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--green)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="var(--green)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="sgHistStake" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="date"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: 'var(--text-faint)', fontSize: 11 }}
                  interval={Math.max(0, Math.floor(data.length / 5) - 1)}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: 'var(--text-faint)', fontSize: 11 }}
                  tickFormatter={(v) => formatGRT(v)}
                  width={65}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--bg-elevated)',
                    border: '1px solid var(--border-mid)',
                    borderRadius: 'var(--radius-button)',
                    color: 'var(--text)',
                    fontSize: 13,
                  }}
                  labelStyle={{ color: 'var(--text)' }}
                  itemStyle={{ color: 'var(--text-muted)' }}
                  formatter={(value, name) => [
                    formatGRT(Number(value)) + ' GRT',
                    name === 'signalGrt' ? 'Signal' : 'Stake',
                  ]}
                />
                <Legend
                  formatter={(value) => (value === 'signalGrt' ? 'Signal' : 'Stake')}
                  wrapperStyle={{ fontSize: 12, color: 'var(--text-muted)' }}
                />
                <Area
                  type="monotone"
                  dataKey="signalGrt"
                  stroke="var(--green)"
                  strokeWidth={2}
                  fill="url(#sgHistSignal)"
                />
                <Area
                  type="monotone"
                  dataKey="stakeGrt"
                  stroke="var(--accent)"
                  strokeWidth={2}
                  fill="url(#sgHistStake)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
