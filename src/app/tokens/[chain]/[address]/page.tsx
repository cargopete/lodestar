'use client';

import { use, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { TokenPriceChart, type WindowId } from '@/components/charts/TokenPriceChart';
import { TagBadge } from '@/components/tokens/TagBadge';
import { TokenIcon } from '@/components/tokens/TokenIcon';
import { useTokenDetail } from '@/hooks/useTokens';
import { formatCompact, formatNumber, formatPrice, formatUSD, shortenAddress } from '@/lib/utils';
import { getTradeUrl } from '@/lib/tokens/trade-urls';
import type { TokenDetail } from '@/lib/tokens/types';

// Header price with a brief tick-flash on refresh. Compares the incoming
// value to the previous render's value via a ref; on change, latches a
// direction ("up" | "down") and clears it ~700ms later. Equal values
// (no movement) and the initial render don't flash.
function FlashingPrice({ value }: { value: number }) {
  const prev = useRef<number | null>(null);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);
  useEffect(() => {
    if (prev.current != null && value !== prev.current) {
      setFlash(value > prev.current ? 'up' : 'down');
      const id = setTimeout(() => setFlash(null), 700);
      prev.current = value;
      return () => clearTimeout(id);
    }
    prev.current = value;
  }, [value]);

  const flashCls =
    flash === 'up'
      ? 'bg-[var(--green)]/20 ring-1 ring-[var(--green)]/40'
      : flash === 'down'
        ? 'bg-red-500/20 ring-1 ring-red-500/40'
        : 'bg-transparent ring-1 ring-transparent';
  return (
    <span
      className={`text-2xl tabular-nums px-1.5 py-0.5 rounded transition-colors duration-700 ${flashCls}`}
    >
      {formatPrice(value)}
    </span>
  );
}

function LiveQuoteIndicator({ asOf }: { asOf: number }) {
  // Tick every second so "5s ago" stays current between react-query polls.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const seconds = Math.max(0, Math.floor((now - asOf) / 1000));
  const stale = seconds > 90;
  const label =
    seconds < 5 ? 'just now' : seconds < 60 ? `${seconds}s ago` : `${Math.floor(seconds / 60)}m ago`;
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[10px] tabular-nums ${
        stale ? 'text-[var(--text-faint)]' : 'text-[var(--text-muted)]'
      }`}
      title="Live quote = Uniswap V3 token.derivedETH × bundle.ethPriceUSD, fetched via The Graph Network gateway. Refreshes every 30s while the tab is open."
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${stale ? 'bg-[var(--text-faint)]' : 'bg-[var(--green)] animate-pulse'}`}
        aria-hidden
      />
      Live via{' '}
      <a
        href="https://thegraph.com/explorer/subgraphs/5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV"
        target="_blank"
        rel="noreferrer"
        className="underline decoration-dotted underline-offset-2 hover:text-[var(--accent)]"
      >
        Uniswap V3 subgraph
      </a>{' '}
      · {label}
    </span>
  );
}

interface Props {
  params: Promise<{ chain: string; address: string }>;
}

function priceDecimals(p: number): number {
  if (p >= 100) return 2;
  if (p >= 1) return 3;
  if (p >= 0.01) return 4;
  return 8;
}

function PerformancePills({
  summary,
  activeWindow,
  onSelect,
}: {
  summary: TokenDetail['summary'];
  activeWindow: WindowId;
  onSelect: (id: WindowId) => void;
}) {
  // Each pill maps to a chart window so clicking it focuses the chart on the
  // matching timeframe. The 24h pill maps to 1W (the chart has no shorter
  // window in v0; 1W still gives context with the latest bar in clear focus).
  const items: Array<{ label: string; v: number | null; window: WindowId }> = [
    { label: '24h', v: summary.change24hPct, window: '1W' },
    { label: '7d', v: summary.change7dPct, window: '1W' },
    { label: '30d', v: summary.change30dPct, window: '1M' },
    { label: '90d', v: summary.change90dPct, window: '3M' },
  ];
  return (
    <div className="grid grid-cols-4 gap-2">
      {items.map(({ label, v, window }) => {
        const positive = (v ?? 0) >= 0;
        const color =
          v == null
            ? 'text-[var(--text-faint)]'
            : positive
              ? 'text-[var(--green)]'
              : 'text-red-500';
        const active = activeWindow === window;
        return (
          <button
            key={label}
            type="button"
            onClick={() => onSelect(window)}
            className={`text-left rounded-md border bg-[var(--bg-surface)] px-3 py-2 transition-colors ${
              active
                ? 'border-[var(--accent)]/60 ring-1 ring-[var(--accent)]/30'
                : 'border-[var(--border)] hover:border-[var(--accent)]/40'
            }`}
          >
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">{label}</div>
            <div className={`text-sm tabular-nums mt-0.5 ${color}`}>
              {v == null ? '—' : `${positive ? '+' : ''}${v.toFixed(2)}%`}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function Range24h({ range, change }: { range: TokenDetail['range24h']; change: number | null }) {
  if (!range) return null;
  // Direction tint comes from the 24h % change. Position-on-the-track is a
  // neutral signal (low and high are just bounds, not "good" / "bad"), so the
  // track itself stays neutral and only the dot reflects momentum.
  const dotColor =
    change == null
      ? 'bg-[var(--text)]'
      : change >= 0
        ? 'bg-[var(--green)]'
        : 'bg-red-500';
  return (
    <Card>
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">24h Range</div>
        <div className="text-[11px] tabular-nums text-[var(--text-muted)]">
          {formatUSD(range.low, priceDecimals(range.low))} ↔ {formatUSD(range.high, priceDecimals(range.high))}
        </div>
      </div>
      <div className="relative h-2 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
        <div
          className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full ${dotColor} border-2 border-[var(--bg-surface)] shadow`}
          style={{ left: `${(range.position * 100).toFixed(1)}%` }}
        />
      </div>
    </Card>
  );
}

function Markets({ markets, chain }: { markets: TokenDetail['markets']; chain: string }) {
  // Concentration risk signal: how much of the indexed pool TVL sits in the
  // single deepest pool. Markets are already TVL-sorted, so [0] is the
  // headliner. A 90%-concentration token is one rug-pull away from
  // illiquidity; a 30%-concentration token is well-distributed.
  const tvlSum = markets.reduce((s, m) => s + (m.tvlUsd ?? 0), 0);
  const topShare = tvlSum > 0 && markets[0]?.tvlUsd ? markets[0].tvlUsd / tvlSum : null;
  // Cross-pool price spread: when multiple pools quote the seed token, the
  // gap between max and min quotes signals fragmentation (or arb activity).
  // We compute on the relative scale (`(max-min) / median`) so the number is
  // unit-independent. Only counts pools that produced a USD price (V3 paired
  // against stable/WETH) — Kyber Elastic / V2 / V4 pairs without quotes get
  // skipped.
  const priced = markets.map((m) => m.priceUsd).filter((p): p is number => p != null && p > 0);
  let spreadPct: number | null = null;
  if (priced.length >= 2) {
    const sorted = [...priced].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    spreadPct = median > 0 ? ((sorted[sorted.length - 1] - sorted[0]) / median) * 100 : null;
  }
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle>Markets</CardTitle>
          <span className="text-[11px] text-[var(--text-faint)] flex items-center gap-2 flex-wrap">
            <span>{markets.length} pools · click to trade</span>
            {topShare != null && (
              <>
                <span>·</span>
                <span
                  className={
                    topShare >= 0.7
                      ? 'text-amber-500'
                      : 'text-[var(--text-faint)]'
                  }
                  title="Share of total indexed TVL held in the deepest single pool. Above 70% means liquidity is concentrated and the token is exposed to a single-pool failure."
                >
                  top pool {(topShare * 100).toFixed(0)}% of TVL
                </span>
              </>
            )}
            {spreadPct != null && (
              <>
                <span>·</span>
                <span
                  className={
                    spreadPct >= 0.5
                      ? 'text-amber-500'
                      : 'text-[var(--text-faint)]'
                  }
                  title={`Spread between the highest and lowest USD price quoted across this token's pools, normalised by median. ${priced.length} pool${priced.length === 1 ? '' : 's'} contributed quotes. Above 0.5% suggests fragmented liquidity or live arbitrage opportunities.`}
                >
                  spread {spreadPct.toFixed(2)}%
                </span>
              </>
            )}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        {markets.length === 0 ? (
          <div className="text-xs text-[var(--text-faint)]">No DEX pools indexed for this token.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="py-2 text-left text-[11px] font-medium text-[var(--text-faint)]">Venue</th>
                <th className="py-2 text-left text-[11px] font-medium text-[var(--text-faint)]">Pair</th>
                <th className="py-2 text-right text-[11px] font-medium text-[var(--text-faint)]">Fee</th>
                <th className="py-2 text-right text-[11px] font-medium text-[var(--text-faint)]">TVL</th>
                <th className="py-2 text-right text-[11px] font-medium text-[var(--text-faint)]">24h Vol</th>
                <th className="py-2 text-right text-[11px] font-medium text-[var(--text-faint)]">Trade</th>
              </tr>
            </thead>
            <tbody>
              {markets.map((m) => {
                const trade = getTradeUrl(m.protocol, chain, m.baseContract, m.quoteContract);
                const rowProps = trade
                  ? {
                      onClick: () => window.open(trade.url, '_blank', 'noopener,noreferrer'),
                      className: 'border-b border-[var(--border)]/40 cursor-pointer hover:bg-[var(--bg-elevated)]/50 transition-colors',
                    }
                  : { className: 'border-b border-[var(--border)]/40' };
                return (
                  <tr key={m.pool} {...rowProps}>
                    <td className="py-2 capitalize">{m.protocol.replace(/_/g, ' ')}</td>
                    <td className="py-2">
                      <span className="font-medium">{m.baseSymbol}</span>
                      <span className="text-[var(--text-faint)]"> / {m.quoteSymbol}</span>
                    </td>
                    <td className="py-2 text-right tabular-nums text-[var(--text-muted)]">
                      {m.feeBps != null && m.feeBps > 0 ? `${(m.feeBps / 10000).toFixed(2)}%` : '—'}
                    </td>
                    <td className="py-2 text-right tabular-nums text-[var(--text-muted)]">
                      {m.tvlUsd != null ? formatUSD(m.tvlUsd) : <span className="text-[var(--text-faint)]">—</span>}
                    </td>
                    <td className="py-2 text-right tabular-nums text-[var(--text-muted)]">
                      {m.volume24hUsd != null ? formatUSD(m.volume24hUsd) : <span className="text-[var(--text-faint)]">—</span>}
                    </td>
                    <td className="py-2 text-right">
                      {trade ? (
                        <span className="inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline">
                          {trade.venue}
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                          </svg>
                        </span>
                      ) : (
                        <span className="font-mono text-xs text-[var(--text-faint)]" title="No deep link available for this venue">
                          {shortenAddress(m.pool, 4)}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

function relativeTime(ts: number): string {
  const diff = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function RecentSwaps({ swaps, symbol }: { swaps: TokenDetail['recentSwaps']; symbol: string }) {
  // "Last activity" indicator. A token whose most recent indexed swap was
  // hours/days ago is dormant — useful flag at a glance, no need to scan
  // the rows below to figure it out.
  const latest = swaps[0]?.timestamp;
  // Buy/sell pressure: how the recent window is leaning. The badge per row
  // already shows side, but a header summary gives the at-a-glance momentum
  // signal without the user having to count.
  const buys = swaps.filter((s) => s.side === 'buy').length;
  const sells = swaps.length - buys;
  const buyPct = swaps.length > 0 ? (buys / swaps.length) * 100 : null;
  // Average swap size in USD across the window. Reveals whether activity is
  // a few whales or many retail trades — the chart can't show this.
  const usdSwaps = swaps.filter((s) => s.amountUsd != null) as Array<
    TokenDetail['recentSwaps'][number] & { amountUsd: number }
  >;
  const avgSize =
    usdSwaps.length > 0 ? usdSwaps.reduce((s, x) => s + x.amountUsd, 0) / usdSwaps.length : null;
  // Tint the buy-pressure label — > 65% buys is bullish-leaning, < 35% is
  // bearish-leaning, the band in between stays neutral.
  const pressureColor =
    buyPct == null
      ? 'text-[var(--text-faint)]'
      : buyPct >= 65
        ? 'text-[var(--green)]'
        : buyPct <= 35
          ? 'text-red-500'
          : 'text-[var(--text-faint)]';
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle>Recent swaps</CardTitle>
          <div className="text-[11px] text-[var(--text-faint)] flex items-center gap-3 flex-wrap">
            {buyPct != null && (
              <span title={`${buys} buys / ${sells} sells in the last ${swaps.length} indexed swaps. > 65% buys tinted green, < 35% tinted red.`}>
                <span className={pressureColor}>{buyPct.toFixed(0)}% buys</span>
                <span className="text-[var(--text-faint)]"> ({buys}/{sells})</span>
              </span>
            )}
            {avgSize != null && (
              <span title="Average USD value per swap across the displayed window.">
                avg {formatUSD(avgSize, avgSize < 100 ? 2 : 0)}
              </span>
            )}
            {latest != null && <span>last activity {relativeTime(latest)}</span>}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {swaps.length === 0 ? (
          <div className="text-xs text-[var(--text-faint)]">No recent swaps returned.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="py-2 text-left text-[11px] font-medium text-[var(--text-faint)]">When</th>
                <th className="py-2 text-left text-[11px] font-medium text-[var(--text-faint)]">Side</th>
                <th className="py-2 text-right text-[11px] font-medium text-[var(--text-faint)]">{symbol} amount</th>
                <th className="py-2 text-right text-[11px] font-medium text-[var(--text-faint)]">USD</th>
                <th className="py-2 text-right text-[11px] font-medium text-[var(--text-faint)]">Price</th>
                <th className="py-2 text-left text-[11px] font-medium text-[var(--text-faint)] pl-3">Trader</th>
                <th className="py-2 text-left text-[11px] font-medium text-[var(--text-faint)] pl-3">Pair</th>
                <th className="py-2 text-right text-[11px] font-medium text-[var(--text-faint)]">Tx</th>
              </tr>
            </thead>
            <tbody>
              {swaps.map((s, i) => (
                <tr key={`${s.txHash}-${s.timestamp}-${i}`} className="border-b border-[var(--border)]/40">
                  <td className="py-2 text-xs text-[var(--text-muted)]">{relativeTime(s.timestamp)}</td>
                  <td className="py-2">
                    <span
                      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        s.side === 'buy'
                          ? 'bg-[var(--green)]/15 text-[var(--green)]'
                          : 'bg-red-500/15 text-red-500'
                      }`}
                    >
                      {s.side === 'buy' ? 'Buy' : 'Sell'}
                    </span>
                  </td>
                  <td className="py-2 text-right tabular-nums">{formatNumber(Math.round(s.amount))}</td>
                  <td className="py-2 text-right tabular-nums">
                    {s.amountUsd != null ? formatUSD(s.amountUsd, s.amountUsd < 100 ? 2 : 0) : '—'}
                  </td>
                  <td className="py-2 text-right tabular-nums text-[var(--text-muted)]">
                    {s.priceUsd != null ? formatPrice(s.priceUsd) : '—'}
                  </td>
                  <td className="py-2 pl-3">
                    {s.trader ? (
                      <a
                        href={`https://etherscan.io/address/${s.trader}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-xs text-[var(--text-muted)] hover:text-[var(--accent)]"
                        title={s.trader}
                      >
                        {shortenAddress(s.trader, 4)}
                      </a>
                    ) : (
                      <span className="text-[var(--text-faint)]">—</span>
                    )}
                  </td>
                  <td className="py-2 pl-3 text-xs text-[var(--text-muted)]">
                    {symbol} / {s.counterpartySymbol}
                    <span className="ml-2 text-[10px] text-[var(--text-faint)] capitalize">{s.protocol.replace(/_/g, ' ')}</span>
                  </td>
                  <td className="py-2 text-right">
                    <a
                      href={`https://etherscan.io/tx/${s.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-xs text-[var(--text-muted)] hover:text-[var(--accent)]"
                    >
                      {s.txHash.slice(0, 6)}…
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

// Header trade button. Picks the deepest pool from the (TVL-sorted) markets
// array and deep-links to its swap interface via `getTradeUrl`. The Markets
// table below lets users pick a different pool; this CTA caters to the
// dominant case where you just want to trade through the headline venue.
function TradeCTA({
  markets,
  chain,
  symbol,
}: {
  markets: TokenDetail['markets'];
  chain: string;
  symbol: string;
}) {
  const top = markets[0];
  if (!top) return null;
  const trade = getTradeUrl(top.protocol, chain, top.baseContract, top.quoteContract);
  if (!trade) return null;
  return (
    <a
      href={trade.url}
      target="_blank"
      rel="noreferrer"
      title={`Swap ${symbol} on ${trade.venue} (top pool by TVL)`}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--accent)]/15 text-[var(--accent)] hover:bg-[var(--accent)]/25 transition-colors text-sm font-medium"
    >
      Trade on {trade.venue}
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
      </svg>
    </a>
  );
}

// Cross-chain badge row. The seed list hand-curates `altContracts` per
// chain — surface them here so users know the same project also lives on
// Arbitrum / Base / Polygon. Each badge links to the explorer on that chain.
const EXPLORERS: Record<string, { name: string; tx: string }> = {
  arbitrum: { name: 'Arbitrum', tx: 'https://arbiscan.io/token/' },
  base: { name: 'Base', tx: 'https://basescan.org/token/' },
  polygon: { name: 'Polygon', tx: 'https://polygonscan.com/token/' },
  optimism: { name: 'Optimism', tx: 'https://optimistic.etherscan.io/token/' },
};

function CrossChainRow({ alt }: { alt: TokenDetail['summary']['altContracts'] }) {
  const entries = Object.entries(alt).filter(([, addr]) => !!addr) as Array<[string, string]>;
  if (entries.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
      <span className="text-[var(--text-faint)]">Also on:</span>
      {entries.map(([chain, addr]) => {
        const ex = EXPLORERS[chain];
        if (!ex) return null;
        return (
          <a
            key={chain}
            href={`${ex.tx}${addr}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
            title={`${ex.name}: ${addr}`}
          >
            {ex.name}
          </a>
        );
      })}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {}
      }}
      className="ml-2 text-[10px] px-1.5 py-0.5 rounded border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--accent)]"
    >
      {copied ? 'copied' : 'copy'}
    </button>
  );
}

function Info({
  contract,
  decimals,
  totalSupply,
  circulating,
  website,
  name,
}: {
  contract: string;
  decimals: number;
  totalSupply: number | null;
  circulating: number | null;
  website: string | null;
  name: string;
}) {
  let host: string | null = null;
  if (website) {
    try { host = new URL(website).host.replace(/^www\./, ''); } catch {}
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Info</CardTitle>
      </CardHeader>
      <CardContent>
        {website && (
          <a
            href={website}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between gap-2 mb-3 px-3 py-2 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)]/40 hover:border-[var(--accent)] hover:bg-[var(--accent)]/10 transition-colors group"
          >
            <span className="flex items-center gap-2">
              <svg className="w-4 h-4 text-[var(--accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A9.005 9.005 0 0121 12.001c0 .921-.139 1.811-.398 2.65m-19.204-5.07A8.965 8.965 0 003 12.001c0 .921.139 1.811.398 2.65" />
              </svg>
              <span className="text-sm font-medium">Visit {name}</span>
            </span>
            <span className="flex items-center gap-1 text-[11px] text-[var(--text-faint)] group-hover:text-[var(--accent)]">
              {host}
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
              </svg>
            </span>
          </a>
        )}
        <dl className="space-y-2 text-sm">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <dt className="text-[var(--text-faint)] text-xs uppercase tracking-wider">Contract</dt>
            <dd className="flex items-center font-mono text-xs">
              <a
                href={`https://etherscan.io/token/${contract}`}
                target="_blank"
                rel="noreferrer"
                className="text-[var(--text-muted)] hover:text-[var(--accent)]"
              >
                {shortenAddress(contract, 6)}
              </a>
              <CopyButton text={contract} />
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-[var(--text-faint)] text-xs uppercase tracking-wider">Decimals</dt>
            <dd className="tabular-nums">{decimals}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-[var(--text-faint)] text-xs uppercase tracking-wider">Circulating</dt>
            <dd className="tabular-nums">{circulating != null ? formatNumber(Math.round(circulating)) : '—'}</dd>
          </div>
          {totalSupply != null && (
            <div className="flex items-center justify-between gap-3">
              <dt className="text-[var(--text-faint)] text-xs uppercase tracking-wider">Total Supply</dt>
              <dd className="tabular-nums text-[var(--text-muted)]">{formatNumber(Math.round(totalSupply))}</dd>
            </div>
          )}
        </dl>
      </CardContent>
    </Card>
  );
}

export default function TokenDetailPage({ params }: Props) {
  const { chain, address } = use(params);
  const { data, isLoading, error } = useTokenDetail(chain, address);
  // Lifted chart timeframe so the performance pills can drive it. Hook must
  // sit above the early returns or React's hook-order check trips when the
  // loading branch unmounts the rest of the tree.
  const [chartWindow, setChartWindow] = useState<WindowId>('1M');

  if (isLoading && !data) return <div className="px-6 py-6 text-sm text-[var(--text-muted)]">Loading…</div>;
  if (error) return <div className="px-6 py-6 text-sm text-red-500">Error: {(error as Error).message}</div>;
  if (!data)
    return (
      <div className="px-6 py-6 text-sm text-[var(--text-muted)]">
        Not in v0 seed list. <Link href="/tokens" className="text-[var(--accent)]">Back to tokens.</Link>
      </div>
    );

  const { summary, priceSeries, benchmarkSeries, topHolders, markets, recentSwaps, range24h } = data;

  return (
    <div className="px-4 sm:px-6 py-6 max-w-[1280px] mx-auto space-y-4">
      <div>
        <Link href="/tokens" className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]">← Tokens</Link>
        <div className="mt-2 flex items-center gap-3 flex-wrap">
          <TokenIcon
            symbol={summary.symbol}
            slug={summary.icon}
            logoUri={summary.logoUri}
            contract={summary.contract}
            chain={summary.chain}
            size={40}
          />
          <h1 className="text-2xl font-semibold tracking-tight" style={{ fontFamily: 'var(--font-display)' }}>
            {summary.name}
            <span className="ml-2 text-[var(--text-muted)]">{summary.symbol}</span>
          </h1>
          <a
            href={`https://etherscan.io/token/${summary.contract}`}
            target="_blank"
            rel="noreferrer"
            title="View on Etherscan"
            className="inline-flex items-center text-[var(--text-faint)] hover:text-[var(--accent)] transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
            </svg>
          </a>
          {summary.priceUsd != null && <FlashingPrice value={summary.priceUsd} />}
          <TradeCTA markets={markets} chain={summary.chain} symbol={summary.symbol} />
          {summary.change24hPct != null && (
            <span
              className={`text-sm tabular-nums ${
                summary.change24hPct >= 0 ? 'text-[var(--green)]' : 'text-red-500'
              }`}
            >
              {summary.change24hPct >= 0 ? '+' : ''}{summary.change24hPct.toFixed(2)}%
            </span>
          )}
          <LiveQuoteIndicator asOf={summary.quoteAsOf} />
        </div>
        {summary.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {summary.tags.map((tag) => (
              <TagBadge key={tag} tag={tag} />
            ))}
          </div>
        )}
        <CrossChainRow alt={summary.altContracts} />

        {summary.warnings.length > 0 && (
          <div className="mt-2 text-xs text-amber-500">⚠ {summary.warnings.join(' / ')}</div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        <div className="space-y-4">
          <PerformancePills
            summary={summary}
            activeWindow={chartWindow}
            onSelect={setChartWindow}
          />
          <Range24h range={range24h} change={summary.change24hPct} />

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Card>
              <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">Market Cap</div>
              <div className="text-base tabular-nums mt-1">
                {summary.marketCapUsd != null ? formatUSD(summary.marketCapUsd) : '—'}
              </div>
            </Card>
            <Card>
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">FDV</span>
                <span
                  className="text-[10px] text-[var(--text-faint)] cursor-help"
                  title="Fully-diluted valuation: total supply × price. Reveals the headline market cap if every token in existence (including locked / vesting / treasury) were circulating today. A large gap between Mcap and FDV signals heavy future dilution."
                >
                  ⓘ
                </span>
              </div>
              <div className="text-base tabular-nums mt-1">
                {summary.fdvUsd != null ? formatUSD(summary.fdvUsd) : '—'}
              </div>
              {summary.fdvUsd != null && summary.marketCapUsd != null && summary.marketCapUsd > 0 && (
                <div className="text-[10px] text-[var(--text-faint)] mt-0.5">
                  {(summary.fdvUsd / summary.marketCapUsd).toFixed(2)}× mcap
                </div>
              )}
            </Card>
            <Card>
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">24h DEX Vol</span>
                <span
                  className="text-[10px] text-[var(--text-faint)] cursor-help"
                  title="Latest-day decentralized-exchange volume aggregated across the Uniswap V2 + V3 mainnet subgraphs (and Uniswap V3 on Arbitrum / Base / Polygon when an alt-chain contract is configured), plus Curve Finance mainnet. CEX volume is intentionally excluded."
                >
                  ⓘ
                </span>
              </div>
              <div className="text-base tabular-nums mt-1">
                {summary.dexVolume24hUsd != null ? formatUSD(summary.dexVolume24hUsd) : '—'}
              </div>
              {/* Turnover = volume / mcap. A token with $1B mcap and $50M
                  daily volume turns over 5%/day — meaningful trading. A
                  token with 0.1% turnover is effectively held, not traded. */}
              {summary.dexVolume24hUsd != null &&
                summary.marketCapUsd != null &&
                summary.marketCapUsd > 0 && (
                  <div className="text-[10px] text-[var(--text-faint)] mt-0.5">
                    {((summary.dexVolume24hUsd / summary.marketCapUsd) * 100).toFixed(2)}% turnover
                  </div>
                )}
            </Card>
            <Card>
              <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">Circulating</div>
              <div className="text-base tabular-nums mt-1">
                {summary.circulatingSupply != null ? formatCompact(Math.round(summary.circulatingSupply)) : '—'}
              </div>
            </Card>
            <Card>
              <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">Holders</div>
              <div className="text-base tabular-nums mt-1">
                {summary.holders != null ? formatNumber(summary.holders) : '—'}
              </div>
            </Card>
            <Card>
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">Top 10 EOA</span>
                <span
                  className="text-[10px] text-[var(--text-faint)] cursor-help"
                  title="Share of circulating supply held by the 10 largest externally-owned accounts. Smart contract holders (bridges, staking, LP pools, vesting) are split out as a secondary line. Contract status comes from on-chain eth_getCode."
                >
                  ⓘ
                </span>
              </div>
              <div
                className={`text-base tabular-nums mt-1 ${
                  summary.top10EoaShare == null
                    ? ''
                    : summary.top10EoaShare >= 0.6
                      ? 'text-red-500'
                      : summary.top10EoaShare >= 0.3
                        ? 'text-amber-500'
                        : ''
                }`}
              >
                {summary.top10EoaShare != null ? `${(summary.top10EoaShare * 100).toFixed(1)}%` : '—'}
              </div>
              {summary.top10ContractShare != null && summary.top10ContractShare >= 0.001 && (
                <div className="text-[10px] text-[var(--text-faint)] mt-0.5">
                  +{(summary.top10ContractShare * 100).toFixed(1)}% in contracts
                </div>
              )}
            </Card>
          </div>

          <TokenPriceChart
            data={priceSeries}
            benchmark={benchmarkSeries}
            isLoading={isLoading && !data}
            pegged={summary.tags.includes('Stablecoin')}
            windowId={chartWindow}
            onWindowChange={setChartWindow}
          />

          <RecentSwaps swaps={recentSwaps} symbol={summary.symbol} />

          <Markets markets={markets} chain={summary.chain} />
        </div>

        <div className="space-y-4">
          <Info
            contract={summary.contract}
            decimals={summary.decimals}
            totalSupply={summary.totalSupply}
            circulating={summary.circulatingSupply}
            website={summary.website}
            name={summary.name}
          />

          <Card>
            <CardHeader>
              <CardTitle>Top holders</CardTitle>
            </CardHeader>
            <CardContent>
              {topHolders.length === 0 ? (
                <div className="text-xs text-[var(--text-faint)]">No holder data returned.</div>
              ) : (
                <ol className="space-y-2 text-sm">
                  {topHolders.slice(0, 10).map((h, i) => {
                    // Share of circulating supply. The single most decision-
                    // useful number on this list — without it the absolute
                    // amounts are uninterpretable across tokens.
                    const sharePct =
                      summary.circulatingSupply != null && summary.circulatingSupply > 0
                        ? (h.amount / summary.circulatingSupply) * 100
                        : null;
                    return (
                      <li key={h.address} className="flex items-baseline justify-between gap-2">
                        <span className="text-[var(--text-faint)] text-xs tabular-nums w-5 shrink-0">{i + 1}</span>
                        <a
                          href={`https://etherscan.io/address/${h.address}`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-xs text-[var(--text-muted)] hover:text-[var(--accent)] flex-1 truncate"
                        >
                          {shortenAddress(h.address, 5)}
                        </a>
                        {h.isContract === true && (
                          <span
                            className="text-[9px] uppercase tracking-wider px-1 py-0.5 rounded bg-[var(--text-faint)]/10 text-[var(--text-faint)]"
                            title="Address is a smart contract (bridge, staking module, LP pool, vesting, etc.)"
                          >
                            contract
                          </span>
                        )}
                        {sharePct != null && (
                          <span className="tabular-nums text-xs text-[var(--text)]">
                            {sharePct >= 0.01 ? sharePct.toFixed(2) : sharePct.toFixed(3)}%
                          </span>
                        )}
                        <span className="tabular-nums text-[10px] text-[var(--text-faint)]">
                          {h.valueUsd != null ? formatUSD(h.valueUsd) : formatNumber(Math.round(h.amount))}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
