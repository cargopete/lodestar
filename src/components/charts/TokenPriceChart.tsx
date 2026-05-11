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
import { TokenIcon } from '@/components/tokens/TokenIcon';
import { formatCompact, formatUSD } from '@/lib/utils';
import type { OhlcPoint } from '@/lib/tokens/types';

interface Props {
  data: OhlcPoint[];
  /** Token identity for the card header. When omitted, the header
   *  falls back to a generic "Price" title without a logo. */
  identity?: {
    symbol: string;
    icon: string | null;
    logoUri: string | null;
    contract: string;
    chain: 'mainnet' | 'arbitrum' | 'base' | 'polygon' | 'optimism';
  };
  /**
   * Optional ETH/USD daily closes used as a volatility benchmark. When the
   * data is provided, the chart's stats line shows e.g. "vol 47% (1.8× ETH)"
   * — same window, same formula applied to ETH. Useful relative scale.
   */
  benchmark?: { timestamp: number; close: number }[];
  isLoading?: boolean;
  /**
   * When true, the chart locks the y-axis to a tight band around $1 (default
   * ±2%). For stablecoins, recharts' auto-scale exaggerates noise — a
   * legitimate peg drift of 0.05% gets blown up into a wild-looking chart.
   * Locking the axis surfaces actual peg deviation against a fixed scale.
   */
  pegged?: boolean;
  /**
   * Optional controlled timeframe. When provided, the chart uses the parent's
   * `windowId` and surfaces selection via `onWindowChange`. Lets the
   * performance pills above the chart drive its timeframe (click "30d" →
   * chart jumps to 1M view).
   */
  windowId?: WindowId;
  onWindowChange?: (id: WindowId) => void;
}

const WINDOWS = [
  { id: '1W', days: 7 },
  { id: '1M', days: 30 },
  { id: '3M', days: 90 },
  // `All` = no cutoff, render the full priceSeries (the detail endpoint
  // fetches up to four daily pages, so this typically reaches ~200 days).
  { id: 'All', days: Infinity },
] as const;

export type WindowId = (typeof WINDOWS)[number]['id'];
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

export function TokenPriceChart({
  data,
  identity,
  benchmark,
  isLoading,
  pegged = false,
  windowId: controlledWindowId,
  onWindowChange,
}: Props) {
  const [internalWindowId, setInternalWindowId] = useState<WindowId>('1M');
  const windowId = controlledWindowId ?? internalWindowId;
  const setWindowId = onWindowChange ?? setInternalWindowId;
  const [mode, setMode] = useState<Mode>('line');

  const points = useMemo(() => {
    if (!data || data.length === 0) return [];
    const w = WINDOWS.find((x) => x.id === windowId) ?? WINDOWS[1];
    // Infinity-day window means no cutoff — pass everything through.
    const cutoff =
      Number.isFinite(w.days) ? data[data.length - 1].timestamp - w.days * 86400 : -Infinity;
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
          // Volume retained on the point so the strip chart below can share
          // the same `points` array (and therefore the same x-axis ticks).
          volume: p.volume ?? 0,
          isGreen,
          // Range encodings consumed by recharts Bar in candle mode.
          bodyRange: [Math.min(open, p.close), Math.max(open, p.close)] as [number, number],
          wickRange: [low, high] as [number, number],
        };
      });
  }, [data, windowId]);

  // Annualised realised volatility from log returns. Same formula we want
  // to apply to both the token series and the ETH benchmark.
  function annualisedVol(closes: number[]): number | null {
    if (closes.length < 5) return null;
    const returns: number[] = [];
    for (let i = 1; i < closes.length; i++) {
      const a = closes[i - 1];
      const b = closes[i];
      if (a > 0 && b > 0) returns.push(Math.log(b / a));
    }
    if (returns.length < 4) return null;
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
    return Math.sqrt(variance) * Math.sqrt(365) * 100;
  }

  const stats = useMemo(() => {
    if (points.length < 2) return null;
    const first = points[0].close;
    const last = points[points.length - 1].close;
    const pct = first > 0 ? ((last - first) / first) * 100 : 0;
    const min = points.reduce((m, p) => Math.min(m, p.low), Infinity);
    const max = points.reduce((m, p) => Math.max(m, p.high), -Infinity);
    const vol = annualisedVol(points.map((p) => p.close));
    // ETH benchmark vol: scope to the same date range as the visible token
    // window, then run the same formula. Ratio is reported back to the UI;
    // a stablecoin would land near 0× ETH, a memecoin around 3-5× ETH.
    let ethVol: number | null = null;
    let ethRatio: number | null = null;
    if (benchmark && benchmark.length >= 5 && points.length > 0) {
      const start = points[0].ts;
      const end = points[points.length - 1].ts;
      const slice = benchmark.filter((b) => b.timestamp >= start && b.timestamp <= end);
      ethVol = annualisedVol(slice.map((b) => b.close));
      if (vol != null && ethVol != null && ethVol > 0) {
        ethRatio = vol / ethVol;
      }
    }
    return { first, last, pct, min, max, vol, ethVol, ethRatio };
  }, [points, benchmark]);

  const positive = (stats?.pct ?? 0) >= 0;
  const stroke = positive ? 'var(--green)' : '#ef4444';
  const gradientId = `tokenPriceArea-${positive ? 'pos' : 'neg'}`;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            {identity && (
              <TokenIcon
                symbol={identity.symbol}
                slug={identity.icon}
                logoUri={identity.logoUri}
                contract={identity.contract}
                chain={identity.chain}
                size={24}
              />
            )}
            <CardTitle>{identity ? `${identity.symbol} price` : 'Price'}</CardTitle>
            {stats && (
              <span className={`text-xs tabular-nums ${positive ? 'text-[var(--green)]' : 'text-red-500'}`}>
                {positive ? '+' : ''}{stats.pct.toFixed(2)}%
              </span>
            )}
            {stats && (
              <span className="text-[10px] text-[var(--text-faint)] tabular-nums">
                low {formatUSD(stats.min, priceDecimals(stats.min))} · high {formatUSD(stats.max, priceDecimals(stats.max))}
                {stats.vol != null && (
                  <>
                    {' · '}
                    <span title="Annualised realised volatility computed from daily log returns of the selected window. Standard 'stddev × √365' formula — same convention TradingView and CoinGecko use.">
                      vol {stats.vol.toFixed(0)}%
                      {stats.ethRatio != null && (
                        <span className="text-[var(--text-faint)]">
                          {' '}
                          ({stats.ethRatio.toFixed(2)}× ETH)
                        </span>
                      )}
                    </span>
                  </>
                )}
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
          <div>
            <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={points} margin={{ top: 10, right: 10, left: 0, bottom: 0 }} syncId="tokenPrice">
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
                  // Pegged mode: lock the axis to a tight band around $1 so
                  // peg drift is visible against a fixed scale instead of
                  // getting auto-scaled into apparent volatility.
                  domain={pegged ? [0.98, 1.02] : ['auto', 'auto']}
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
            {/* Daily volume strip. Shares x-axis layout (same `points`, same
                left padding via the matching YAxis `width`, same `syncId`)
                so bars line up under their corresponding price candles.
                ~56px tall — visible enough to spot volume regimes at a
                glance, small enough not to compete with the price chart. */}
            <div className="h-[56px] -mt-1">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={points} margin={{ top: 0, right: 10, left: 0, bottom: 0 }} syncId="tokenPrice">
                  <XAxis dataKey="date" hide />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: 'var(--text-faint)', fontSize: 9 }}
                    tickFormatter={(v) => formatCompact(Number(v))}
                    width={72}
                    domain={[0, 'auto']}
                    // Two ticks total — top of range and zero baseline. Any
                    // more crowds a 56px strip.
                    ticks={[]}
                  />
                  <Tooltip
                    cursor={{ stroke: 'var(--text-faint)', strokeDasharray: '3 3' }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const p = payload[0].payload as { ts: number; volume: number; close: number };
                      const usd = (p.volume ?? 0) * (p.close ?? 0);
                      const label = new Date(p.ts * 1000).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      });
                      return (
                        <div className="rounded border border-[var(--border-mid)] bg-[var(--bg-elevated)] px-2 py-1 text-[10px] text-[var(--text-muted)] shadow-lg">
                          <div className="text-[var(--text)] font-medium">{label}</div>
                          <div className="tabular-nums">vol {formatCompact(p.volume ?? 0)}</div>
                          {usd > 0 && (
                            <div className="tabular-nums text-[var(--text-faint)]">~{formatUSD(usd)}</div>
                          )}
                        </div>
                      );
                    }}
                  />
                  <Bar
                    dataKey="volume"
                    fill="var(--text-faint)"
                    fillOpacity={0.55}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
