'use client';

import { useMemo, useState } from 'react';
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { ChartSkeleton } from '@/components/ui/ChartSkeleton';
import { formatUSD } from '@/lib/utils';
import type { OhlcPoint } from '@/lib/tokens/types';

interface Props {
  data: OhlcPoint[];
  isLoading?: boolean;
}

const WINDOWS = [
  { id: '1W', days: 7 },
  { id: '1M', days: 30 },
  { id: '3M', days: 90 },
] as const;

type WindowId = (typeof WINDOWS)[number]['id'];
type Mode = 'line' | 'candles';

function priceDecimals(price: number): number {
  if (price >= 100) return 2;
  if (price >= 1) return 3;
  if (price >= 0.01) return 4;
  return 8;
}

interface CandleProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: {
    open: number;
    high: number;
    low: number;
    close: number;
    isGreen: boolean;
  };
}

// Single combined shape for the whole candle: wick line + body rect drawn
// from one Bar so they share the same x-slot. (Two separate Bars get
// grouped side-by-side by recharts, which split the wick from the body.)
//
// The Bar uses `dataKey="wickRange" = [low, high]` so the y/height props
// give us the wick's pixel range. We linearly interpolate within that
// range to derive open/close pixel positions for the body.
function Candle({ x = 0, y = 0, width = 0, height = 0, payload }: CandleProps) {
  if (!payload) return null;
  const { open, high, low, close, isGreen } = payload;
  const color = isGreen ? 'var(--green)' : '#ef4444';
  const cx = Math.round(x + width / 2) + 0.5;
  const bodyW = Math.min(Math.max(2, width * 0.7), 14);
  const bodyOffset = (width - bodyW) / 2;

  const range = high - low;
  const priceToY = (v: number) =>
    range > 0 ? y + (height * (high - v)) / range : y + height / 2;

  const bodyTop = priceToY(Math.max(open, close));
  const bodyBottom = priceToY(Math.min(open, close));
  const bodyH = Math.max(1, bodyBottom - bodyTop);

  return (
    <g>
      <line
        x1={cx}
        x2={cx}
        y1={y}
        y2={y + Math.max(1, height)}
        stroke={color}
        strokeWidth={1.5}
        shapeRendering="crispEdges"
      />
      <rect
        x={x + bodyOffset}
        y={bodyTop}
        width={bodyW}
        height={bodyH}
        fill={color}
        stroke={color}
        strokeWidth={0.5}
        shapeRendering="crispEdges"
      />
    </g>
  );
}

export function TokenPriceChart({ data, isLoading }: Props) {
  const [windowId, setWindowId] = useState<WindowId>('1M');
  const [mode, setMode] = useState<Mode>('line');

  const points = useMemo(() => {
    if (!data || data.length === 0) return [];
    const w = WINDOWS.find((x) => x.id === windowId) ?? WINDOWS[1];
    const cutoff = data[data.length - 1].timestamp - w.days * 86400;
    return data
      .filter((p) => p.timestamp >= cutoff && p.close > 0)
      .map((p) => {
        // Pool OHLC sometimes has open=0 or low=0 on thin bars; fall back to
        // close so the candle still renders rather than collapsing to the axis.
        const open = p.open > 0 ? p.open : p.close;
        const high = p.high > 0 ? p.high : Math.max(open, p.close);
        const low = p.low > 0 ? p.low : Math.min(open, p.close);
        const isGreen = p.close >= open;
        return {
          ts: p.timestamp,
          date: new Date(p.timestamp * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
          open,
          high,
          low,
          close: p.close,
          isGreen,
          // Range encodings consumed by recharts Bar in candle mode.
          bodyRange: [Math.min(open, p.close), Math.max(open, p.close)] as [number, number],
          wickRange: [low, high] as [number, number],
        };
      });
  }, [data, windowId]);

  const stats = useMemo(() => {
    if (points.length < 2) return null;
    const first = points[0].close;
    const last = points[points.length - 1].close;
    const pct = first > 0 ? ((last - first) / first) * 100 : 0;
    const min = points.reduce((m, p) => Math.min(m, p.low), Infinity);
    const max = points.reduce((m, p) => Math.max(m, p.high), -Infinity);
    return { first, last, pct, min, max };
  }, [points]);

  const positive = (stats?.pct ?? 0) >= 0;
  const stroke = positive ? 'var(--green)' : '#ef4444';
  const gradientId = `tokenPriceArea-${positive ? 'pos' : 'neg'}`;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-baseline gap-3">
            <CardTitle>Price</CardTitle>
            {stats && (
              <span className={`text-xs tabular-nums ${positive ? 'text-[var(--green)]' : 'text-red-500'}`}>
                {positive ? '+' : ''}{stats.pct.toFixed(2)}%
              </span>
            )}
            {stats && (
              <span className="text-[10px] text-[var(--text-faint)] tabular-nums">
                low {formatUSD(stats.min, priceDecimals(stats.min))} · high {formatUSD(stats.max, priceDecimals(stats.max))}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex border-[0.5px] border-[var(--border)] rounded-md overflow-hidden">
              {(['line', 'candles'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    mode === m
                      ? 'bg-[var(--accent)]/15 text-[var(--accent)]'
                      : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                  }`}
                >
                  {m === 'line' ? 'Line' : 'Candles'}
                </button>
              ))}
            </div>
            <div className="inline-flex border-[0.5px] border-[var(--border)] rounded-md overflow-hidden">
              {WINDOWS.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => setWindowId(w.id)}
                  className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    windowId === w.id
                      ? 'bg-[var(--accent)]/15 text-[var(--accent)]'
                      : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                  }`}
                >
                  {w.id}
                </button>
              ))}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <ChartSkeleton height="280px" />
        ) : points.length < 2 ? (
          <div className="h-[280px] flex items-center justify-center text-sm text-[var(--text-muted)]">
            Not enough price data for this window.
          </div>
        ) : (
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={points} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={stroke} stopOpacity={0.35} />
                    <stop offset="95%" stopColor={stroke} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="date"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: 'var(--text-faint)', fontSize: 11 }}
                  interval={Math.max(0, Math.floor(points.length / 6) - 1)}
                  minTickGap={24}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: 'var(--text-faint)', fontSize: 11 }}
                  tickFormatter={(v) => formatUSD(Number(v), priceDecimals(Number(v)))}
                  width={72}
                  domain={['auto', 'auto']}
                />
                <Tooltip
                  cursor={{ stroke: 'var(--text-faint)', strokeDasharray: '3 3' }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const p = payload[0].payload as {
                      ts: number;
                      open: number;
                      high: number;
                      low: number;
                      close: number;
                      isGreen: boolean;
                    };
                    const fmt = (x: number) => formatUSD(x, priceDecimals(x));
                    const label = new Date(p.ts * 1000).toLocaleString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    });
                    return (
                      <div
                        className="rounded border border-[var(--border-mid)] bg-[var(--bg-elevated)] px-2 py-1.5 text-[11px] text-[var(--text-muted)] shadow-lg"
                      >
                        <div className="text-[var(--text)] font-medium mb-0.5">{label}</div>
                        {mode === 'candles' ? (
                          <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 tabular-nums">
                            <span>O</span><span className="text-[var(--text)]">{fmt(p.open)}</span>
                            <span>H</span><span className="text-[var(--text)]">{fmt(p.high)}</span>
                            <span>L</span><span className="text-[var(--text)]">{fmt(p.low)}</span>
                            <span>C</span>
                            <span className={p.isGreen ? 'text-[var(--green)]' : 'text-red-500'}>
                              {fmt(p.close)}
                            </span>
                          </div>
                        ) : (
                          <div className="tabular-nums text-[var(--text)]">{fmt(p.close)}</div>
                        )}
                      </div>
                    );
                  }}
                />
                {mode === 'line' ? (
                  <Area
                    type="monotone"
                    dataKey="close"
                    stroke={stroke}
                    strokeWidth={1.6}
                    fill={`url(#${gradientId})`}
                    isAnimationActive={false}
                  />
                ) : (
                  <Bar
                    dataKey="wickRange"
                    name="candle"
                    shape={Candle as never}
                    isAnimationActive={false}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
