/**
 * Hyperliquid perps data via the Pinax Token API's Perp Exchange surface
 * (`/v1/hyperliquid/*`, launched 2026-05-08). Surfaces three signals on the
 * detail page when a seed has a corresponding HL perp market:
 *   - Open interest (token + USD)
 *   - 24h funding (annualized)
 *   - 24h liquidation activity (count + notional, long/short split)
 *
 * The integration is per-detail, not directory-wide: HL exposes ~400 markets
 * so per-coin lookups are cheap and we don't pay for a fan-out across all
 * seeds. Two API calls per detail load (snapshot + liquidations OHLC),
 * issued in parallel with the existing fan-out in `fetcher.ts`.
 *
 * Symbol mapping: HL coins are unwrapped tickers (BTC, ETH, SOL, …). We
 * unwrap the obvious wrapper symbols on our side; everything else passes
 * through the seed symbol verbatim. LSTs / stablecoins won't have a market,
 * the API returns an empty array, and the card renders nothing.
 */
import { tokenApiGet } from './api';
import { recordDeficiency } from './deficiencies';
import type { TokenSeed } from './types';

// --- Endpoint shapes ---

interface HlMarketRow {
  coin: string;
  market_name: string;
  dex: string;
  price: number;
  price_24h: number | null;
  price_24h_change: number;
  volume_24h: number;
  buy_volume_24h: number;
  sell_volume_24h: number;
  trades_24h: number;
  unique_users_24h: number;
  open_interest: number | null;
  funding_rate: number | null;
  funding_snapshot_time: string | null;
}

interface HlPriceOhlcRow {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface HlLiquidationEventRow {
  timestamp: string;
  coin: string;
  liquidated_user: string;
  direction: string;
  notional: number;
}

interface HlLiquidationOhlcRow {
  timestamp: string;
  coin: string;
  interval_min: number;
  open: number;
  close: number;
  gross_volume: number;
  close_long_volume: number;
  close_short_volume: number;
  transactions: number;
  unique_liquidated: number;
}

interface HlOiRow {
  timestamp: string;
  coin: string;
  interval_min: number;
  open_interest: number;
  long_positions: number;
  short_positions: number;
  long_size: number;
  short_size: number;
  funding_rate: number | null;
}

// --- Public types ---

export interface TokenHyperliquid {
  /** Hyperliquid coin identifier (e.g. "BTC", "ETH"). */
  coin: string;
  /** Direct link to the trade UI for this market. */
  marketUrl: string;
  /** Mark price in USD as reported by the exchange. */
  priceUsd: number;
  /** 24h price change as a fraction (0.0497 = +4.97%). */
  priceChange24h: number;
  /** 24h trade count and unique-trader breadth on this venue. */
  trades24h: number;
  uniqueUsers24h: number;
  /** Most recent UTC-day intraday extremes for the perp's mark price.
   *  Null when the OHLC fetch failed. */
  priceHigh24h: number | null;
  priceLow24h: number | null;
  /** 24h hourly closes (oldest → newest) for a sparkline. Empty when
   *  the OHLC fetch failed. */
  priceHistory24h: number[];
  /** 24h trading volume in USD. */
  volume24hUsd: number;
  /** Open interest in token units. */
  openInterestTokens: number;
  /** Open interest in USD (`openInterestTokens * priceUsd`). */
  openInterestUsd: number;
  /** OI change vs the same hour 24 hours ago, as a fraction
   *  (0.082 = +8.2%). Null when the historical bucket isn't available. */
  openInterestChange24h: number | null;
  /** 24h hourly OI history in token units (oldest → newest), for a
   *  sparkline. */
  openInterestHistory24h: number[];
  /** 24h trade volume split by side, in USD. From the markets snapshot. */
  volume24hBuyUsd: number;
  volume24hSellUsd: number;
  /** Latest hourly snapshot of trader positioning across this market.
   *  `long`/`short` are position counts (number of accounts) — a
   *  sentiment proxy distinct from notional balance. */
  positioning: {
    longCount: number;
    shortCount: number;
    longSizeTokens: number;
    shortSizeTokens: number;
  } | null;
  /** Hourly funding rate as a decimal (1.25e-5 = +0.00125%/hour). */
  fundingHourly: number;
  /** Annualized funding rate as a fraction (`fundingHourly * 24 * 365`). */
  fundingAnnualized: number;
  /** 24h hourly funding history (oldest → newest), each value in the
   *  same hourly-decimal scale as `fundingHourly`. Empty when the OI
   *  history fetch failed. */
  fundingHistory24h: number[];
  /** Whether the funding rate has been pinned at or near HL's baseline
   *  (≈ 1.25e-5/hr ≈ 10.95% ann.) for ≥6 of the last 24 hours. When
   *  true, +10.95% is the floor, not a directional signal. */
  fundingAtBaseline: boolean;
  /** Last funding snapshot timestamp (server-returned, UTC datetime string). */
  fundingSnapshotTime: string | null;
  /** The single largest liquidation event in the latest UTC day, when
   *  one is reportable. Used as flavor on the card. */
  largestLiquidation24h: {
    notionalUsd: number;
    /** "long" or "short" — the side of the liquidated position. */
    side: 'long' | 'short';
    user: string;
    timestamp: string;
  } | null;
  /** Aggregated liquidations over the latest UTC day. */
  liquidations24h: {
    /** Number of liquidation events (one transaction per forced exit). */
    events: number;
    /** Distinct liquidated wallets in the day. */
    uniqueUsers: number;
    /** USD notional of liquidations whose closed positions were long. */
    longNotionalUsd: number;
    /** USD notional of liquidations whose closed positions were short. */
    shortNotionalUsd: number;
    /** Total USD notional (long + short). */
    totalNotionalUsd: number;
    /** Day bucket the figures cover (UTC). */
    bucketStart: string;
  } | null;
}

// Symbol-mapping for cases where HL's coin id differs from the seed's
// on-chain symbol. Two patterns:
//
//   1. Wrapped → underlying. HL lists BTC/ETH (not WBTC/WETH), and we
//      want the perps card to show on both forms. Other wrappers
//      (cbBTC, tBTC, cbETH, wstETH, rETH, weETH, etc.) deliberately
//      don't unwrap because their on-chain economics differ enough
//      that piping them straight to the underlying perp would mislead.
//
//   2. `k`-prefixed memes. HL prices low-unit memecoins as 1000-token
//      contracts (kPEPE = price per 1k PEPE), so the coin id is
//      `kSYMBOL` rather than `SYMBOL`. Our seed list carries the bare
//      symbol; the map translates it.
const COIN_MAP: Record<string, string> = {
  WBTC: 'BTC',
  WETH: 'ETH',
  PEPE: 'kPEPE',
  SHIB: 'kSHIB',
  FLOKI: 'kFLOKI',
};

export function seedToHyperliquidCoin(seed: TokenSeed): string | null {
  const sym = (seed.symbol ?? '').toUpperCase();
  if (!sym) return null;
  // Stablecoins have no perp; short-circuit so we don't pay an API call.
  if (seed.tags?.includes('Stablecoin')) return null;
  return COIN_MAP[sym] ?? sym;
}

/**
 * Batched directory fetch — paginates `/v1/hyperliquid/markets` (10 rows
 * per page on our plan) until exhausted, filters to `dex === 'perps'`,
 * and returns a `Map<coin, snapshot>` for cheap O(1) per-seed lookup
 * without making one HTTP request per token. Cost: ~45 parallel calls
 * once per directory cold load (cached 5 min).
 */
export async function fetchAllHyperliquidPerps(): Promise<Map<string, HlMarketRow>> {
  const out = new Map<string, HlMarketRow>();
  const PAGE_LIMIT = 50;
  const tasks: Promise<HlMarketRow[]>[] = [];
  for (let page = 1; page <= PAGE_LIMIT; page++) {
    tasks.push(
      tokenApiGet<HlMarketRow>('/v1/hyperliquid/markets', { page })
        .then((env) => env.data ?? [])
        .catch(() => [] as HlMarketRow[])
    );
  }
  const pages = await Promise.all(tasks);
  for (const rows of pages) {
    for (const r of rows) {
      if (r.dex === 'perps') out.set(r.coin, r);
    }
  }
  return out;
}

async function fetchSnapshot(coin: string): Promise<HlMarketRow | null> {
  const env = await tokenApiGet<HlMarketRow>('/v1/hyperliquid/markets', { coin });
  // Filter to perp dex — `markets?coin=` will also match spot pairs that
  // happen to share the symbol (e.g. base/quote tokens). We only care about
  // the perpetual market.
  const perp = (env.data ?? []).find((m) => m.dex === 'perps');
  return perp ?? null;
}

async function fetchLiquidationsLastDay(coin: string): Promise<HlLiquidationOhlcRow | null> {
  // `interval=1d` returns UTC-day buckets, ordered desc; limit=1 is the
  // current (in-progress) day. The figures roll up all liquidation events
  // in the bucket, sidestepping the page-size limit on the events endpoint.
  const env = await tokenApiGet<HlLiquidationOhlcRow>('/v1/hyperliquid/markets/liquidations/ohlc', {
    coin,
    interval: '1d',
    limit: 1,
  });
  return env.data?.[0] ?? null;
}

async function fetchOiHistory24h(coin: string): Promise<HlOiRow[]> {
  // Hourly buckets over the last 25 hours. Used for two things: the
  // newest bucket (index 0) carries trader-positioning counts, and the
  // bucket from 24h ago (index 24) lets us compute the 24h OI delta.
  // Daily buckets won't work for the delta on the just-rolled UTC day —
  // the current bucket is incomplete and OI looks artificially small.
  const env = await tokenApiGet<HlOiRow>('/v1/hyperliquid/markets/oi', {
    coin,
    interval: '1h',
    limit: 25,
  });
  return env.data ?? [];
}

async function fetchPriceOhlc24h(coin: string): Promise<HlPriceOhlcRow[]> {
  // 24 hourly OHLC bars for the perp's mark price. Drives the price
  // sparkline + 24h high/low badge.
  const env = await tokenApiGet<HlPriceOhlcRow>('/v1/hyperliquid/markets/ohlc', {
    coin,
    interval: '1h',
    limit: 24,
  });
  return env.data ?? [];
}

async function fetchLargestLiquidation(coin: string): Promise<HlLiquidationEventRow | null> {
  // The /markets/liquidations endpoint defaults to ORDER BY notional
  // DESC, so limit=1 returns the single largest event in the queryable
  // window. We filter to "today" client-side to avoid surfacing stale
  // mega-liquidations that aren't relevant.
  const env = await tokenApiGet<HlLiquidationEventRow>('/v1/hyperliquid/markets/liquidations', {
    coin,
    limit: 1,
  });
  return env.data?.[0] ?? null;
}

/**
 * Fetch the per-seed Hyperliquid summary. Returns `null` when no perp
 * market exists for the seed's mapped coin (most of our catalog).
 *
 * Liquidation aggregates are best-effort: a missing OHLC row just leaves
 * `liquidations24h` as `null` rather than failing the whole card.
 */
export async function fetchHyperliquidForSeed(seed: TokenSeed): Promise<TokenHyperliquid | null> {
  const coin = seedToHyperliquidCoin(seed);
  if (!coin) return null;
  // Five HL endpoints, all in parallel. Most return empty data (not
  // errors) for coins without a perp market, so issuing them
  // speculatively for non-listed seeds is safe. Latency is bounded by
  // the slowest call rather than the sum.
  const [snapshot, liqRow, oiRows, ohlcRows, biggestLiq] = await Promise.all([
    fetchSnapshot(coin).catch((e) => {
      recordDeficiency(
        'HYPERLIQUID_SNAPSHOT_FAILED',
        `hyperliquid markets ${coin}: ${(e as Error).message}`
      );
      return null;
    }),
    fetchLiquidationsLastDay(coin).catch((e) => {
      recordDeficiency(
        'HYPERLIQUID_LIQUIDATIONS_FAILED',
        `hyperliquid liquidations/ohlc ${coin}: ${(e as Error).message}`
      );
      return null;
    }),
    fetchOiHistory24h(coin).catch((e) => {
      recordDeficiency(
        'HYPERLIQUID_OI_FAILED',
        `hyperliquid markets/oi ${coin}: ${(e as Error).message}`
      );
      return [] as HlOiRow[];
    }),
    fetchPriceOhlc24h(coin).catch((e) => {
      recordDeficiency(
        'HYPERLIQUID_OHLC_FAILED',
        `hyperliquid markets/ohlc ${coin}: ${(e as Error).message}`
      );
      return [] as HlPriceOhlcRow[];
    }),
    fetchLargestLiquidation(coin).catch((e) => {
      recordDeficiency(
        'HYPERLIQUID_BIG_LIQ_FAILED',
        `hyperliquid markets/liquidations ${coin}: ${(e as Error).message}`
      );
      return null;
    }),
  ]);
  if (!snapshot) return null;

  const priceUsd = Number(snapshot.price ?? 0);
  const oiTokens = Number(snapshot.open_interest ?? 0);
  const fundingHourly = Number(snapshot.funding_rate ?? 0);
  // OI 24h delta from the hourly history. Compares the newest bucket
  // (index 0) to the bucket ~24 hours ago (last in the desc-ordered
  // limit=25 page). When the page returns fewer than expected (fresh
  // listing, indexer gap), fall back to null so the UI omits the line.
  const oiNow = oiRows[0]?.open_interest;
  const oiThen = oiRows[oiRows.length - 1]?.open_interest;
  const openInterestChange24h =
    oiRows.length >= 2 && Number.isFinite(oiNow) && Number.isFinite(oiThen) && oiThen > 0
      ? (oiNow - oiThen) / oiThen
      : null;
  // Trader positioning: counts from the newest hourly bucket. `short_size`
  // is signed negative in the schema; we surface absolute token magnitudes.
  const positioning = oiRows[0]
    ? {
        longCount: Number(oiRows[0].long_positions ?? 0),
        shortCount: Number(oiRows[0].short_positions ?? 0),
        longSizeTokens: Math.abs(Number(oiRows[0].long_size ?? 0)),
        shortSizeTokens: Math.abs(Number(oiRows[0].short_size ?? 0)),
      }
    : null;
  // Funding history (oldest → newest), each value in hourly-decimal scale.
  // Used both for the sparkline and for the "at baseline" regime check —
  // HL's per-asset baseline rate sits ≈ 1.25e-5/hr (≈ 10.95% ann.).
  const fundingHistory24h = [...oiRows]
    .reverse()
    .map((r) => Number(r.funding_rate ?? 0))
    .filter((n) => Number.isFinite(n));
  const HL_BASELINE = 1.25e-5;
  const baselineHits = fundingHistory24h.filter(
    (f) => Math.abs(f - HL_BASELINE) < HL_BASELINE * 0.05 || Math.abs(f + HL_BASELINE) < HL_BASELINE * 0.05
  ).length;
  const fundingAtBaseline = fundingHistory24h.length >= 6 && baselineHits >= 6;
  // OI sparkline (oldest → newest), in token units.
  const openInterestHistory24h = [...oiRows]
    .reverse()
    .map((r) => Number(r.open_interest ?? 0))
    .filter((n) => Number.isFinite(n));
  // Price extremes + sparkline. OHLC rows are returned newest-first.
  const ohlcAsc = [...ohlcRows].reverse();
  const priceHigh24h = ohlcRows.length > 0 ? Math.max(...ohlcRows.map((r) => Number(r.high))) : null;
  const priceLow24h = ohlcRows.length > 0 ? Math.min(...ohlcRows.map((r) => Number(r.low))) : null;
  const priceHistory24h = ohlcAsc.map((r) => Number(r.close)).filter((n) => Number.isFinite(n) && n > 0);
  // Biggest single liquidation event today — only surface when it's
  // recent (≤24h) and has meaningful notional, otherwise we'd be
  // showing yesterday's drama as today's flavor.
  const NOW_MS = Date.now();
  let largestLiquidation24h: TokenHyperliquid['largestLiquidation24h'] = null;
  if (biggestLiq && Number(biggestLiq.notional) > 0) {
    const eventMs = new Date(biggestLiq.timestamp.replace(' ', 'T') + 'Z').getTime();
    const ageHours = (NOW_MS - eventMs) / (1000 * 60 * 60);
    if (Number.isFinite(ageHours) && ageHours <= 24) {
      const sideRaw = biggestLiq.direction.toUpperCase();
      const side: 'long' | 'short' = sideRaw.includes('LONG') ? 'long' : 'short';
      largestLiquidation24h = {
        notionalUsd: Number(biggestLiq.notional),
        side,
        user: biggestLiq.liquidated_user,
        timestamp: biggestLiq.timestamp,
      };
    }
  }
  const liquidations24h = liqRow
    ? (() => {
        // Liquidation OHLC volumes are already USD-denominated (cross-
        // checked against `/v1/hyperliquid/platform.liquidations_volume`,
        // which sums these by day across all coins and resolves to plausible
        // platform totals e.g. ~$33M/day). The `open`/`close` fields on the
        // candle are mark prices and are NOT a USD-conversion factor.
        const longUsd = Number(liqRow.close_long_volume ?? 0);
        const shortUsd = Number(liqRow.close_short_volume ?? 0);
        return {
          events: Number(liqRow.transactions ?? 0),
          uniqueUsers: Number(liqRow.unique_liquidated ?? 0),
          longNotionalUsd: longUsd,
          shortNotionalUsd: shortUsd,
          totalNotionalUsd: longUsd + shortUsd,
          bucketStart: liqRow.timestamp,
        };
      })()
    : null;

  return {
    coin,
    marketUrl: `https://app.hyperliquid.xyz/trade/${encodeURIComponent(coin)}`,
    priceUsd,
    priceChange24h: Number(snapshot.price_24h_change ?? 0),
    trades24h: Number(snapshot.trades_24h ?? 0),
    uniqueUsers24h: Number(snapshot.unique_users_24h ?? 0),
    priceHigh24h,
    priceLow24h,
    priceHistory24h,
    volume24hUsd: Number(snapshot.volume_24h ?? 0),
    volume24hBuyUsd: Number(snapshot.buy_volume_24h ?? 0),
    volume24hSellUsd: Number(snapshot.sell_volume_24h ?? 0),
    openInterestTokens: oiTokens,
    openInterestUsd: oiTokens * priceUsd,
    openInterestChange24h,
    openInterestHistory24h,
    fundingHourly,
    fundingAnnualized: fundingHourly * 24 * 365,
    fundingHistory24h,
    fundingAtBaseline,
    fundingSnapshotTime: snapshot.funding_snapshot_time,
    positioning,
    liquidations24h,
    largestLiquidation24h,
  };
}
