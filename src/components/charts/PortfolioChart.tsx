'use client';

import { useMemo } from 'react';
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
import { formatGRT, formatUSD } from '@/lib/utils';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';

interface PortfolioDataPoint {
  date: string;
  timestamp: number;
  value: number;
  rewards: number;
  principal: number;
}

interface PortfolioChartProps {
  data: PortfolioDataPoint[];
  grtPrice: number;
  isLoading?: boolean;
  showUSD?: boolean;
}

export function PortfolioChart({
  data,
  grtPrice,
  isLoading = false,
  showUSD = false,
}: PortfolioChartProps) {
  const chartData = useMemo(() => {
    return data.map((point) => ({
      ...point,
      displayValue: showUSD ? point.value * grtPrice : point.value,
      displayRewards: showUSD ? point.rewards * grtPrice : point.rewards,
      displayPrincipal: showUSD ? point.principal * grtPrice : point.principal,
    }));
  }, [data, grtPrice, showUSD]);

  const formatValue = (value: number) => {
    if (showUSD) {
      return formatUSD(value);
    }
    return `${formatGRT(value)} GRT`;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Portfolio Value</CardTitle>
          <span className="text-sm text-[var(--text-muted)]">
            {showUSD ? 'USD' : 'GRT'}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-[300px] flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : data.length === 0 ? (
          <div className="h-[300px] flex items-center justify-center text-[var(--text-muted)]">
            No historical data available
          </div>
        ) : (
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="valueGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="rewardsGradient" x1="0" y1="0" x2="0" y2="1">
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
                  dataKey="date"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: 'var(--text-faint)', fontSize: 12 }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: 'var(--text-faint)', fontSize: 12 }}
                  tickFormatter={(value) =>
                    showUSD ? `$${(value / 1000).toFixed(0)}k` : `${(value / 1000).toFixed(0)}k`
                  }
                  width={60}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--bg-surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-button)',
                    color: 'var(--text)',
                  }}
                  formatter={(value, name) => [
                    formatValue(Number(value)),
                    name === 'displayValue' ? 'Total Value' : name === 'displayRewards' ? 'Rewards' : 'Principal',
                  ]}
                  labelFormatter={(label) => label}
                />
                <Legend
                  formatter={(value) =>
                    value === 'displayValue' ? 'Total Value' : value === 'displayRewards' ? 'Rewards' : 'Principal'
                  }
                />
                <Area
                  type="monotone"
                  dataKey="displayValue"
                  stroke="var(--accent)"
                  strokeWidth={2}
                  fill="url(#valueGradient)"
                  name="displayValue"
                />
                <Area
                  type="monotone"
                  dataKey="displayRewards"
                  stroke="var(--green)"
                  strokeWidth={2}
                  fill="url(#rewardsGradient)"
                  name="displayRewards"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Generate mock historical data for development
 */
export function generateMockPortfolioHistory(
  currentValue: number,
  currentRewards: number,
  days: number = 90
): PortfolioDataPoint[] {
  const data: PortfolioDataPoint[] = [];
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  // Work backwards from current value
  const principal = currentValue - currentRewards;
  const dailyRewardRate = currentRewards / days;

  for (let i = days; i >= 0; i--) {
    const timestamp = now - i * dayMs;
    const date = new Date(timestamp);
    const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;

    // Simulate gradual reward accumulation with some variance
    const daysElapsed = days - i;
    const variance = 1 + (Math.random() - 0.5) * 0.1; // ±5% variance
    const rewards = dailyRewardRate * daysElapsed * variance;
    const value = principal + rewards;

    data.push({
      date: dateStr,
      timestamp,
      value,
      rewards,
      principal,
    });
  }

  return data;
}
