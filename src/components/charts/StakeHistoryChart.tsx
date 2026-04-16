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
import { useIndexerStakeHistory } from '@/hooks/useNetworkStats';
import { ChartSkeleton } from '@/components/ui/ChartSkeleton';
import { formatGRT, formatGRTFull } from '@/lib/utils';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';

export function StakeHistoryChart({ indexer }: { indexer: string }) {
  const { data, isLoading } = useIndexerStakeHistory(indexer);
  const history = data?.history ?? [];

  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader>
        <CardTitle>Stake History</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <ChartSkeleton height="280px" />
        ) : history.length === 0 ? (
          <div className="h-[280px] flex items-center justify-center">
            <p className="text-sm text-[var(--text-faint)]">No stake history available</p>
          </div>
        ) : (
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={history} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="stakeHistSelfGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.5} />
                    <stop offset="95%" stopColor="var(--accent)" stopOpacity={0.2} />
                  </linearGradient>
                  <linearGradient id="stakeHistDelegGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--green)" stopOpacity={0.6} />
                    <stop offset="95%" stopColor="var(--green)" stopOpacity={0.2} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="date"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: 'var(--text-faint)', fontSize: 10 }}
                  interval={Math.max(0, Math.floor(history.length / 6) - 1)}
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
                    name === 'selfStakeGrt' ? 'Self Stake' : 'Delegated',
                  ]}
                />
                <Legend
                  formatter={(v) => (v === 'selfStakeGrt' ? 'Self Stake' : 'Delegated')}
                  wrapperStyle={{ fontSize: 11, color: 'var(--text-muted)' }}
                />
                <Area
                  type="monotone"
                  dataKey="selfStakeGrt"
                  stackId="1"
                  stroke="var(--accent)"
                  strokeWidth={2}
                  fill="url(#stakeHistSelfGrad)"
                />
                <Area
                  type="monotone"
                  dataKey="delegatedGrt"
                  stackId="1"
                  stroke="var(--green)"
                  strokeWidth={2}
                  fill="url(#stakeHistDelegGrad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
        <p className="text-[10px] text-[var(--text-faint)] mt-2 text-right">
          Weekly snapshots · 6 month history
        </p>
      </CardContent>
    </Card>
  );
}
