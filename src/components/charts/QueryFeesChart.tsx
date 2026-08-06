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
  Cell,
} from 'recharts';
import { useEpochHistory, useNetworkStats } from '@/hooks/useNetworkStats';
import { weiToGRT, formatGRT, formatGRTFull } from '@/lib/utils';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';

const L1_BLOCK_TIME = 12;

type TimeWindow = '7d' | '30d' | '90d' | '1y';

const WINDOW_DAYS: Record<TimeWindow, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '1y': 365,
};

interface EpochFee {
  epoch: string;
  date: string;
  fees: number;
  period: 'current' | 'previous' | 'older';
}

interface QuarterFee {
  label: string;
  fees: number;
  epochCount: number;
  isCurrent: boolean;
}

const TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: 'var(--bg-elevated)',
    border: '1px solid var(--border-mid)',
    borderRadius: 'var(--radius-button)',
    color: 'var(--text)',
    fontSize: 12,
  },
  labelStyle: { color: 'var(--text)' },
  itemStyle: { color: 'var(--text-muted)' },
};

export function QueryFeesChart() {
  const [timeWindow, setTimeWindow] = useState<TimeWindow>('7d');
  // Mount-stable "now" — keeps the memos pure (no Date.now() during render).
  const [now] = useState(() => Date.now());
  const isYearly = timeWindow === '1y';
  const windowDays = WINDOW_DAYS[timeWindow];
  // For comparison windows: fetch 2× the window so we have current + previous periods
  const epochCount = isYearly ? 365 : windowDays * 2 + 5;

  const { data, isLoading: epochsLoading } = useEpochHistory(epochCount);
  const { data: networkData } = useNetworkStats();

  const epochLength = networkData?.graphNetwork?.epochLength ?? 0;
  const epochDuration = epochLength * L1_BLOCK_TIME; // seconds per epoch

  // API returns desc order — reverse to chronological
  const epochs = useMemo(() => data?.epoches?.slice().reverse() ?? [], [data]);
  const latestEpochId = epochs.length > 0 ? Number(epochs[epochs.length - 1].id) : 0;
  const windowSeconds = windowDays * 86400;

  // Non-yearly: label each epoch as current / previous / older
  const chartData: EpochFee[] = useMemo(() => {
    if (isYearly || !epochDuration) return [];
    return epochs.map((ep) => {
      const epochsAgo = latestEpochId - Number(ep.id);
      const ageSeconds = epochsAgo * epochDuration;
      const epochMs = now - epochsAgo * epochDuration * 1000;
      const date = new Date(epochMs).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
      let period: 'current' | 'previous' | 'older' = 'older';
      if (ageSeconds <= windowSeconds) period = 'current';
      else if (ageSeconds <= windowSeconds * 2) period = 'previous';
      return { epoch: ep.id, date, fees: weiToGRT(ep.totalQueryFees), period };
    });
  }, [epochs, latestEpochId, epochDuration, windowSeconds, isYearly, now]);

  // Yearly: group epochs into calendar quarters
  const quarterData: QuarterFee[] = useMemo(() => {
    if (!isYearly || !epochDuration) return [];
    const byQuarter = new Map<string, { fees: number; year: number; q: number; epochCount: number }>();

    for (const ep of epochs) {
      const epochsAgo = latestEpochId - Number(ep.id);
      const epochMs = now - epochsAgo * epochDuration * 1000;
      const date = new Date(epochMs);
      const year = date.getFullYear();
      const q = Math.floor(date.getMonth() / 3) + 1; // 1–4
      const key = `${year}-Q${q}`;
      const entry = byQuarter.get(key) ?? { fees: 0, year, q, epochCount: 0 };
      entry.fees += weiToGRT(ep.totalQueryFees);
      entry.epochCount += 1;
      byQuarter.set(key, entry);
    }

    const sorted = Array.from(byQuarter.entries()).sort(([a], [b]) => a.localeCompare(b));
    return sorted.map(([, v], i) => ({
      label: `Q${v.q} ${v.year}`,
      fees: v.fees,
      epochCount: v.epochCount,
      isCurrent: i === sorted.length - 1,
    }));
  }, [epochs, latestEpochId, epochDuration, isYearly]);

  const visibleData = chartData.filter((d) => d.period !== 'older');
  const currentTotal = chartData.filter((d) => d.period === 'current').reduce((s, d) => s + d.fees, 0);
  const previousTotal = chartData.filter((d) => d.period === 'previous').reduce((s, d) => s + d.fees, 0);
  const delta = previousTotal > 0 ? ((currentTotal - previousTotal) / previousTotal) * 100 : 0;
  const deltaPositive = delta >= 0;

  const currentQ = quarterData[quarterData.length - 1]?.fees ?? 0;
  const prevQ = quarterData[quarterData.length - 2]?.fees ?? 0;
  // Compare daily averages so a partial current quarter isn't penalised vs a full previous one
  const epochDays = epochDuration / 86400;
  const currentQDailyAvg =
    (quarterData[quarterData.length - 1]?.epochCount ?? 0) > 0
      ? currentQ / ((quarterData[quarterData.length - 1]!.epochCount) * epochDays)
      : 0;
  const prevQDailyAvg =
    (quarterData[quarterData.length - 2]?.epochCount ?? 0) > 0
      ? prevQ / ((quarterData[quarterData.length - 2]!.epochCount) * epochDays)
      : 0;
  const quarterDelta = prevQDailyAvg > 0 ? ((currentQDailyAvg - prevQDailyAvg) / prevQDailyAvg) * 100 : 0;
  const quarterDeltaPositive = quarterDelta >= 0;

  const isLoading = epochsLoading || !epochLength;

  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Query Fees</CardTitle>
          <div className="flex gap-1">
            {(['7d', '30d', '90d', '1y'] as TimeWindow[]).map((w) => (
              <button
                key={w}
                onClick={() => setTimeWindow(w)}
                className={`px-2 py-0.5 text-[11px] rounded-[var(--radius-button)] border transition-colors ${
                  timeWindow === w
                    ? 'border-[var(--accent)] text-[var(--accent-text)] bg-[var(--accent)]/10'
                    : 'border-[var(--border)] text-[var(--text-faint)] hover:border-[var(--border-mid)]'
                }`}
              >
                {w === '1y' ? '1Y' : w.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <ChartSkeleton height="340px" />
        ) : isYearly ? (
          <>
            {/* Quarterly summary stats */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="p-3 rounded-[var(--radius-button)] bg-[var(--bg-elevated)] border border-[var(--border)]">
                <p className="text-[10px] text-[var(--text-faint)] mb-1">
                  {quarterData[quarterData.length - 1]?.label ?? 'Current Q'}
                </p>
                <p className="text-lg font-mono font-semibold text-[var(--accent-text)]">{formatGRT(currentQ)}</p>
                <p className="text-[10px] text-[var(--text-faint)] font-mono">{formatGRTFull(currentQ)} GRT</p>
              </div>
              <div className="p-3 rounded-[var(--radius-button)] bg-[var(--bg-elevated)] border border-[var(--border)]">
                <p className="text-[10px] text-[var(--text-faint)] mb-1">
                  {quarterData[quarterData.length - 2]?.label ?? 'Prev Q'}
                </p>
                <p className="text-lg font-mono font-semibold text-[var(--text-muted)]">{formatGRT(prevQ)}</p>
                <p className="text-[10px] text-[var(--text-faint)] font-mono">{formatGRTFull(prevQ)} GRT</p>
              </div>
              <div className="p-3 rounded-[var(--radius-button)] bg-[var(--bg-elevated)] border border-[var(--border)] flex flex-col justify-center items-center">
                <p className="text-[10px] text-[var(--text-faint)] mb-1">QoQ Change (So Far)</p>
                <p className={`text-lg font-mono font-semibold ${quarterDeltaPositive ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
                  {quarterDeltaPositive ? '+' : ''}{quarterDelta.toFixed(1)}%
                </p>
              </div>
            </div>
            {/* Quarterly bar chart */}
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={quarterData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="label"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: 'var(--text-faint)', fontSize: 10 }}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: 'var(--text-faint)', fontSize: 10 }}
                    tickFormatter={formatGRT}
                    width={55}
                  />
                  <Tooltip
                    {...TOOLTIP_STYLE}
                    formatter={(value) => [formatGRTFull(Number(value)) + ' GRT', 'Query Fees']}
                  />
                  <Bar dataKey="fees" radius={[2, 2, 0, 0]}>
                    {quarterData.map((entry, i) => (
                      <Cell
                        key={`cell-${i}`}
                        fill={entry.isCurrent ? 'var(--accent)' : 'var(--text-faint)'}
                        fillOpacity={entry.isCurrent ? 0.85 : 0.45}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center justify-center gap-4 mt-2 text-[11px] text-[var(--text-faint)]">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-[var(--accent)] opacity-85" />
                Current quarter
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-[var(--text-faint)] opacity-45" />
                Past quarters
              </span>
            </div>
          </>
        ) : (
          <>
            {/* Comparison summary stats */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="p-3 rounded-[var(--radius-button)] bg-[var(--bg-elevated)] border border-[var(--border)]">
                <p className="text-[10px] text-[var(--text-faint)] mb-1">Current {timeWindow}</p>
                <p className="text-lg font-mono font-semibold text-[var(--accent-text)]">{formatGRT(currentTotal)}</p>
                <p className="text-[10px] text-[var(--text-faint)] font-mono">{formatGRTFull(currentTotal)} GRT</p>
              </div>
              <div className="p-3 rounded-[var(--radius-button)] bg-[var(--bg-elevated)] border border-[var(--border)]">
                <p className="text-[10px] text-[var(--text-faint)] mb-1">Previous {timeWindow}</p>
                <p className="text-lg font-mono font-semibold text-[var(--text-muted)]">{formatGRT(previousTotal)}</p>
                <p className="text-[10px] text-[var(--text-faint)] font-mono">{formatGRTFull(previousTotal)} GRT</p>
              </div>
              <div className="p-3 rounded-[var(--radius-button)] bg-[var(--bg-elevated)] border border-[var(--border)] flex flex-col justify-center items-center">
                <p className="text-[10px] text-[var(--text-faint)] mb-1">Change</p>
                <p className={`text-lg font-mono font-semibold ${deltaPositive ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
                  {deltaPositive ? '+' : ''}{delta.toFixed(1)}%
                </p>
              </div>
            </div>
            {/* Epoch bar chart */}
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={visibleData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
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
                    {...TOOLTIP_STYLE}
                    labelFormatter={(label, payload) => {
                      const date = payload?.[0]?.payload?.date;
                      return date ? `Epoch ${label} · ${date}` : `Epoch ${label}`;
                    }}
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
            <div className="flex items-center justify-center gap-4 mt-2 text-[11px] text-[var(--text-faint)]">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-[var(--accent)] opacity-85" />
                Current {timeWindow}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-[var(--text-faint)] opacity-35" />
                Previous {timeWindow}
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
