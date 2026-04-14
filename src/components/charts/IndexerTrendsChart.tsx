'use client';

import { useState } from 'react';
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
} from 'recharts';
import { useIndexerTrends } from '@/hooks/useNetworkStats';
import { formatGRT, formatGRTFull } from '@/lib/utils';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';

type Tab = 'rewards' | 'fees' | 'cumulative';

interface RewardPoint {
  date: string;
  indexerRewards: number;
  delegatorRewards: number;
  total: number;
}

interface FeePoint {
  date: string;
  collected: number;
  curators: number;
}

function formatTimestamp(ts: string): string {
  const num = Number(ts);
  if (!isNaN(num) && num > 0) {
    // The Graph timeseries Timestamp scalar returns microseconds
    const seconds = num > 1e15 ? num / 1e6 : num > 1e12 ? num / 1e3 : num;
    const d = new Date(seconds * 1000);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
    }
  }
  return ts;
}

export function IndexerTrendsChart({ indexer }: { indexer: string }) {
  const [tab, setTab] = useState<Tab>('rewards');
  const { data, isLoading } = useIndexerTrends(indexer, 90);

  const rewardData: RewardPoint[] =
    data?.rewards
      ?.slice()
      .reverse()
      .map((r) => ({
        date: formatTimestamp(r.timestamp),
        indexerRewards: Number(r.totalIndexerRewards) / 1e18,
        delegatorRewards: Number(r.totalDelegationRewards) / 1e18,
        total: Number(r.totalRewards) / 1e18,
      })) ?? [];

  const feeData: FeePoint[] =
    data?.queryFees
      ?.slice()
      .reverse()
      .map((f) => ({
        date: formatTimestamp(f.timestamp),
        collected: Number(f.totalCollected) / 1e18,
        curators: Number(f.totalCurators) / 1e18,
      })) ?? [];

  const hasRewards = rewardData.length > 0;
  const hasFees = feeData.length > 0;
  const hasData = hasRewards || hasFees;

  const cumulativeData = rewardData.reduce<Array<{ date: string; cumulative: number }>>(
    (acc, point) => {
      const prev = acc.length > 0 ? acc[acc.length - 1].cumulative : 0;
      acc.push({ date: point.date, cumulative: prev + point.total });
      return acc;
    },
    []
  );

  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Daily Trends</CardTitle>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setTab('rewards')}
              className={`px-2.5 py-1 text-xs rounded-[var(--radius-button)] transition-colors ${
                tab === 'rewards'
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              Rewards
            </button>
            <button
              onClick={() => setTab('fees')}
              className={`px-2.5 py-1 text-xs rounded-[var(--radius-button)] transition-colors ${
                tab === 'fees'
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              Query Fees
            </button>
            <button
              onClick={() => setTab('cumulative')}
              className={`px-2.5 py-1 text-xs rounded-[var(--radius-button)] transition-colors ${
                tab === 'cumulative'
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              Cumulative
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-[280px] flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : !hasData ? (
          <div className="h-[280px] flex items-center justify-center">
            <p className="text-sm text-[var(--text-faint)]">No trend data available yet</p>
          </div>
        ) : tab === 'rewards' ? (
          <div className="h-[280px]">
            {!hasRewards ? (
              <div className="h-full flex items-center justify-center">
                <p className="text-sm text-[var(--text-faint)]">No reward data for this period</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={rewardData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="trendIndexerGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="trendDelegatorGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--green)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--green)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: 'var(--text-faint)', fontSize: 10 }}
                    interval={Math.max(0, Math.floor(rewardData.length / 6) - 1)}
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
                      name === 'indexerRewards' ? 'Indexer' : 'Delegator',
                    ]}
                  />
                  <Legend
                    formatter={(v) => (v === 'indexerRewards' ? 'Indexer' : 'Delegator')}
                    wrapperStyle={{ fontSize: 11, color: 'var(--text-muted)' }}
                  />
                  <Area
                    type="monotone"
                    dataKey="indexerRewards"
                    stackId="1"
                    stroke="var(--accent)"
                    strokeWidth={2}
                    fill="url(#trendIndexerGrad)"
                  />
                  <Area
                    type="monotone"
                    dataKey="delegatorRewards"
                    stackId="1"
                    stroke="var(--green)"
                    strokeWidth={2}
                    fill="url(#trendDelegatorGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        ) : tab === 'fees' ? (
          <div className="h-[280px]">
            {!hasFees ? (
              <div className="h-full flex items-center justify-center">
                <p className="text-sm text-[var(--text-faint)]">No query fee data for this period</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={feeData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: 'var(--text-faint)', fontSize: 10 }}
                    interval={Math.max(0, Math.floor(feeData.length / 6) - 1)}
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
                      name === 'collected' ? 'Collected' : 'Curator Share',
                    ]}
                  />
                  <Legend
                    formatter={(v) => (v === 'collected' ? 'Collected' : 'Curator Share')}
                    wrapperStyle={{ fontSize: 11, color: 'var(--text-muted)' }}
                  />
                  <Bar dataKey="collected" fill="var(--accent)" fillOpacity={0.8} radius={[2, 2, 0, 0]} />
                  <Bar dataKey="curators" fill="var(--amber)" fillOpacity={0.6} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        ) : (
          <div className="h-[280px]">
            {cumulativeData.length === 0 ? (
              <div className="h-full flex items-center justify-center">
                <p className="text-sm text-[var(--text-faint)]">No reward data for cumulative view</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={cumulativeData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="trendCumulativeGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: 'var(--text-faint)', fontSize: 10 }}
                    interval={Math.max(0, Math.floor(cumulativeData.length / 6) - 1)}
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
                    formatter={(value) => [formatGRTFull(Number(value)) + ' GRT', 'Cumulative Rewards']}
                  />
                  <Area
                    type="monotone"
                    dataKey="cumulative"
                    stroke="var(--accent)"
                    strokeWidth={2}
                    fill="url(#trendCumulativeGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        )}
        <p className="text-[10px] text-[var(--text-faint)] mt-2 text-right">
          Source: Community Horizon Performance Subgraph
        </p>
      </CardContent>
    </Card>
  );
}
