'use client';

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useIndexerQoS } from '@/hooks/useNetworkStats';
import { ChartSkeleton } from '@/components/ui/ChartSkeleton';
import { formatGRTFull } from '@/lib/utils';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import type { IndexerQoSPoint } from '@/app/api/indexer-qos/[address]/route';

function shortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function formatK(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toFixed(0);
}

function formatMs(n: number): string {
  return n >= 1000 ? (n / 1000).toFixed(2) + 's' : n.toFixed(0) + 'ms';
}

function formatGRTAuto(n: number): string {
  if (n === 0) return '0.00';
  if (n >= 0.01) return n.toFixed(2);
  if (n >= 0.0001) return n.toFixed(6);
  return n.toExponential(2);
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

function QoSMiniChart({
  data,
  dataKey,
  label,
  summary,
  color,
  formatter,
  tickFormatter,
  domain,
}: {
  data: IndexerQoSPoint[];
  dataKey: keyof IndexerQoSPoint;
  label: string;
  summary: string;
  color: string;
  formatter: (v: number) => string;
  tickFormatter: (v: number) => string;
  domain?: [number | string, number | string];
}) {
  return (
    <div className="bg-[var(--bg-elevated)] border border-[var(--border)] rounded-[var(--radius-card)] p-4">
      <div className="flex justify-between items-start mb-3">
        <span className="text-sm text-[var(--text-muted)]">{label}</span>
        <span className="text-sm font-mono text-[var(--text)]">{summary}</span>
      </div>
      <div className="h-[120px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={`qos-grad-${dataKey as string}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                <stop offset="95%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="date"
              axisLine={false}
              tickLine={false}
              tick={{ fill: 'var(--text-faint)', fontSize: 9 }}
              tickFormatter={shortDate}
              interval={Math.max(0, Math.floor(data.length / 3) - 1)}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: 'var(--text-faint)', fontSize: 9 }}
              tickFormatter={tickFormatter}
              width={44}
              domain={domain}
            />
            <Tooltip
              {...TOOLTIP_STYLE}
              formatter={(v) => [formatter(Number(v)), label]}
            />
            <Area
              type="monotone"
              dataKey={dataKey as string}
              stroke={color}
              strokeWidth={1.5}
              fill={`url(#qos-grad-${dataKey as string})`}
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function IndexerQoSChart({ indexer }: { indexer: string }) {
  const { data, isLoading } = useIndexerQoS(indexer);
  const qos = data?.qos ?? [];

  const latest = qos[qos.length - 1];
  const totalQueries = qos.reduce((s, p) => s + p.queryCount, 0);
  const avgSuccess = qos.length > 0
    ? qos.reduce((s, p) => s + p.successRate, 0) / qos.length
    : 0;
  const avgLatency = qos.length > 0
    ? qos.reduce((s, p) => s + p.latencyMs, 0) / qos.length
    : 0;
  const avgBlocks = qos.length > 0
    ? qos.reduce((s, p) => s + p.blocksBehind, 0) / qos.length
    : 0;
  const totalFees = qos.reduce((s, p) => s + p.totalQueryFees, 0);
  const avgFee = totalQueries > 0 ? totalFees / totalQueries : 0;

  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader>
        <CardTitle>Query Performance</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <ChartSkeleton height="200px" />
        ) : qos.length === 0 ? (
          <div className="h-[200px] flex items-center justify-center">
            <p className="text-sm text-[var(--text-faint)]">No QoS data available</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <QoSMiniChart
              data={qos}
              dataKey="queryCount"
              label="Query Count"
              summary={formatK(totalQueries)}
              color="var(--accent)"
              formatter={(v) => formatK(v) + ' queries'}
              tickFormatter={formatK}
            />
            <QoSMiniChart
              data={qos}
              dataKey="totalQueryFees"
              label="Query Fees"
              summary={formatGRTFull(totalFees) + ' GRT'}
              color="var(--green)"
              formatter={(v) => formatGRTFull(v) + ' GRT'}
              tickFormatter={(v) => formatGRTFull(v)}
            />
            <QoSMiniChart
              data={qos}
              dataKey="avgQueryFee"
              label="Avg. Query Fee"
              summary={latest ? formatGRTAuto(latest.avgQueryFee) + ' GRT' : '—'}
              color="var(--amber)"
              formatter={(v) => formatGRTAuto(v) + ' GRT'}
              tickFormatter={(v) => formatGRTAuto(v)}
            />
            <QoSMiniChart
              data={qos}
              dataKey="successRate"
              label="Query Success Rate"
              summary={avgSuccess.toFixed(2) + '%'}
              color="var(--green)"
              formatter={(v) => v.toFixed(2) + '%'}
              tickFormatter={(v) => v.toFixed(0) + '%'}
              domain={[0, 100]}
            />
            <QoSMiniChart
              data={qos}
              dataKey="latencyMs"
              label="Avg. Indexer Latency"
              summary={formatMs(avgLatency)}
              color="var(--accent)"
              formatter={formatMs}
              tickFormatter={formatMs}
            />
            <QoSMiniChart
              data={qos}
              dataKey="blocksBehind"
              label="Avg. Blocks Behind"
              summary={formatK(avgBlocks)}
              color="var(--amber)"
              formatter={(v) => formatK(v) + ' blocks'}
              tickFormatter={formatK}
            />
          </div>
        )}
        <p className="text-[10px] text-[var(--text-faint)] mt-3 text-right">
          Source: Gateway QoS Oracle · 90 day window
        </p>
      </CardContent>
    </Card>
  );
}
