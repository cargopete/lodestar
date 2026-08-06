'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Sparkline } from '@/components/charts/Sparkline';
import { TagBadge } from '@/components/tokens/TagBadge';
import { TokenIcon } from '@/components/tokens/TokenIcon';
import { useTokenDirectory } from '@/hooks/useTokens';
import { formatNumber, formatPrice, formatUSD } from '@/lib/utils';
import type { TokenSummary } from '@/lib/tokens/types';

type SortKey = 'mcap' | 'price' | 'change' | 'change7d' | 'change30d' | 'holders' | 'symbol' | 'concentration' | 'volume' | 'hlOi';
type SortDir = 'asc' | 'desc';


function PctBadge({ value }: { value: number | null }) {
  if (value == null) return <span className="text-[var(--text-faint)]">—</span>;
  const positive = value >= 0;
  const color = positive ? 'text-[var(--green)]' : 'text-red-500';
  const sign = positive ? '+' : '';
  return <span className={color}>{sign}{value.toFixed(2)}%</span>;
}

function WarningPopover({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <span className="relative inline-flex group">
      <span className="text-[10px] text-amber-500 cursor-help select-none">⚠</span>
      <span className="invisible group-hover:visible absolute left-3 top-3 z-30 w-72 rounded border border-[var(--border)] bg-[var(--bg-elevated)] p-2 text-[11px] text-[var(--text-muted)] shadow-lg pointer-events-none">
        <span className="block font-semibold text-amber-500 mb-1">Data warnings</span>
        {warnings.map((w, i) => (
          <span key={i} className="block leading-snug mt-0.5">· {w}</span>
        ))}
      </span>
    </span>
  );
}

const COMPARATORS: Record<SortKey, (a: TokenSummary, b: TokenSummary) => number> = {
  mcap: (a, b) => (b.marketCapUsd ?? 0) - (a.marketCapUsd ?? 0),
  price: (a, b) => (b.priceUsd ?? 0) - (a.priceUsd ?? 0),
  change: (a, b) => (b.change24hPct ?? 0) - (a.change24hPct ?? 0),
  change7d: (a, b) => (b.change7dPct ?? 0) - (a.change7dPct ?? 0),
  change30d: (a, b) => (b.change30dPct ?? 0) - (a.change30dPct ?? 0),
  holders: (a, b) => (b.holders ?? 0) - (a.holders ?? 0),
  concentration: (a, b) => (b.top10Share ?? 0) - (a.top10Share ?? 0),
  volume: (a, b) => (b.dexVolume24hUsd ?? 0) - (a.dexVolume24hUsd ?? 0),
  hlOi: (a, b) => (b.hyperliquidOiUsd ?? 0) - (a.hyperliquidOiUsd ?? 0),
  symbol: (a, b) => a.symbol.localeCompare(b.symbol),
};

function VolumeCell({ total, byVenue }: { total: number | null; byVenue: Record<string, number> }) {
  if (total == null) return <span className="text-[var(--text-faint)]">—</span>;
  const venues = Object.entries(byVenue).sort((a, b) => b[1] - a[1]);
  return (
    <span className="relative inline-flex group">
      <span className="cursor-help underline decoration-dotted decoration-[var(--text-faint)] underline-offset-2">
        {formatUSD(total)}
      </span>
      {venues.length > 0 && (
        <span className="invisible group-hover:visible absolute right-0 top-5 z-30 w-56 rounded border border-[var(--border)] bg-[var(--bg-elevated)] p-2 text-[11px] text-[var(--text-muted)] shadow-lg pointer-events-none text-left">
          <span className="block font-semibold text-[var(--text)] mb-1">Latest-day volume by venue</span>
          {venues.map(([name, v]) => (
            <span key={name} className="flex items-center justify-between gap-2 mt-0.5 tabular-nums">
              <span>{name}</span>
              <span className="text-[var(--text)]">{formatUSD(v)}</span>
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

// Holders cell with a hover popover that surfaces the top-10 EOA
// concentration we used to dedicate a column to. Replaces the standalone
// ConcentrationCell now that we've reclaimed its slot for HL OI.
function HoldersCell({
  count,
  eoaShare,
  contractShare,
}: {
  count: number | null;
  eoaShare: number | null;
  contractShare: number | null;
}) {
  if (count == null) return <span className="text-[var(--text-faint)]">—</span>;
  const hasConcentration = eoaShare != null || contractShare != null;
  const eoaPct = (eoaShare ?? 0) * 100;
  const contractPct = (contractShare ?? 0) * 100;
  const eoaColor =
    eoaPct >= 60 ? 'text-red-500' : eoaPct >= 30 ? 'text-amber-500' : 'text-[var(--text)]';
  return (
    <span className="relative inline-flex group">
      <span className={hasConcentration ? 'cursor-help underline decoration-dotted decoration-[var(--text-faint)] underline-offset-2' : ''}>
        {formatNumber(count)}
      </span>
      {hasConcentration && (
        <span className="invisible group-hover:visible absolute right-0 top-5 z-30 w-56 rounded border border-[var(--border)] bg-[var(--bg-elevated)] p-2 text-[11px] text-[var(--text-muted)] shadow-lg pointer-events-none text-left">
          <span className="block font-semibold text-[var(--text)] mb-1">Top-10 holder concentration</span>
          <span className="flex items-center justify-between gap-2 mt-0.5 tabular-nums">
            <span>EOA share</span>
            <span className={eoaColor}>{eoaPct.toFixed(1)}%</span>
          </span>
          {contractPct >= 0.01 && (
            <span className="flex items-center justify-between gap-2 mt-0.5 tabular-nums">
              <span>Contract share</span>
              <span className="text-[var(--text)]">{contractPct.toFixed(1)}%</span>
            </span>
          )}
          <span className="block mt-2 text-[10px] text-[var(--text-faint)]">
            Higher EOA % means a few wallets dominate circulating supply. Contract
            holders (bridges, staking, LP) are split out via on-chain eth_getCode.
          </span>
        </span>
      )}
    </span>
  );
}

// Cell for the new "HL OI" column. Renders a sortable USD figure plus a
// tiny inline funding-direction marker. Empty for tokens without an HL
// perp listing — that's most of the catalog.
function HlOiCell({
  oiUsd,
  fundingHourly,
  coin,
}: {
  oiUsd: number | null;
  fundingHourly: number | null;
  coin: string | null;
}) {
  // Distinguish "no perp market on HL" from "data failed to load". A bare
  // dash reads as the latter; explicit "not listed" copy with a faint
  // italic style signals "this token doesn't trade as a perp on HL"
  // without implying a fetch failure.
  if (oiUsd == null) {
    return (
      <span
        className="text-[var(--text-faint)] italic text-[10px] font-normal"
        title="No Hyperliquid perp market for this token"
      >
        not listed
      </span>
    );
  }
  // Direction marker: ↑ when long-pay funding (longs paying shorts to hold,
  // i.e. long-biased venue), ↓ when short-pay, • when at HL's baseline
  // floor (no directional skew).
  const HL_BASELINE = 1.25e-5;
  const atFloor =
    fundingHourly != null &&
    Math.abs(Math.abs(fundingHourly) - HL_BASELINE) < HL_BASELINE * 0.05;
  const arrow =
    fundingHourly == null
      ? null
      : atFloor
        ? { glyph: '·', cls: 'text-[var(--text-faint)]', label: 'baseline' }
        : fundingHourly > 0
          ? { glyph: '↑', cls: 'text-[var(--green)]', label: 'long-pay funding' }
          : { glyph: '↓', cls: 'text-red-500', label: 'short-pay funding' };
  return (
    <span className="inline-flex items-baseline gap-1 tabular-nums" title={coin ? `${coin} on Hyperliquid` : undefined}>
      <span>{formatUSD(oiUsd)}</span>
      {arrow && <span className={`text-[10px] ${arrow.cls}`} title={arrow.label}>{arrow.glyph}</span>}
    </span>
  );
}

// Small "Perps" pill rendered next to the token tags when an HL perp
// market exists for this seed. Cheap visual signal at the catalog level.
function PerpsBadge({ coin }: { coin: string }) {
  return (
    <span
      title={`${coin} has a Hyperliquid perp market. Click into the detail page for OI, funding, liquidations, and positioning.`}
      className="inline-flex items-center text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--accent)]/15 text-[var(--accent)] border border-[var(--accent)]/30"
    >
      Perps
    </span>
  );
}

const PAGE_SIZE = 50;

export default function TokensPage() {
  const { data, isLoading, error } = useTokenDirectory();
  const [sortKey, setSortKey] = useState<SortKey>('mcap');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);

  // Filter + sort runs against the full directory (search remains global, not
  // page-scoped). The result feeds both the page count and the slice we render.
  const rows = useMemo(() => {
    if (!data) return [] as TokenSummary[];
    const q = query.trim().toLowerCase();
    const filtered = q
      ? data.filter(
          (t) =>
            t.symbol.toLowerCase().includes(q) ||
            t.name.toLowerCase().includes(q) ||
            t.contract.toLowerCase().includes(q)
        )
      : data;
    const sorted = [...filtered].sort(COMPARATORS[sortKey]);
    return sortDir === 'asc' ? sorted.reverse() : sorted;
  }, [data, query, sortKey, sortDir]);

  // Reset to page 1 whenever the filtered result changes shape (search query
  // or sort change). Without this, narrowing a search can leave the user
  // stranded on an empty page 3.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset pagination when filters change — intentional
    setPage(1);
  }, [query, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pagedRows = rows.slice(pageStart, pageStart + PAGE_SIZE);

  function header(label: string, key: SortKey, align: 'left' | 'right' = 'right', help?: string, extra?: string) {
    const active = sortKey === key;
    return (
      <th className={`py-2 text-[11px] font-medium text-[var(--text-faint)] ${align === 'right' ? 'text-right' : 'text-left'} ${extra ?? ''}`}>
        <span className="relative inline-flex items-center gap-1 group">
          <button
            type="button"
            onClick={() => {
              if (active) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
              else { setSortKey(key); setSortDir('desc'); }
            }}
            className={`inline-flex items-center gap-1 hover:text-[var(--text)] transition-colors ${active ? 'text-[var(--text)]' : ''}`}
          >
            {label}
            {active && <span className="text-[9px]">{sortDir === 'desc' ? '▼' : '▲'}</span>}
          </button>
          {help && (
            <>
              <span className="text-[9px] text-[var(--text-faint)] cursor-help" aria-label={help}>ⓘ</span>
              <span className="invisible group-hover:visible absolute right-0 top-5 z-30 w-64 rounded border border-[var(--border)] bg-[var(--bg-elevated)] p-2 text-[11px] text-[var(--text-muted)] shadow-lg pointer-events-none normal-case font-normal text-left leading-snug">
                {help}
              </span>
            </>
          )}
        </span>
      </th>
    );
  }

  return (
    <div className="px-4 sm:px-6 py-6 max-w-[1600px] mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text)]" style={{ fontFamily: 'var(--font-display)' }}>
          Tokens
          <span className="ml-2 align-middle inline-flex items-center text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent)]/10 text-[var(--accent)] font-medium">v0 prototype</span>
        </h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Token analytics powered exclusively by The Graph. Prices and supply via Token API + canonical Uniswap V3 pools; DEX volume aggregated across Uniswap V2/V3 and Curve subgraphs on The Graph Network.
        </p>
      </div>

      <div className="mb-3 flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search symbol, name, or contract"
            className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-md px-3 py-1.5 text-sm placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)]"
          />
        </div>
        <div className="text-xs text-[var(--text-faint)]">{rows.length} of {data?.length ?? 0}</div>
      </div>

      <Card className="overflow-x-clip overflow-y-visible">
        {error && (
          <div className="text-sm text-red-500 p-2">Failed to load: {(error as Error).message}</div>
        )}
        {isLoading && !data && (
          <div className="text-sm text-[var(--text-muted)] p-2">Loading…</div>
        )}
        {data && (
          <div className="overflow-x-auto overflow-y-visible">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="py-2 pl-2 pr-3 text-left text-[11px] font-medium text-[var(--text-faint)]">#</th>
                  {header('Token', 'symbol', 'left')}
                  {header('Price', 'price')}
                  {header('24h %', 'change')}
                  {header('7d %', 'change7d')}
                  {header('30d %', 'change30d')}
                  <th className="py-2 text-right text-[11px] font-medium text-[var(--text-faint)] pl-4">30d</th>
                  {header('DEX Vol', 'volume', 'right', 'Latest day’s volume aggregated across the Uniswap V2 + V3 mainnet subgraphs. Hover any value for the per-venue breakdown.')}
                  {header('Mcap', 'mcap')}
                  {header('Holders', 'holders', 'right', 'Token API holder count. Hover the value to see top-10 holder concentration split into EOA vs contract share. A higher EOA share is a tighter wallet distribution.')}
                  {header('HL OI', 'hlOi', 'right', 'Hyperliquid open interest in USD. ↑ = long-pay funding (longs paying shorts to hold). ↓ = short-pay funding. · = at HL\'s per-asset baseline (no directional skew). Click any row to drill into the perps card on the detail page.', 'pl-4')}
                </tr>
              </thead>
              <tbody>
                {pagedRows.map((t, i) => (
                  <tr key={`${t.chain}-${t.contract}`} className="border-b border-[var(--border)]/40 hover:bg-[var(--bg-elevated)]/50">
                    <td className="py-2 pl-2 pr-3 text-[var(--text-faint)] tabular-nums">{pageStart + i + 1}</td>
                    <td className="py-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link href={`/tokens/${t.chain}/${t.contract}`} className="flex items-center gap-2 hover:text-[var(--accent)]">
                          <TokenIcon symbol={t.symbol} slug={t.icon} logoUri={t.logoUri} contract={t.contract} chain={t.chain} />
                          <span className="font-medium">{t.symbol}</span>
                          <span className="text-[var(--text-faint)] text-xs">{t.name}</span>
                        </Link>
                        {t.tags.map((tag) => (
                          <TagBadge key={tag} tag={tag} />
                        ))}
                        {t.hyperliquidCoin && <PerpsBadge coin={t.hyperliquidCoin} />}
                        {t.website && (
                          <a
                            href={t.website}
                            target="_blank"
                            rel="noreferrer"
                            title={`Visit ${t.name} project page`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-[var(--text-faint)] hover:text-[var(--accent)] transition-colors"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                            </svg>
                          </a>
                        )}
                        <WarningPopover warnings={t.warnings} />
                      </div>
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {t.priceUsd != null ? formatPrice(t.priceUsd) : '—'}
                    </td>
                    <td className="py-2 text-right tabular-nums"><PctBadge value={t.change24hPct} /></td>
                    <td className="py-2 text-right tabular-nums"><PctBadge value={t.change7dPct} /></td>
                    <td className="py-2 text-right tabular-nums"><PctBadge value={t.change30dPct} /></td>
                    <td className="py-2 text-right pl-4">
                      <div className="inline-flex justify-end"><Sparkline points={t.sparkline} id={t.contract.slice(2, 10)} /></div>
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      <VolumeCell total={t.dexVolume24hUsd} byVenue={t.dexVolumeByVenue} />
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {t.marketCapUsd != null ? formatUSD(t.marketCapUsd) : '—'}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      <HoldersCell count={t.holders} eoaShare={t.top10EoaShare} contractShare={t.top10ContractShare} />
                    </td>
                    <td className="py-2 text-right tabular-nums pl-4 pr-2">
                      <HlOiCell oiUsd={t.hyperliquidOiUsd} fundingHourly={t.hyperliquidFundingHourly} coin={t.hyperliquidCoin} />
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && data.length > 0 && (
                  <tr>
                    <td colSpan={11} className="py-6 text-center text-sm text-[var(--text-faint)]">No tokens match &quot;{query}&quot;.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {data && rows.length > 0 && (
          <div className="flex items-center justify-between gap-3 px-2 py-2 border-t border-[var(--border)]/40 text-xs text-[var(--text-muted)]">
            <span className="tabular-nums">
              {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, rows.length)} of {rows.length}
              {query.trim() && data.length !== rows.length && (
                <span className="text-[var(--text-faint)]"> (filtered from {data.length})</span>
              )}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-2 py-1 rounded border border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--text)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Prev
              </button>
              <span className="px-2 tabular-nums">
                Page {currentPage} of {totalPages}
              </span>
              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="px-2 py-1 rounded border border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--text)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </Card>

      <p className="mt-3 text-[11px] text-[var(--text-faint)] leading-relaxed">
        DEX Vol = aggregated 24h decentralized-exchange volume sourced through The Graph Network.
        Includes native Uniswap V2 mainnet + Uniswap V3 on Ethereum, Arbitrum, Base, and Polygon
        (per-token <code>tokenDayData.volumeUSD</code>), plus Curve Finance mainnet (pool-walk: latest
        <code>dailySnapshots</code> volume attributed equally across each pool&apos;s input tokens).
        Hover any value for the per-venue × per-chain breakdown. CEX volume is intentionally excluded.
        Balancer and SushiSwap aren&apos;t in yet; also Messari schema, would need the same pool-walk
        treatment, queued for the next iteration.
      </p>
    </div>
  );
}
