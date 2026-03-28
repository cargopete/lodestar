'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { useEpochHistory, useNetworkStats } from '@/hooks/useNetworkStats';
import { weiToGRT, formatGRT, formatGRTFull } from '@/lib/utils';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';

const SEVEN_DAYS = 7 * 86400;
const L1_BLOCK_TIME = 12;

interface EpochFee {
  epoch: string;
  fees: number;
  period: 'current' | 'previous' | 'older';
}

export function QueryFeesChart() {
  const { data, isLoading: epochsLoading } = useEpochHistory(30);
  const { data: networkData } = useNetworkStats();

  const epochLength = networkData?.graphNetwork?.epochLength ?? 0;
  const epochDuration = epochLength * L1_BLOCK_TIME;

  // Reverse to chronological order (API returns desc)
  const epochs = data?.epoches?.slice().reverse() ?? [];

  // Anchor to the latest epoch in the data (not the derived current epoch,
  // which can be far ahead of what the subgraph has closed)
  const latestEpochId = epochs.length > 0 ? Number(epochs[epochs.length - 1].id) : 0;

  const chartData: EpochFee[] = epochs.map((ep) => {
    const epochsAgo = latestEpochId - Number(ep.id);
    const ageSeconds = epochsAgo * epochDuration;

    let period: 'current' | 'previous' | 'older' = 'older';
    if (ageSeconds <= SEVEN_DAYS) period = 'current';
    else if (ageSeconds <= SEVEN_DAYS * 2) period = 'previous';

    return {
      epoch: ep.id,
      fees: weiToGRT(ep.totalQueryFees),
      period,
    };
  });

  const currentEpochs = chartData.filter((d) => d.period === 'current');
  const previousEpochs = chartData.filter((d) => d.period === 'previous');
  // Only show the two comparison periods in the chart
  const visibleData = chartData.filter((d) => d.period !== 'older');

  const currentTotal = currentEpochs.reduce((sum, d) => sum + d.fees, 0);
  const previousTotal = previousEpochs.reduce((sum, d) => sum + d.fees, 0);
  const delta = previousTotal > 0
    ? ((currentTotal - previousTotal) / previousTotal) * 100
    : 0;
  const deltaPositive = delta >= 0;

  const isLoading = epochsLoading || !epochLength;

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Query Fees — 7d Comparison</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-[320px] flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* Summary stats */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="p-3 rounded-[var(--radius-button)] bg-[var(--bg-elevated)] border border-[var(--border)]">
                <p className="text-[10px] text-[var(--text-faint)] uppercase tracking-wider mb-1">Current 7d</p>
                <p className="text-lg font-mono font-semibold text-[var(--accent)]">
                  {formatGRT(currentTotal)}
                </p>
                <p className="text-[10px] text-[var(--text-faint)] font-mono">{formatGRTFull(currentTotal)} GRT</p>
              </div>
              <div className="p-3 rounded-[var(--radius-button)] bg-[var(--bg-elevated)] border border-[var(--border)]">
                <p className="text-[10px] text-[var(--text-faint)] uppercase tracking-wider mb-1">Previous 7d</p>
                <p className="text-lg font-mono font-semibold text-[var(--text-muted)]">
                  {formatGRT(previousTotal)}
                </p>
                <p className="text-[10px] text-[var(--text-faint)] font-mono">{formatGRTFull(previousTotal)} GRT</p>
              </div>
              <div className="p-3 rounded-[var(--radius-button)] bg-[var(--bg-elevated)] border border-[var(--border)] flex flex-col justify-center items-center">
                <p className="text-[10px] text-[var(--text-faint)] uppercase tracking-wider mb-1">Change</p>
                <p className={`text-lg font-mono font-semibold ${deltaPositive ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
                  {deltaPositive ? '+' : ''}{delta.toFixed(1)}%
                </p>
              </div>
            </div>

            {/* Bar chart */}
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={visibleData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--border)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="epoch"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: 'var(--text-faint)', fontSize: 10 }}
                    interval={Math.max(0, Math.floor(visibleData.length / 6) - 1)}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: 'var(--text-faint)', fontSize: 10 }}
                    tickFormatter={(value) => formatGRT(value)}
                    width={55}
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
                    labelFormatter={(label) => `Epoch ${label}`}
                    formatter={(value) => [formatGRTFull(Number(value)) + ' GRT', 'Query Fees']}
                  />
                  <Bar dataKey="fees" radius={[2, 2, 0, 0]}>
                    {visibleData.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={entry.period === 'current' ? 'var(--accent)' : 'var(--text-faint)'}
                        fillOpacity={entry.period === 'current' ? 0.85 : 0.35}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Legend */}
            <div className="flex items-center justify-center gap-4 mt-2 text-[11px] text-[var(--text-faint)]">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-[var(--accent)] opacity-85" />
                Current 7d
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-[var(--text-faint)] opacity-35" />
                Previous 7d
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
