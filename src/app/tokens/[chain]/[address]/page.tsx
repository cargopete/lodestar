'use client';

import { use, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { TokenPriceChart, type WindowId } from '@/components/charts/TokenPriceChart';
import { ProtocolIcon, defiLlamaSlugFor } from '@/components/tokens/ProtocolIcon';
import { TagBadge } from '@/components/tokens/TagBadge';
import { TokenIcon } from '@/components/tokens/TokenIcon';
import { ChainIcon } from '@/components/tokens/ChainIcon';
import { useTokenDetail } from '@/hooks/useTokens';
import { useClickTracking, type TradeClickEvent } from '@/hooks/useClickTracking';
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
        className="underline decoration-dotted underline-offset-2 hover:text-[var(--accent-text)]"
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

// Inline help tooltip. Wraps a label with a small ⓘ glyph that shows a
// styled popover on hover — replaces native `title=` attributes, which
// have a 1+ second delay and don't theme to the rest of the surface.
// CSS-only (no JS state); positioned below the trigger and capped width.
function HelpTooltip({
  label,
  children,
  className = '',
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={`group relative inline-flex items-center gap-1 cursor-help ${className}`}>
      {label}
      <span aria-hidden className="text-[var(--text-faint)] text-[10px]">ⓘ</span>
      <span
        role="tooltip"
        className="invisible opacity-0 group-hover:visible group-hover:opacity-100 transition-opacity absolute z-30 top-full left-1/2 -translate-x-1/2 mt-1 w-60 rounded-md bg-[var(--bg-elevated)] border border-[var(--border)] px-3 py-2 text-xs text-[var(--text-muted)] normal-case tracking-normal font-normal text-left pointer-events-none shadow-lg"
      >
        {children}
      </span>
    </span>
  );
}

// Sticky identity strip — pinned to the top of the viewport on scroll so
// the user never loses track of which token they're looking at. Shows
// just the essentials: back link, logo, symbol, live price, 24h change.
// Always visible, slim by design (~32px); the full header below it
// carries the rest of the surface area.
function StickyTokenBar({ summary }: { summary: TokenDetail['summary'] }) {
  return (
    <div className="sticky top-0 z-20 px-4 sm:px-6 py-1.5 bg-[var(--bg)]/85 backdrop-blur border-b border-[var(--border)]">
      <div className="max-w-[1280px] mx-auto flex items-center gap-2.5 text-sm">
        <Link
          href="/tokens"
          className="text-xs text-[var(--text-faint)] hover:text-[var(--text)]"
          title="Back to tokens"
        >
          ←
        </Link>
        <TokenIcon
          symbol={summary.symbol}
          slug={summary.icon}
          logoUri={summary.logoUri}
          contract={summary.contract}
          chain={summary.chain}
          size={20}
        />
        <span className="font-medium">{summary.symbol}</span>
        <span className="text-xs text-[var(--text-faint)] hidden sm:inline">{summary.name}</span>
        {summary.priceUsd != null && (
          <span className="ml-auto tabular-nums text-[var(--text)]">{formatPrice(summary.priceUsd)}</span>
        )}
        {summary.change24hPct != null && (
          <span
            className={`tabular-nums text-xs ${
              summary.change24hPct >= 0 ? 'text-[var(--green)]' : 'text-red-500'
            }`}
          >
            {summary.change24hPct >= 0 ? '+' : ''}{summary.change24hPct.toFixed(2)}%
          </span>
        )}
      </div>
    </div>
  );
}

// Compact info row under the header — replaces the old standalone Info
// card now that the layout is single-column. Surfaces the contract
// address (linked + copyable), token decimals, and the project website
// inline with the rest of the header metadata. Circulating / total
// supply intentionally not duplicated here — they're already visible in
// the stat cards (Mcap is `priceUsd × circulating`, FDV is `× totalSupply`).
function HeaderInfoRow({
  contract,
  decimals,
  website,
  name,
  alt,
}: {
  contract: string;
  decimals: number;
  website: string | null;
  name: string;
  alt: TokenDetail['summary']['altContracts'];
}) {
  let host: string | null = null;
  if (website) {
    try { host = new URL(website).host.replace(/^www\./, ''); } catch {}
  }
  const altEntries = Object.entries(alt).filter(([, addr]) => !!addr) as Array<[string, string]>;
  return (
    <div className="mt-2 flex items-center flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--text-faint)]">
      <span className="inline-flex items-center gap-1.5">
        <span className="uppercase tracking-wider text-[10px]">Contract</span>
        <a
          href={`https://etherscan.io/token/${contract}`}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-[var(--text-muted)] hover:text-[var(--accent-text)]"
        >
          {shortenAddress(contract, 6)}
        </a>
        <CopyButton text={contract} />
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="uppercase tracking-wider text-[10px]">Decimals</span>
        <span className="tabular-nums text-[var(--text-muted)]">{decimals}</span>
      </span>
      {altEntries.length > 0 && (
        <span className="inline-flex items-center gap-1.5">
          <span className="uppercase tracking-wider text-[10px]">Also on</span>
          {altEntries.map(([chain, addr]) => {
            const ex = EXPLORERS[chain];
            if (!ex) return null;
            return (
              <a
                key={chain}
                href={`${ex.tx}${addr}`}
                target="_blank"
                rel="noreferrer"
                title={`${ex.name}: ${addr}`}
                className="inline-flex items-center px-1.5 py-0 rounded border border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent-text)] transition-colors"
              >
                {ex.name}
              </a>
            );
          })}
        </span>
      )}
      {website && (
        <a
          href={website}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[var(--text-muted)] hover:text-[var(--accent-text)]"
        >
          <span>Visit {name}</span>
          {host && <span className="text-[var(--text-faint)]">· {host}</span>}
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
          </svg>
        </a>
      )}
    </div>
  );
}

// Anchor-chip strip that doubles as a quick TOC and a feature index.
// Renders a chip per section actually present on this token's detail
// page, each scrolling smoothly to a `<section id>` further down.
// Sections that aren't applicable (e.g. no Hyperliquid market) drop out
// — the chip itself signals which protocols/venues this token touches.
function SectionNav({ data }: { data: TokenDetail }) {
  type Chip = { id: string; label: string; meta?: string };
  const chips: Chip[] = [{ id: 'chart', label: 'Chart' }];
  if (data.recentSwaps.length > 0) {
    chips.push({ id: 'swaps', label: 'Swaps', meta: String(data.recentSwaps.length) });
  }
  if (data.markets.length > 0) {
    chips.push({ id: 'markets', label: 'Spot pools', meta: String(data.markets.length) });
  }
  if (data.lending && data.lending.markets.length > 0) {
    const n = data.lending.markets.length;
    chips.push({ id: 'lending', label: 'Aave V3', meta: `${n} ${n === 1 ? 'chain' : 'chains'}` });
  }
  if (data.hyperliquid) {
    chips.push({ id: 'perps', label: 'Hyperliquid', meta: data.hyperliquid.coin });
  }
  if (data.topHolders.length > 0) {
    chips.push({ id: 'holders', label: 'Holders' });
  }
  if (chips.length <= 1) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <a
          key={c.id}
          href={`#${c.id}`}
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)]/40 text-xs text-[var(--text-muted)] hover:border-[var(--accent)] hover:bg-[var(--accent)]/10 hover:text-[var(--text)] transition-colors"
        >
          <span>{c.label}</span>
          {c.meta && (
            <span className="text-[10px] tabular-nums text-[var(--text-faint)]">{c.meta}</span>
          )}
        </a>
      ))}
    </div>
  );
}

// Tiny inline sparkline. SVG-only, no library; maps the input array to a
// polyline normalized over the range. Used inside Hyperliquid stat cells.
function Sparkline({
  data,
  width = 60,
  height = 16,
  className = '',
  zeroLine = false,
}: {
  data: number[];
  width?: number;
  height?: number;
  className?: string;
  zeroLine?: boolean;
}) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const dx = width / (data.length - 1);
  const points = data
    .map((v, i) => `${(i * dx).toFixed(1)},${(height - ((v - min) / range) * height).toFixed(1)}`)
    .join(' ');
  // When `zeroLine` is true, draw a dashed midline for series that
  // straddle zero (funding rates, where positive vs negative is the
  // bullish/bearish signal).
  const zeroY = min < 0 && max > 0 ? height - ((0 - min) / range) * height : null;
  return (
    <svg width={width} height={height} className={className} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      {zeroLine && zeroY != null && (
        <line x1={0} x2={width} y1={zeroY} y2={zeroY} stroke="currentColor" strokeWidth={0.5} strokeDasharray="2 2" opacity={0.4} />
      )}
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth={1.2} />
    </svg>
  );
}

// Hyperliquid perps card. Renders open interest, funding, 24h volume,
// and 24h liquidation activity for tokens with a corresponding HL perp
// market (BTC, ETH, SOL, LINK, AAVE, UNI, …). Returns null otherwise.
function HyperliquidCard({
  hyperliquid,
  summary,
}: {
  hyperliquid: TokenDetail['hyperliquid'];
  summary: TokenDetail['summary'];
}) {
  if (!hyperliquid) return null;
  const symbol = summary.symbol;
  const fundingPct = hyperliquid.fundingAnnualized * 100;
  const fundingClass =
    Math.abs(fundingPct) < 0.5
      ? 'text-[var(--text-muted)]'
      : fundingPct > 0
        ? 'text-[var(--green)]'
        : 'text-red-500';
  const liq = hyperliquid.liquidations24h;
  // Long/short bar fill ratio. The bar is rendered (further down) only
  // when total notional > 0, and the proportional split fills the full
  // bar — a perfectly balanced day shows half-red / half-green, not an
  // empty track. Days with zero liquidations omit the strip entirely.
  const liqTotal = liq?.totalNotionalUsd ?? 0;
  const longPct = liq && liqTotal > 0 ? (liq.longNotionalUsd / liqTotal) * 100 : 0;
  // OI 24h delta — color the subline by sign so the eye picks up
  // accumulation vs unwinding without reading the number.
  const oiChange = hyperliquid.openInterestChange24h;
  const oiChangeClass =
    oiChange == null
      ? 'text-[var(--text-faint)]'
      : oiChange > 0.001
        ? 'text-[var(--green)]'
        : oiChange < -0.001
          ? 'text-red-500'
          : 'text-[var(--text-faint)]';
  // Trader-positioning split. Counts (number of accounts on each side)
  // are a sentiment proxy distinct from notional balance — useful when
  // a few whales tilt the dollars but most traders sit the other way.
  const pos = hyperliquid.positioning;
  const posTotal = pos ? pos.longCount + pos.shortCount : 0;
  const longCountPct = pos && posTotal > 0 ? (pos.longCount / posTotal) * 100 : 0;
  // Volume buy/sell split — surfaces directional flow that's already in
  // the snapshot but wasn't being exposed.
  const volBuy = hyperliquid.volume24hBuyUsd;
  const volSell = hyperliquid.volume24hSellUsd;
  // Perp 24h price change — colored signed pill next to the title.
  const perpChange = hyperliquid.priceChange24h * 100;
  const perpChangeClass =
    perpChange > 0.05 ? 'text-[var(--green)]' : perpChange < -0.05 ? 'text-red-500' : 'text-[var(--text-muted)]';
  // Perp-vs-spot premium / discount. Compares the HL mark price to our
  // canonical spot. Larger magnitudes signal aggressive directional
  // pressure on the venue (longs lifting offers / shorts hitting bids).
  // For HL's k-prefixed memes (kPEPE, kSHIB, kFLOKI), the perp's mark
  // price is quoted per 1000 underlying tokens; scale the spot
  // reference up by 1000 so the comparison is apples-to-apples.
  const kContract = hyperliquid.coin.startsWith('k');
  const spotRef =
    summary.priceUsd != null && summary.priceUsd > 0
      ? summary.priceUsd * (kContract ? 1000 : 1)
      : null;
  const premium =
    spotRef != null && spotRef > 0 ? (hyperliquid.priceUsd - spotRef) / spotRef : null;
  const premiumPct = premium != null ? premium * 100 : null;
  // Regime read — a one-line synthesis above the stat grid that does
  // the interpretation a trader would otherwise have to do by scanning
  // four cells. Keeps the card oriented around "what's the signal" not
  // "here's a bunch of inventory."
  const regimeParts: string[] = [];
  if (hyperliquid.fundingAtBaseline) {
    regimeParts.push('Funding at HL baseline (no skew)');
  } else if (Math.abs(hyperliquid.fundingAnnualized) >= 0.30) {
    regimeParts.push(
      `${hyperliquid.fundingAnnualized > 0 ? 'Heavy long-pay' : 'Heavy short-pay'} funding`
    );
  } else if (Math.abs(hyperliquid.fundingAnnualized) >= 0.15) {
    regimeParts.push(
      `${hyperliquid.fundingAnnualized > 0 ? 'Long-biased' : 'Short-biased'} funding`
    );
  }
  if (oiChange != null) {
    if (oiChange >= 0.05) regimeParts.push(`OI accumulating (+${(oiChange * 100).toFixed(1)}% 24h)`);
    else if (oiChange <= -0.05) regimeParts.push(`OI unwinding (${(oiChange * 100).toFixed(1)}% 24h)`);
  }
  if (premiumPct != null && Math.abs(premiumPct) >= 0.20) {
    regimeParts.push(`perp ${premiumPct >= 0 ? 'premium' : 'discount'} ${premiumPct >= 0 ? '+' : ''}${premiumPct.toFixed(2)}% vs spot`);
  }
  // Trader positioning — single-color dominance gauge instead of a
  // long/short split. The split-color version conflicted with the
  // liquidation row, where opposite colors mean opposite things; a
  // one-sided fill against a midline avoids that visual collision.
  // longCountPct ∈ [0,100] above; we render a 50% midline as the
  // "neutral" reference and fill from 50% out toward the dominant side.
  const dominantSide: 'long' | 'short' = longCountPct >= 50 ? 'long' : 'short';
  const dominantPct = dominantSide === 'long' ? longCountPct : 100 - longCountPct;
  const fundingPersistent = hyperliquid.fundingHistory24h.length >= 6;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3 flex-wrap">
          <TokenIcon
            symbol={summary.symbol}
            slug={summary.icon}
            logoUri={summary.logoUri}
            contract={summary.contract}
            chain={summary.chain}
            size={24}
          />
          <CardTitle>{symbol} perps on Hyperliquid</CardTitle>
          <span
            className={`tabular-nums text-sm ${perpChangeClass}`}
            title="24h price change on the Hyperliquid perp itself, separate from the spot price shown in the page header."
          >
            {perpChange >= 0 ? '+' : ''}{perpChange.toFixed(2)}%
          </span>
          <a
            href={hyperliquid.marketUrl}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--accent-text)] whitespace-nowrap"
          >
            <ProtocolIcon slug="hyperliquid" size={18} />
            Open {hyperliquid.coin} market
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
            </svg>
          </a>
        </div>
        {regimeParts.length > 0 && (
          <p className="mt-1 text-xs text-[var(--text-muted)] leading-snug">
            <span className="text-[var(--text-faint)]">Regime: </span>
            {regimeParts.join(' · ')}
          </p>
        )}
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
              <HelpTooltip label="Open Interest">
                Total notional value of open perpetual contracts on Hyperliquid for this asset. A proxy for trader exposure / leverage in the venue. The line below shows 24h delta + a sparkline of hourly OI.
              </HelpTooltip>
            </div>
            <div className="tabular-nums mt-0.5">{formatUSD(hyperliquid.openInterestUsd)}</div>
            <div className="text-[10px] text-[var(--text-faint)] tabular-nums mt-0.5">
              {formatNumber(Math.round(hyperliquid.openInterestTokens))} {hyperliquid.coin}
            </div>
            {oiChange != null && (
              <div className={`flex items-center gap-1.5 mt-0.5 ${oiChangeClass}`}>
                <span className="text-[10px] tabular-nums">
                  {oiChange >= 0 ? '+' : ''}{(oiChange * 100).toFixed(2)}% (24h)
                </span>
                {hyperliquid.openInterestHistory24h.length >= 2 && (
                  <Sparkline data={hyperliquid.openInterestHistory24h} width={48} height={12} />
                )}
              </div>
            )}
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">24h Volume</div>
            <div className="tabular-nums mt-0.5">{formatUSD(hyperliquid.volume24hUsd)}</div>
            {(volBuy > 0 || volSell > 0) && (
              <div className="text-[10px] text-[var(--text-faint)] tabular-nums mt-0.5">
                <span className="text-[var(--green)]">B {formatUSD(volBuy)}</span>
                {' · '}
                <span className="text-red-500">S {formatUSD(volSell)}</span>
              </div>
            )}
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
              <HelpTooltip label="Funding (ann.)">
                Annualized funding rate (hourly funding × 24 × 365). Positive = longs pay shorts (long-biased venue). Negative = shorts pay longs. The sparkline below shows the last 24h of hourly rates with a dashed midline at zero. &quot;At floor&quot; means HL&apos;s per-asset baseline; not a directional signal.
              </HelpTooltip>
            </div>
            <div className={`tabular-nums mt-0.5 ${fundingClass}`}>
              {fundingPct >= 0 ? '+' : ''}{fundingPct.toFixed(2)}%
            </div>
            {fundingPersistent && (
              <div className={`flex items-center gap-1.5 mt-0.5 ${fundingClass}`}>
                <Sparkline data={hyperliquid.fundingHistory24h} width={56} height={14} zeroLine />
                {hyperliquid.fundingAtBaseline && (
                  <span className="text-[10px] text-[var(--text-faint)]">at floor</span>
                )}
              </div>
            )}
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
              <HelpTooltip label="Liqs (UTC day)">
                Notional USD value of liquidation events accumulated so far in the current UTC day, summed across long and short closeouts. Resets at 00:00 UTC. The bar below splits long vs short notional.
              </HelpTooltip>
            </div>
            <div className="tabular-nums mt-0.5">{liq ? formatUSD(liq.totalNotionalUsd) : '—'}</div>
            {liq && (
              <div className="text-[10px] text-[var(--text-faint)] tabular-nums mt-0.5">
                {liq.events} {liq.events === 1 ? 'event' : 'events'} · {liq.uniqueUsers} users
              </div>
            )}
          </div>
        </div>
        {pos && posTotal > 0 && (
          <div className="mt-3 space-y-1">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-[var(--text-muted)]">
                Longs · {formatNumber(pos.longCount)} ({longCountPct.toFixed(0)}%)
              </span>
              <span
                className="text-[var(--text-faint)]"
                title="Open positions right now on this market, by account count. Useful as a sentiment proxy distinct from the notional dollar split."
              >
                Trader positioning · {dominantPct.toFixed(0)}% {dominantSide}
              </span>
              <span className="text-[var(--text-muted)]">
                ({(100 - longCountPct).toFixed(0)}%) Shorts · {formatNumber(pos.shortCount)}
              </span>
            </div>
            {/* Single-color dominance gauge with a midline marker. The
               left/right colors that previously matched the liquidations
               row caused a visual collision; this version reads as
               "how far from neutral" without competing with the bar
               below it. Fills outward from the 50% midline toward the
               dominant side. */}
            <div className="relative h-1.5 rounded-full bg-[var(--text-faint)]/15 overflow-hidden">
              <div
                className="absolute top-0 bottom-0 bg-[var(--accent)]/60"
                style={
                  dominantSide === 'long'
                    ? { left: '50%', width: `${(longCountPct - 50).toFixed(2)}%` }
                    : { right: '50%', width: `${(50 - longCountPct).toFixed(2)}%` }
                }
              />
              <div
                className="absolute top-0 bottom-0 w-px bg-[var(--text-faint)]/40"
                style={{ left: '50%' }}
              />
            </div>
          </div>
        )}
        {liq && liqTotal > 0 && (
          <div className="mt-3 space-y-1">
            <div className="flex items-center justify-between text-[10px] text-[var(--text-faint)]">
              <span>Longs liquidated · {formatUSD(liq.longNotionalUsd)}</span>
              <span>Shorts liquidated · {formatUSD(liq.shortNotionalUsd)}</span>
            </div>
            <div className="h-1.5 rounded-full bg-[var(--text-faint)]/15 overflow-hidden flex">
              <div className="h-full bg-red-500/70" style={{ width: `${longPct.toFixed(2)}%` }} />
              <div className="h-full bg-[var(--green)]/70" style={{ width: `${(100 - longPct).toFixed(2)}%` }} />
            </div>
          </div>
        )}
        {hyperliquid.largestLiquidation24h && (
          <div className="mt-3 text-[11px] text-[var(--text-muted)]">
            Largest liquidation today:{' '}
            <span className={hyperliquid.largestLiquidation24h.side === 'long' ? 'text-red-500' : 'text-[var(--green)]'}>
              {formatUSD(hyperliquid.largestLiquidation24h.notionalUsd)} {hyperliquid.largestLiquidation24h.side}
            </span>{' '}
            wiped ·{' '}
            <a
              href={`https://app.hyperliquid.xyz/explorer/address/${hyperliquid.largestLiquidation24h.user}`}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-[10px] hover:text-[var(--accent-text)]"
            >
              {shortenAddress(hyperliquid.largestLiquidation24h.user, 5)}
            </a>
          </div>
        )}
        <div className="mt-3 pt-2 border-t border-[var(--border)]/50 text-[10px] text-[var(--text-faint)] flex flex-wrap gap-x-3 gap-y-0.5">
          <span>
            Mark{' '}
            <span className="text-[var(--text-muted)] tabular-nums">{formatPrice(hyperliquid.priceUsd)}</span>
            {kContract && <span className="text-[var(--text-faint)]"> per 1k {summary.symbol}</span>}
          </span>
          {hyperliquid.priceLow24h != null && hyperliquid.priceHigh24h != null && (
            <span>
              24h range{' '}
              <span className="text-[var(--text-muted)] tabular-nums">
                {formatPrice(hyperliquid.priceLow24h)} – {formatPrice(hyperliquid.priceHigh24h)}
              </span>
            </span>
          )}
          {premiumPct != null && (
            <span title="Mark price on the Hyperliquid perp vs the Uniswap V3 mainnet spot reference.">
              Perp vs spot{' '}
              <span
                className={
                  Math.abs(premiumPct) < 0.05
                    ? 'text-[var(--text-muted)]'
                    : premiumPct > 0
                      ? 'text-[var(--green)]'
                      : 'text-red-500'
                }
              >
                {Math.abs(premiumPct) < 0.05 ? '~0.00%' : `${premiumPct >= 0 ? '+' : ''}${premiumPct.toFixed(2)}%`}
              </span>
            </span>
          )}
          {hyperliquid.trades24h > 0 && (
            <span>
              24h activity{' '}
              <span className="text-[var(--text-muted)] tabular-nums">
                {formatNumber(hyperliquid.trades24h)} trades · {formatNumber(hyperliquid.uniqueUsers24h)} traders
              </span>
            </span>
          )}
          <span className="ml-auto">via Pinax Token API</span>
        </div>
      </CardContent>
    </Card>
  );
}

// Lending-market card. Surfaces total supplied / borrowed / utilization
// and current rates for tokens listed in supported lending protocols
// (Aave V3 across Ethereum + Arbitrum + Base + Polygon + Optimism).
// Renders nothing when the token isn't a lending-market asset — that's
// most of the catalog.
function LendingCard({
  lending,
  summary,
}: {
  lending: TokenDetail['lending'];
  summary: TokenDetail['summary'];
}) {
  if (!lending || lending.markets.length === 0) return null;
  const symbol = summary.symbol;
  // Map LendingChain → human-readable label. Local helper, kept close
  // to the only consumer.
  const chainLabel: Record<typeof lending.markets[number]['chain'], string> = {
    mainnet: 'Ethereum',
    arbitrum: 'Arbitrum',
    base: 'Base',
    polygon: 'Polygon',
    optimism: 'Optimism',
  };
  const aggSuppliedUsd = lending.totalSuppliedUsd;
  const aggBorrowedUsd = lending.totalBorrowedUsd;
  const aggAvailableUsd = lending.availableLiquidityUsd;
  const aggUtilPct = lending.utilization != null ? lending.utilization * 100 : null;
  // Best-of teaser: the row a user is most likely to act on. "Best supply"
  // = chain paying the highest yield to depositors; "cheapest borrow" =
  // chain charging the lowest rate to borrowers. Constrained to active
  // markets so a frozen / supply-only deployment can't headline a stat.
  const eligible = lending.markets.filter((m) => m.isActive && !m.isFrozen);
  const bestSupply = eligible.reduce<typeof lending.markets[number] | null>(
    (best, m) => (best == null || m.supplyApr > best.supplyApr ? m : best),
    null
  );
  const cheapestBorrow = eligible
    .filter((m) => m.borrowingEnabled)
    .reduce<typeof lending.markets[number] | null>(
      (best, m) => (best == null || m.variableBorrowApr < best.variableBorrowApr ? m : best),
      null
    );
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3 flex-wrap">
          <TokenIcon
            symbol={summary.symbol}
            slug={summary.icon}
            logoUri={summary.logoUri}
            contract={summary.contract}
            chain={summary.chain}
            size={24}
          />
          <CardTitle>{symbol} on Aave V3 Core</CardTitle>
          <span className="ml-auto text-[10px] text-[var(--text-faint)]">via The Graph subgraphs</span>
        </div>
        <p className="mt-1 text-xs text-[var(--text-muted)] leading-snug">
          You can <span className="text-[var(--green)]">supply {symbol}</span> to earn yield, or post it as
          collateral to <span className="text-[var(--text)]">borrow</span> other assets. Each row below is the
          same {symbol} market on a different chain. Aave&apos;s deployments price risk independently, so APRs vary.
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {lending.markets.length > 1 && (
            // Aggregate strip — only meaningful when there's more than one
            // deployment to roll up. Sits at the top so the headline
            // multi-chain numbers read first.
            <div className="rounded-md bg-[var(--text-faint)]/5 px-3 py-2 space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">All chains combined</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">Supplied</div>
                  <div className="tabular-nums mt-0.5">{aggSuppliedUsd != null ? formatUSD(aggSuppliedUsd) : '—'}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">Borrowed</div>
                  <div className="tabular-nums mt-0.5">{aggBorrowedUsd != null ? formatUSD(aggBorrowedUsd) : '—'}</div>
                </div>
                <div>
                  <div
                    className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] cursor-help"
                    title="Total liquidity available to borrow right now across every Aave V3 deployment listing this asset."
                  >
                    Available
                  </div>
                  <div className="tabular-nums mt-0.5">{aggAvailableUsd != null ? formatUSD(aggAvailableUsd) : '—'}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">Utilization</div>
                  <div className="tabular-nums mt-0.5">{aggUtilPct != null ? `${aggUtilPct.toFixed(1)}%` : '—'}</div>
                </div>
              </div>
            </div>
          )}
          {(bestSupply || cheapestBorrow) && (
            // "Best-of" teaser — the row a user with this token is most
            // likely to act on. Calls out the highest-yield supply venue
            // and the cheapest borrow venue so they don't have to scan the
            // table for the same conclusion.
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              {bestSupply && (
                <div className="rounded-md border border-[var(--border)] px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
                    Best Supply APR
                  </div>
                  <div className="mt-0.5 flex items-baseline gap-2">
                    <span className="tabular-nums text-base text-[var(--green)]">{(bestSupply.supplyApr * 100).toFixed(2)}%</span>
                    <span className="inline-flex items-center gap-1.5 text-[var(--text-muted)]">
                      on <ChainIcon chain={bestSupply.chain} size={18} /> {chainLabel[bestSupply.chain]}
                    </span>
                  </div>
                </div>
              )}
              {cheapestBorrow && (
                <div className="rounded-md border border-[var(--border)] px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
                    Cheapest Borrow APR
                  </div>
                  <div className="mt-0.5 flex items-baseline gap-2">
                    <span className="tabular-nums text-base text-[var(--text)]">{(cheapestBorrow.variableBorrowApr * 100).toFixed(2)}%</span>
                    <span className="inline-flex items-center gap-1.5 text-[var(--text-muted)]">
                      on <ChainIcon chain={cheapestBorrow.chain} size={18} /> {chainLabel[cheapestBorrow.chain]}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
          {/* Per-chain table — replaces the previous stack of mini-cards
             with utilization bars, which read like a project timeline. A
             table is visually honest about "this is rate-and-balance data
             across deployments" rather than implying sequential progress. */}
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
                <tr className="border-b border-[var(--border)]">
                  <th className="text-left font-medium py-1.5 pl-4 sm:pl-2">Chain</th>
                  <th className="text-right font-medium py-1.5 px-2">
                    <HelpTooltip
                      label="Supplied"
                      className="justify-end"
                    >
                      Total {symbol} (in USD) that lenders have deposited into this pool. The &quot;of cap&quot; line below is how full it is against Aave&apos;s per-asset supply ceiling.
                    </HelpTooltip>
                  </th>
                  <th className="text-right font-medium py-1.5 px-2">
                    <HelpTooltip
                      label="Borrowed"
                      className="justify-end"
                    >
                      Total {symbol} (in USD) currently being borrowed against this pool. The &quot;of cap&quot; line shows how close it is to the protocol&apos;s borrow ceiling.
                    </HelpTooltip>
                  </th>
                  <th className="text-right font-medium py-1.5 px-2">
                    <HelpTooltip
                      label="To borrow"
                      className="justify-end"
                    >
                      USD liquidity that&apos;s actually borrowable from the pool right now (Supplied minus Borrowed, minus any reserves the protocol withholds).
                    </HelpTooltip>
                  </th>
                  <th className="text-right font-medium py-1.5 px-2">
                    <HelpTooltip
                      label="Util"
                      className="justify-end"
                    >
                      Utilization = Borrowed ÷ Supplied. Higher means borrowers have absorbed most of the supply, which pushes both APRs up. Color: amber ≥80%, red ≥95%.
                    </HelpTooltip>
                  </th>
                  <th className="text-right font-medium py-1.5 px-2">
                    <HelpTooltip
                      label="Supply APR"
                      className="justify-end"
                    >
                      Annualized yield <span className="text-[var(--green)]">paid to you</span> when you supply {symbol} to this pool. Moves per-block as utilization shifts.
                    </HelpTooltip>
                  </th>
                  <th className="text-right font-medium py-1.5 px-2">
                    <HelpTooltip
                      label="Borrow APR"
                      className="justify-end"
                    >
                      Annualized rate <span className="text-[var(--text)]">you pay</span> if you borrow {symbol} (variable rate). Always higher than Supply APR, since Aave keeps the spread.
                    </HelpTooltip>
                  </th>
                  <th className="text-right font-medium py-1.5 px-2">
                    <HelpTooltip
                      label="Liq. LTV"
                      className="justify-end"
                    >
                      Liquidation threshold. If you post {symbol} as collateral, your loan can be liquidated once the loan-to-value crosses this percentage. Higher = more borrowing room.
                    </HelpTooltip>
                  </th>
                  <th className="py-1.5 pr-4 sm:pr-2"></th>
                </tr>
              </thead>
              <tbody>
                {lending.markets.map((m) => {
                  const utilPct = m.utilization * 100;
                  const supplyAprPct = m.supplyApr * 100;
                  const borrowAprPct = m.variableBorrowApr * 100;
                  const supplyCapPct =
                    m.supplyCapTokens != null && m.supplyCapTokens > 0
                      ? (m.totalSuppliedTokens / m.supplyCapTokens) * 100
                      : null;
                  const borrowCapPct =
                    m.borrowCapTokens != null && m.borrowCapTokens > 0
                      ? (m.totalBorrowedTokens / m.borrowCapTokens) * 100
                      : null;
                  // Cap subline color: amber ≥80%, red ≥95%, "at cap" once
                  // the actual balance has exceeded the cap (Aave's wind-
                  // down pattern, e.g. Optimism USDC.e with borrowCap=1).
                  const capColor = (pct: number) =>
                    pct >= 95 ? 'text-red-500' : pct >= 80 ? 'text-amber-500' : 'text-[var(--text-faint)]';
                  // Utilization color encodes the same "load" signal the
                  // old bar carried, but inline with the number — frees the
                  // row from a separate visual element.
                  const utilColor =
                    utilPct >= 95 ? 'text-red-500' : utilPct >= 80 ? 'text-amber-500' : 'text-[var(--text-muted)]';
                  const statusBadge = m.isFrozen
                    ? 'frozen'
                    : !m.isActive
                      ? 'inactive'
                      : !m.borrowingEnabled
                        ? 'supply only'
                        : null;
                  return (
                    <tr key={`${m.protocol}-${m.chain}`} className="border-b border-[var(--border)]/50 last:border-0 hover:bg-[var(--text-faint)]/5">
                      <td className="py-2 pl-4 sm:pl-2 align-top">
                        <div className="inline-flex items-center gap-2 text-[var(--text)]">
                          <ChainIcon chain={m.chain} size={22} />
                          {chainLabel[m.chain]}
                        </div>
                        {statusBadge && (
                          <div className="text-[10px] text-[var(--text-faint)]">{statusBadge}</div>
                        )}
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums align-top">
                        <div>{m.totalSuppliedUsd != null ? formatUSD(m.totalSuppliedUsd) : '—'}</div>
                        {supplyCapPct != null && (
                          <div className={`text-[10px] ${capColor(supplyCapPct)}`}>
                            {supplyCapPct >= 100 ? 'at cap' : `${supplyCapPct.toFixed(0)}% of cap`}
                          </div>
                        )}
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums align-top">
                        <div>{m.totalBorrowedUsd != null ? formatUSD(m.totalBorrowedUsd) : '—'}</div>
                        {borrowCapPct != null && (
                          <div className={`text-[10px] ${capColor(borrowCapPct)}`}>
                            {borrowCapPct >= 100 ? 'at cap' : `${borrowCapPct.toFixed(0)}% of cap`}
                          </div>
                        )}
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums align-top">
                        {m.availableLiquidityUsd != null ? formatUSD(m.availableLiquidityUsd) : '—'}
                      </td>
                      <td className={`py-2 px-2 text-right tabular-nums align-top ${utilColor}`}>{utilPct.toFixed(1)}%</td>
                      <td className="py-2 px-2 text-right tabular-nums align-top text-[var(--green)]">{supplyAprPct.toFixed(2)}%</td>
                      <td className="py-2 px-2 text-right tabular-nums align-top">{borrowAprPct.toFixed(2)}%</td>
                      <td className="py-2 px-2 text-right tabular-nums align-top">
                        {m.liquidationThresholdBps != null ? `${(m.liquidationThresholdBps / 100).toFixed(0)}%` : '—'}
                      </td>
                      <td className="py-2 pr-4 sm:pr-2 text-right align-top">
                        <a
                          href={m.aaveMarketUrl}
                          target="_blank"
                          rel="noreferrer"
                          title={`Open the ${symbol} reserve on Aave V3 (${chainLabel[m.chain]})`}
                          className="inline-flex items-center gap-1.5 text-[var(--text-muted)] hover:text-[var(--accent-text)] whitespace-nowrap"
                        >
                          <ProtocolIcon slug="aave" size={18} />
                          Open in Aave
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                          </svg>
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="text-[10px] text-[var(--text-faint)] pt-1">
            {symbol} is listed in {lending.markets.length} {lending.markets.length === 1 ? 'Aave V3 Core deployment' : 'Aave V3 Core deployments'}. Rates and balances reflect the latest block indexed by the source subgraph; USD figures use the live spot price from the detail header for consistent cross-chain aggregation.
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Markets({
  markets,
  chain,
  summary,
  onTradeClick,
}: {
  markets: TokenDetail['markets'];
  chain: string;
  summary: TokenDetail['summary'];
  onTradeClick?: (e: TradeClickEvent) => void;
}) {
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
          <div className="flex items-center gap-3">
            <TokenIcon
              symbol={summary.symbol}
              slug={summary.icon}
              logoUri={summary.logoUri}
              contract={summary.contract}
              chain={summary.chain}
              size={24}
            />
            <CardTitle>{summary.symbol} spot pools</CardTitle>
          </div>
          <span className="text-[11px] text-[var(--text-faint)] flex items-center gap-2 flex-wrap">
            <span>{markets.length} pools · click to trade · <span className="italic">clicks tracked anonymously</span></span>
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
          <table className="w-full text-sm table-fixed">
            <colgroup>
              {/* Fixed-width layout so columns spread across the card's
                  full width instead of all bunching to the left. The
                  weighting roughly matches each column's likely content
                  length: Venue/Pair carry icons + label, Fee is a tiny
                  number, the USD columns are similar, Trade gets a
                  generous slice so its left-aligned icons sit clearly
                  apart from the numeric columns. */}
              <col className="w-[18%]" />
              <col className="w-[18%]" />
              <col className="w-[8%]" />
              <col className="w-[14%]" />
              <col className="w-[14%]" />
              <col className="w-[28%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="py-2 text-left text-[11px] font-medium text-[var(--text-faint)]">Venue</th>
                <th className="py-2 text-left text-[11px] font-medium text-[var(--text-faint)]">Pair</th>
                <th className="py-2 text-right text-[11px] font-medium text-[var(--text-faint)]">Fee</th>
                <th className="py-2 text-right text-[11px] font-medium text-[var(--text-faint)]">TVL</th>
                <th className="py-2 text-right text-[11px] font-medium text-[var(--text-faint)]">24h Vol</th>
                <th className="py-2 pl-8 text-left text-[11px] font-medium text-[var(--text-faint)]">Trade</th>
              </tr>
            </thead>
            <tbody>
              {markets.map((m) => {
                const trade = getTradeUrl(m.protocol, chain, m.baseContract, m.quoteContract);
                const rowProps = trade
                  ? {
                      onClick: () => {
                        onTradeClick?.({
                          event_type: 'trade_click',
                          token_address: m.baseContract,
                          token_symbol: m.baseSymbol,
                          venue: trade.venue,
                          pool_address: m.pool,
                          chain,
                          destination_url: trade.url,
                        });
                        window.open(trade.url, '_blank', 'noopener,noreferrer');
                      },
                      className: 'border-b border-[var(--border)]/40 cursor-pointer hover:bg-[var(--bg-elevated)]/50 transition-colors',
                    }
                  : { className: 'border-b border-[var(--border)]/40' };
                return (
                  <tr key={m.pool} {...rowProps}>
                    <td className="py-2">
                      <span className="inline-flex items-center gap-2 capitalize">
                        <ProtocolIcon slug={defiLlamaSlugFor(m.protocol)} size={18} />
                        {m.protocol.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="py-2">
                      <span className="inline-flex items-center gap-1.5">
                        <TokenIcon symbol={m.baseSymbol} contract={m.baseContract} chain={summary.chain} size={18} />
                        <span className="font-medium">{m.baseSymbol}</span>
                        <span className="text-[var(--text-faint)]">/</span>
                        <TokenIcon symbol={m.quoteSymbol} contract={m.quoteContract} chain={summary.chain} size={18} />
                        <span className="text-[var(--text-faint)]">{m.quoteSymbol}</span>
                      </span>
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
                    <td className="py-2 pl-8 text-left">
                      {trade ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-[var(--accent-text)] hover:underline">
                          <ProtocolIcon slug={defiLlamaSlugFor(m.protocol) ?? defiLlamaSlugFor(trade.venue)} size={18} />
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

function RecentSwaps({
  swaps,
  summary,
}: {
  swaps: TokenDetail['recentSwaps'];
  summary: TokenDetail['summary'];
}) {
  const symbol = summary.symbol;
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
          <div className="flex items-center gap-3">
            <TokenIcon
              symbol={summary.symbol}
              slug={summary.icon}
              logoUri={summary.logoUri}
              contract={summary.contract}
              chain={summary.chain}
              size={24}
            />
            <CardTitle>{symbol} recent swaps</CardTitle>
          </div>
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
          <table className="w-full text-sm table-fixed">
            <colgroup>
              {/* Fixed-width layout so columns spread across the card's
                  full width. Pair gets the biggest share because it
                  carries two icons + symbols + a protocol tag; Tx gets
                  enough room for a fuller-than-6-char hash so the column
                  doesn't read as a stub anchored to the right edge. */}
              <col className="w-[9%]" />
              <col className="w-[7%]" />
              <col className="w-[11%]" />
              <col className="w-[11%]" />
              <col className="w-[11%]" />
              <col className="w-[12%]" />
              <col className="w-[24%]" />
              <col className="w-[15%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="py-2 text-left text-[11px] font-medium text-[var(--text-faint)]">When</th>
                <th className="py-2 text-left text-[11px] font-medium text-[var(--text-faint)]">Side</th>
                <th className="py-2 text-right text-[11px] font-medium text-[var(--text-faint)]">{symbol} amount</th>
                <th className="py-2 text-right text-[11px] font-medium text-[var(--text-faint)]">USD</th>
                <th className="py-2 text-right text-[11px] font-medium text-[var(--text-faint)]">Price</th>
                <th className="py-2 text-left text-[11px] font-medium text-[var(--text-faint)] pl-3">Trader</th>
                <th className="py-2 text-left text-[11px] font-medium text-[var(--text-faint)] pl-3">Pair</th>
                <th className="py-2 pl-3 text-left text-[11px] font-medium text-[var(--text-faint)]">Tx</th>
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
                        className="font-mono text-xs text-[var(--text-muted)] hover:text-[var(--accent-text)]"
                        title={s.trader}
                      >
                        {shortenAddress(s.trader, 4)}
                      </a>
                    ) : (
                      <span className="text-[var(--text-faint)]">—</span>
                    )}
                  </td>
                  <td className="py-2 pl-3 text-xs text-[var(--text-muted)]">
                    <span className="inline-flex items-center gap-1.5">
                      <TokenIcon symbol={summary.symbol} slug={summary.icon} logoUri={summary.logoUri} contract={summary.contract} chain={summary.chain} size={16} />
                      <span>{symbol}</span>
                      <span className="text-[var(--text-faint)]">/</span>
                      <TokenIcon symbol={s.counterpartySymbol} contract={s.counterpartyContract ?? undefined} chain={summary.chain} size={16} />
                      <span>{s.counterpartySymbol}</span>
                      <span className="ml-1 text-[10px] text-[var(--text-faint)] capitalize">{s.protocol.replace(/_/g, ' ')}</span>
                    </span>
                  </td>
                  <td className="py-2 pl-3 text-left">
                    <a
                      href={`https://etherscan.io/tx/${s.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-xs text-[var(--text-muted)] hover:text-[var(--accent-text)]"
                      title={s.txHash}
                    >
                      {shortenAddress(s.txHash, 6)}
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
  onTradeClick,
}: {
  markets: TokenDetail['markets'];
  chain: string;
  symbol: string;
  onTradeClick?: (e: TradeClickEvent) => void;
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
      onClick={() => onTradeClick?.({
        event_type: 'trade_click',
        token_address: top.baseContract,
        token_symbol: symbol,
        venue: trade.venue,
        pool_address: top.pool,
        chain,
        destination_url: trade.url,
      })}
      title={`Swap ${symbol} on ${trade.venue} (top pool by TVL)`}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--accent)]/15 text-[var(--accent-text)] hover:bg-[var(--accent)]/25 transition-colors text-sm font-medium"
    >
      <ProtocolIcon slug={defiLlamaSlugFor(top.protocol) ?? defiLlamaSlugFor(trade.venue)} size={18} />
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

export default function TokenDetailPage({ params }: Props) {
  const { chain, address } = use(params);
  const { data, isLoading, error } = useTokenDetail(chain, address);
  const { track } = useClickTracking();
  // Lifted chart timeframe so the performance pills can drive it. Hook must
  // sit above the early returns or React's hook-order check trips when the
  // loading branch unmounts the rest of the tree.
  const [chartWindow, setChartWindow] = useState<WindowId>('1M');

  if (isLoading && !data) return <div className="px-6 py-6 text-sm text-[var(--text-muted)]">Loading…</div>;
  if (error) return <div className="px-6 py-6 text-sm text-red-500">Error: {(error as Error).message}</div>;
  if (!data)
    return (
      <div className="px-6 py-6 text-sm text-[var(--text-muted)]">
        Not in v0 seed list. <Link href="/tokens" className="text-[var(--accent-text)]">Back to tokens.</Link>
      </div>
    );

  const { summary, priceSeries, benchmarkSeries, topHolders, markets, recentSwaps, range24h, lending, hyperliquid } = data;

  return (
    <>
      <StickyTokenBar summary={summary} />
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
          {summary.tags.length > 0 && (
            // Tags fold inline next to the symbol so they don't sit alone
            // on a near-empty row when a token only has one tag (e.g. LINK
            // → just "Oracle"). Reads as a category subtitle.
            <span className="flex flex-wrap gap-1">
              {summary.tags.map((tag) => (
                <TagBadge key={tag} tag={tag} />
              ))}
            </span>
          )}
          <a
            href={`https://etherscan.io/token/${summary.contract}`}
            target="_blank"
            rel="noreferrer"
            title="View on Etherscan"
            className="inline-flex items-center text-[var(--text-faint)] hover:text-[var(--accent-text)] transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
            </svg>
          </a>
          {summary.priceUsd != null && <FlashingPrice value={summary.priceUsd} />}
          <TradeCTA markets={markets} chain={summary.chain} symbol={summary.symbol} onTradeClick={track} />
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

        <HeaderInfoRow
          contract={summary.contract}
          decimals={summary.decimals}
          website={summary.website}
          name={summary.name}
          alt={summary.altContracts}
        />

        {summary.warnings.length > 0 && (
          <div className="mt-2 text-xs text-amber-500">⚠ {summary.warnings.join(' / ')}</div>
        )}

        <SectionNav data={data} />
      </div>

      <div className="space-y-4">
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
                  title="Latest-day decentralized-exchange volume aggregated across Uniswap V2 + V3 mainnet, Uniswap V3 on Arbitrum / Base / Polygon (when an alt-chain contract is configured), PancakeSwap V3 mainnet, Aerodrome on Base, and Curve Finance mainnet. CEX volume is intentionally excluded."
                >
                  ⓘ
                </span>
              </div>
              <div className="text-base tabular-nums mt-1">
                {summary.dexVolume24hUsd != null ? formatUSD(summary.dexVolume24hUsd) : '—'}
              </div>
              {/* Turnover = volume / mcap. A token with $1B mcap and $50M
                  daily volume turns over 5%/day, meaning meaningful trading. A
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

          <div id="chart" className="scroll-mt-4">
            <TokenPriceChart
              data={priceSeries}
              identity={{
                symbol: summary.symbol,
                icon: summary.icon,
                logoUri: summary.logoUri,
                contract: summary.contract,
                chain: summary.chain,
              }}
              benchmark={benchmarkSeries}
              isLoading={isLoading && !data}
              pegged={summary.tags.includes('Stablecoin')}
              windowId={chartWindow}
              onWindowChange={setChartWindow}
            />
          </div>

          <div id="swaps" className="scroll-mt-4">
            <RecentSwaps swaps={recentSwaps} summary={summary} />
          </div>

          <div id="markets" className="scroll-mt-4">
            <Markets markets={markets} chain={summary.chain} summary={summary} onTradeClick={track} />
          </div>

          <div id="lending" className="scroll-mt-4">
            <LendingCard lending={lending} summary={summary} />
          </div>

          <div id="perps" className="scroll-mt-4">
            <HyperliquidCard hyperliquid={hyperliquid} summary={summary} />
          </div>

          <div id="holders" className="scroll-mt-4">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <TokenIcon
                    symbol={summary.symbol}
                    slug={summary.icon}
                    logoUri={summary.logoUri}
                    contract={summary.contract}
                    chain={summary.chain}
                    size={24}
                  />
                  <CardTitle>{summary.symbol} top holders</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                {topHolders.length === 0 ? (
                  <div className="text-xs text-[var(--text-faint)]">No holder data returned.</div>
                ) : (() => {
                  // Compute each row's share once, then derive the max so the
                  // inline scale-bar normalizes against the largest holder in
                  // this list. Visual signal: how many ×s the #1 holder is
                  // vs. the rest.
                  const slice = topHolders.slice(0, 10);
                  const shares = slice.map((h) =>
                    summary.circulatingSupply != null && summary.circulatingSupply > 0
                      ? (h.amount / summary.circulatingSupply) * 100
                      : null
                  );
                  const maxShare = Math.max(0, ...shares.map((s) => s ?? 0));
                  return (
                    // Two-column wallet list on wide screens (was a single
                    // narrow column when this card lived in a 320px sidebar).
                    <ol className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                      {slice.map((h, i) => {
                        const sharePct = shares[i];
                        const relShare = sharePct != null && maxShare > 0 ? sharePct / maxShare : 0;
                        return (
                          <li
                            key={h.address}
                            className="flex items-center gap-2 py-1 border-b border-[var(--border)]/30 last:border-0"
                          >
                            <span className="text-[var(--text-faint)] text-xs tabular-nums w-5 shrink-0">{i + 1}</span>
                            <a
                              href={`https://etherscan.io/address/${h.address}`}
                              target="_blank"
                              rel="noreferrer"
                              title={h.address}
                              className="font-mono text-xs text-[var(--text-muted)] hover:text-[var(--accent-text)] shrink-0"
                            >
                              {shortenAddress(h.address, 8)}
                            </a>
                            {h.isContract === true && (
                              <span
                                className="text-[9px] uppercase tracking-wider px-1 py-0.5 rounded bg-[var(--text-faint)]/10 text-[var(--text-faint)] shrink-0"
                                title="Address is a smart contract (bridge, staking module, LP pool, vesting, etc.)"
                              >
                                contract
                              </span>
                            )}
                            {/* Inline scale bar — fills proportional to this
                               holder's share vs the largest in the list.
                               Sits in the flexible space between the address
                               and the numerical readout so the visual rank
                               reads at a glance. */}
                            <div className="flex-1 min-w-[40px] h-1 rounded-full bg-[var(--text-faint)]/15 overflow-hidden">
                              <div
                                className={`h-full ${i === 0 ? 'bg-[var(--accent)]' : 'bg-[var(--accent)]/60'}`}
                                style={{ width: `${(relShare * 100).toFixed(2)}%` }}
                              />
                            </div>
                            {sharePct != null && (
                              <span className="tabular-nums text-xs text-[var(--text)] shrink-0 w-12 text-right">
                                {sharePct >= 0.01 ? sharePct.toFixed(2) : sharePct.toFixed(3)}%
                              </span>
                            )}
                            <span className="tabular-nums text-[10px] text-[var(--text-faint)] shrink-0 w-16 text-right">
                              {h.valueUsd != null ? formatUSD(h.valueUsd) : formatNumber(Math.round(h.amount))}
                            </span>
                          </li>
                        );
                      })}
                    </ol>
                  );
                })()}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
