'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { useNetworkStats } from '@/hooks/useNetworkStats';
import { weiToGRT, formatGRT } from '@/lib/utils';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';

interface DonutData {
  name: string;
  value: number;
  color: string;
}

export function RewardSplitDonut() {
  const { data, isLoading } = useNetworkStats();

  const network = data?.graphNetwork;
  const totalStaked = network ? weiToGRT(network.totalTokensStaked) : 0;
  const totalDelegated = network ? weiToGRT(network.totalDelegatedTokens) : 0;
  const totalSignalled = network ? weiToGRT(network.totalTokensSignalled) : 0;

  const chartData: DonutData[] = [
    { name: 'Self-Stake', value: totalStaked, color: 'var(--accent)' },
    { name: 'Delegated', value: totalDelegated, color: 'var(--green)' },
    { name: 'Signalled', value: totalSignalled, color: 'var(--amber)' },
  ];

  const total = totalStaked + totalDelegated + totalSignalled;

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Token Distribution</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-[280px] flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="h-[280px] relative">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={70}
                  outerRadius={100}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--bg-surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-button)',
                    color: 'var(--text)',
                  }}
                  formatter={(value) => [formatGRT(Number(value)) + ' GRT', '']}
                />
              </PieChart>
            </ResponsiveContainer>

            {/* Center label */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <p className="text-2xl font-semibold font-mono text-[var(--text)]">
                  {formatGRT(total)}
                </p>
                <p className="text-xs text-[var(--text-muted)]">Total GRT</p>
              </div>
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="flex justify-center gap-6 mt-4">
          {chartData.map((item) => (
            <div key={item.name} className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: item.color }}
              />
              <span className="text-sm text-[var(--text-muted)]">{item.name}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
