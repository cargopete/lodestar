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
import { useEpochHistory } from '@/hooks/useNetworkStats';
import { weiToGRT, formatGRT } from '@/lib/utils';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';

interface ChartDataPoint {
  epoch: string;
  indexerRewards: number;
  delegatorRewards: number;
}

export function StakingTrendChart() {
  const { data, isLoading } = useEpochHistory(20);

  const chartData: ChartDataPoint[] =
    data?.epoches
      ?.slice()
      .reverse()
      .map((epoch) => ({
        epoch: epoch.id,
        indexerRewards: weiToGRT(epoch.totalIndexerRewards),
        delegatorRewards: weiToGRT(epoch.totalDelegatorRewards),
      })) ?? [];

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Rewards per Epoch</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-[280px] flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="indexerGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="delegatorGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--green)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="var(--green)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--border)"
                  vertical={false}
                />
                <XAxis
                  dataKey="epoch"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: 'var(--text-faint)', fontSize: 11 }}
                  interval={Math.max(0, Math.floor(chartData.length / 5) - 1)}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: 'var(--text-faint)', fontSize: 11 }}
                  tickFormatter={(value) => formatGRT(value)}
                  width={65}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--bg-surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-button)',
                    color: 'var(--text)',
                    fontSize: 13,
                  }}
                  labelFormatter={(label) => `Epoch ${label}`}
                  formatter={(value, name) => [
                    formatGRT(Number(value)) + ' GRT',
                    name === 'indexerRewards' ? 'Indexer' : 'Delegator',
                  ]}
                />
                <Legend
                  formatter={(value) => (value === 'indexerRewards' ? 'Indexer' : 'Delegator')}
                  wrapperStyle={{ fontSize: 12, color: 'var(--text-muted)' }}
                />
                <Area
                  type="monotone"
                  dataKey="indexerRewards"
                  stackId="1"
                  stroke="var(--accent)"
                  strokeWidth={2}
                  fill="url(#indexerGradient)"
                />
                <Area
                  type="monotone"
                  dataKey="delegatorRewards"
                  stackId="1"
                  stroke="var(--green)"
                  strokeWidth={2}
                  fill="url(#delegatorGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
