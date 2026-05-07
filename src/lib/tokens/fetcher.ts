/**
 * Aggregated fetchers used by the API routes.
 */

import {
  fetchHolders,
  fetchPoolOhlc,
  fetchPoolsForToken,
  fetchSwapsForToken,
  fetchTokenMetadata,
} from './api';
import { classifyAddresses } from './contract-detection';
import { recordDeficiency } from './deficiencies';
import { fetchDexVolumes } from './dex-volume';
import { TOKEN_SEEDS } from './seed';
import { fetchSpotPrices } from './spot-price';
import { getUniswapLogoUri } from './uniswap-token-list';
import type {
  OhlcPoint,
  TokenDetail,
  TokenHolder,
  TokenMarket,
  TokenPerformance,
  TokenRange24h,
  TokenSeed,
  TokenSummary,
  TokenSwap,
} from './types';

const ETH_REFERENCE_POOL = '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640';

async function getEthUsd(): Promise<number | null> {
  const ohlc = await fetchPoolOhlc('mainnet', ETH_REFERENCE_POOL, '4h', 2);
  const last = ohlc[ohlc.length - 1];
  if (!last) {
    recordDeficiency('ETH_REFERENCE_POOL_EMPTY', 'WETH/USDC reference pool returned no OHLC');
    return null;
  }
  // Pool is USDC/WETH (token0=USDC, token1=WETH). Ticker comes back as either
  // "WETHUSDC" (USDC per WETH = ETH/USD) or "USDCWETH" (WETH per USDC).
  // We normalise: if the close looks like a tiny fraction (< 0.01), it's
  // inverted and we flip it.
  return last.close < 0.01 ? 1 / last.close : last.close;
}

function priceFromOhlc(point: { close: number }, seed: TokenSeed, ethUsd: number | null): number | null {
  if (point.close <= 0) return null;
  // Apply pool direction: if our seed token is the *quote* side of the
  // ticker (inverse=true) we need to flip the price.
  const raw = seed.pool.inverse ? 1 / point.close : point.close;
  if (seed.pool.quote === 'usd') return raw;
  if (ethUsd == null) return null;
  return raw * ethUsd;
}

async function buildSummary(seed: TokenSeed, ethUsd: number | null): Promise<TokenSummary> {
  const warnings: string[] = [];
  // Parallelize the three Token API calls. The directory fan-out runs
  // buildSummary for every seed at once, so each token's wall time is
  // max(metadata, ohlc, holders) instead of the sum.
  const [meta, ohlc, holdersForShare, logoUri] = await Promise.all([
    fetchTokenMetadata(seed.chain, seed.contract).catch((e) => {
      warnings.push(`metadata: ${(e as Error).message}`);
      return null;
    }),
    // 4h interval × 10 limit (API hard cap) ≈ a few days of sparkline points.
    fetchPoolOhlc(seed.chain, seed.pool.address, '4h', 10).catch((e) => {
      warnings.push(`ohlc: ${(e as Error).message}`);
      return [] as Awaited<ReturnType<typeof fetchPoolOhlc>>;
    }),
    fetchHolders(seed.chain, seed.contract, 10).catch(() => []),
    getUniswapLogoUri(seed.chain, seed.contract).catch(() => null),
  ]);

  const today = ohlc[ohlc.length - 1];
  // Walk back to find the bar ~24h before the latest. With 4h bars that's
  // ~6 candles, but we look up by timestamp to handle gaps and dedupe loss.
  const cutoff24h = today ? Math.floor(new Date(today.datetime).getTime() / 1000) - 24 * 3600 : 0;
  const yesterday = today
    ? [...ohlc].reverse().find((p) => Math.floor(new Date(p.datetime).getTime() / 1000) <= cutoff24h)
    : undefined;

  const priceUsd =
    seed.pegUsd != null ? seed.pegUsd : today ? priceFromOhlc(today, seed, ethUsd) : null;
  const priceYesterday =
    seed.pegUsd != null ? seed.pegUsd : yesterday ? priceFromOhlc(yesterday, seed, ethUsd) : null;

  const change24hPct =
    priceUsd != null && priceYesterday != null && priceYesterday !== 0
      ? ((priceUsd - priceYesterday) / priceYesterday) * 100
      : null;

  // Volume from OHLC is in pool-base-token units. Convert to USD via the
  // already-computed price when the volume side matches our token; otherwise
  // skip (this is a known imprecision -- record it).
  const volume24hUsd =
    today && priceUsd != null
      ? seed.pool.inverse
        ? today.volume * (seed.pool.quote === 'eth' && ethUsd ? ethUsd : 1)
        : today.volume * priceUsd
      : null;

  if (today && volume24hUsd == null) {
    recordDeficiency(
      'OHLC_VOLUME_DENOMINATION_AMBIGUOUS',
      `cannot resolve volume USD for ${seed.symbol}: ticker=${today.ticker}, raw_volume=${today.volume}`
    );
  }

  const circulatingSupply = meta?.circulating_supply ?? null;
  const marketCapUsd =
    circulatingSupply != null && priceUsd != null ? circulatingSupply * priceUsd : null;

  // Sparkline: 4h close-price series, USD-converted, last ~30 points. For
  // stablecoins the seed's pool is a stable-vs-stable pool (e.g. USDC/DAI),
  // so this captures peg drift instead of being a flat $1 line.
  const sparklineFinal = ohlc
    .map((p) => priceFromOhlc(p, seed, ethUsd))
    .filter((v): v is number => v != null && v > 0)
    .slice(-30);

  // Holder concentration. The Token API returns `amount` as a string of
  // base units (deficiency TOKEN_API_HOLDERS_AMOUNT_STRING); scale by
  // decimals then divide by circulating supply.
  //
  // We split the share by address type (EOA vs contract). Token API gives
  // no `is_contract` flag (deficiency TOKEN_API_NO_HOLDER_TYPE), so we hit
  // an RPC `eth_getCode` per holder. Contract status is sticky so the
  // result is cached for the process lifetime.
  let top10Share: number | null = null;
  let top10EoaShare: number | null = null;
  let top10ContractShare: number | null = null;
  if (circulatingSupply != null && circulatingSupply > 0 && holdersForShare.length > 0) {
    const decimals = meta?.decimals ?? 18;
    const classified = await classifyAddresses(seed.chain, holdersForShare.map((h) => h.address)).catch(() => new Map<string, boolean>());
    let eoaSum = 0;
    let contractSum = 0;
    let totalSum = 0;
    let unknownCount = 0;
    for (const h of holdersForShare) {
      const raw = typeof h.amount === 'string' ? h.amount : String(h.amount ?? '0');
      let scaled: number;
      try {
        const big = BigInt(raw.split('.')[0] ?? '0');
        scaled = Number(big) / 10 ** decimals;
      } catch {
        scaled = Number(raw) / 10 ** decimals;
      }
      totalSum += scaled;
      const lower = h.address.toLowerCase();
      // classifyAddresses omits the address from its result when the RPC
      // call failed (vs returning false for "definitely EOA"). Treat the
      // absence as "unknown" and roll the balance into both buckets
      // proportionally rather than defaulting to EOA, which would inflate
      // the very metric we're trying to deflate.
      if (!classified.has(lower)) {
        unknownCount++;
        continue;
      }
      if (classified.get(lower) === true) contractSum += scaled;
      else eoaSum += scaled;
    }
    top10Share = Math.min(1, totalSum / circulatingSupply);
    // Distribute the "unknown" balance proportionally to the known split,
    // so EOA + contract still sums to total. If everything's unknown
    // (RPC down), fall back to attributing all to EOA so the metric is
    // visually identical to the legacy combined number.
    const knownSum = eoaSum + contractSum;
    if (knownSum > 0) {
      const unknownSum = totalSum - knownSum;
      const eoaFrac = eoaSum / knownSum;
      top10EoaShare = Math.min(1, (eoaSum + unknownSum * eoaFrac) / circulatingSupply);
      top10ContractShare = Math.min(1, (contractSum + unknownSum * (1 - eoaFrac)) / circulatingSupply);
    } else {
      top10EoaShare = top10Share;
      top10ContractShare = 0;
    }
    if (unknownCount > 0) {
      warnings.push(`top-10 holder classification: ${unknownCount}/${holdersForShare.length} RPC lookups failed; share split estimated`);
    }
  }

  const apiName = meta?.name?.trim();
  if (meta && !apiName) {
    recordDeficiency(
      'TOKEN_API_MISSING_NAME',
      `name is null/empty for ${seed.symbol} on ${seed.chain} (contract ${seed.contract})`
    );
  }

  return {
    contract: seed.contract,
    chain: seed.chain,
    name: seed.nameOverride ?? (apiName || seed.symbol),
    symbol: meta?.symbol?.trim() || seed.symbol,
    decimals: meta?.decimals ?? 18,
    icon: meta?.icon?.web3icon ?? seed.iconSlug ?? null,
    logoUri: logoUri,
    priceUsd,
    change24hPct,
    volume24hUsd,
    circulatingSupply,
    marketCapUsd,
    holders: meta?.holders ?? null,
    website: seed.website ?? null,
    tags: seed.tags ?? [],
    sparkline: sparklineFinal,
    top10Share,
    top10EoaShare,
    top10ContractShare,
    dexVolume24hUsd: null,
    dexVolumeByVenue: {},
    warnings,
    quoteAsOf: Date.now(),
  };
}

export async function fetchTokenDirectory(): Promise<TokenSummary[]> {
  const ethUsd = await getEthUsd();
  // Fan out per-token Token API calls in parallel, plus a single batched
  // call to each DEX subgraph (one round trip per subgraph for all seeds)
  // and one batched Uniswap V3 query for live spot prices.
  const mainnetContracts = TOKEN_SEEDS.filter((s) => s.chain === 'mainnet').map(
    (s) => s.contract
  );
  const [summaries, volumes, spotPrices] = await Promise.all([
    Promise.all(TOKEN_SEEDS.map((s) => buildSummary(s, ethUsd))),
    fetchDexVolumes(TOKEN_SEEDS),
    fetchSpotPrices(mainnetContracts),
  ]);

  for (const summary of summaries) {
    const breakdown = volumes.get(summary.contract.toLowerCase());
    if (breakdown) {
      summary.dexVolume24hUsd = breakdown.totalUsd > 0 ? breakdown.totalUsd : null;
      summary.dexVolumeByVenue = breakdown.byVenue;
    }
    // Override priceUsd with live subgraph spot when available. The
    // matching seed determines whether to skip pegged stables — they
    // already short-circuit pricing in buildSummary.
    const seed = TOKEN_SEEDS.find(
      (s) => s.chain === summary.chain && s.contract.toLowerCase() === summary.contract.toLowerCase()
    );
    if (seed?.pegUsd != null) continue;
    const live = spotPrices.get(summary.contract.toLowerCase());
    if (live != null && live > 0) {
      summary.priceUsd = live;
      if (summary.circulatingSupply != null) {
        summary.marketCapUsd = summary.circulatingSupply * live;
      }
    }
  }
  return summaries;
}

function mapOhlc(
  p: { datetime: string; open: number; high: number; low: number; close: number; volume: number },
  seed: TokenSeed,
  ethUsd: number | null
): OhlcPoint {
  // For inverse pools we apply 1/x in priceFromOhlc, which swaps the
  // ordering of high/low: the API's high (largest pre-inversion close)
  // becomes our low after inversion, and vice versa. Swap them up front
  // so the rendered candle has wicks on the correct sides.
  const apiHigh = seed.pool.inverse ? p.low : p.high;
  const apiLow = seed.pool.inverse ? p.high : p.low;
  return {
    timestamp: Math.floor(new Date(p.datetime).getTime() / 1000),
    open: priceFromOhlc({ close: p.open }, seed, ethUsd) ?? 0,
    high: priceFromOhlc({ close: apiHigh }, seed, ethUsd) ?? 0,
    low: priceFromOhlc({ close: apiLow }, seed, ethUsd) ?? 0,
    close: priceFromOhlc(p, seed, ethUsd) ?? 0,
    volume: p.volume,
  };
}

function findSeed(chain: string, contract: string): TokenSeed | undefined {
  const lower = contract.toLowerCase();
  return TOKEN_SEEDS.find((s) => s.chain === chain && s.contract.toLowerCase() === lower);
}

export async function fetchTokenDetail(
  chain: string,
  contract: string
): Promise<TokenDetail | null> {
  const seed = findSeed(chain, contract);
  if (!seed) return null;

  const ethUsd = await getEthUsd();

  // OHLC `limit` is hard-capped at 10. We paginate 4 pages in parallel to
  // get up to 40 raw rows; after de-duplication that typically yields
  // ~20-30 unique daily bars for the chart.
  const [
    summary,
    priceDailyP1,
    priceDailyP2,
    priceDailyP3,
    priceDailyP4,
    spotPrice,
    holdersRaw,
    poolsRaw,
    swapsRaw,
  ] = await Promise.all([
    buildSummary(seed, ethUsd),
    fetchPoolOhlc(seed.chain, seed.pool.address, '1d', 10, 1),
    fetchPoolOhlc(seed.chain, seed.pool.address, '1d', 10, 2),
    fetchPoolOhlc(seed.chain, seed.pool.address, '1d', 10, 3),
    fetchPoolOhlc(seed.chain, seed.pool.address, '1d', 10, 4),
    seed.pegUsd == null
      ? fetchSpotPrices([seed.contract]).then((m) => m.get(seed.contract.toLowerCase()) ?? null)
      : Promise.resolve(null),
    fetchHolders(seed.chain, seed.contract, 10),
    fetchPoolsForToken(seed.chain, seed.contract, 25).catch((e) => {
      recordDeficiency('TOKEN_API_POOLS_QUERY_FAILED', `pools query failed for ${seed.symbol}: ${(e as Error).message}`);
      return [];
    }),
    fetchSwapsForToken(seed.chain, seed.contract, 12).catch((e) => {
      recordDeficiency('TOKEN_API_SWAPS_QUERY_FAILED', `swaps query failed for ${seed.symbol}: ${(e as Error).message}`);
      return [];
    }),
  ]);

  // Merge the four daily pages by datetime. Each page returns its own
  // dedup batch; we re-dedup across pages by timestamp, keeping the
  // first occurrence (page 1 has freshest data for any overlap).
  const dailyByTs = new Map<number, OhlcPoint>();
  for (const page of [priceDailyP1, priceDailyP2, priceDailyP3, priceDailyP4]) {
    for (const p of page) {
      const point = mapOhlc(p, seed, ethUsd);
      if (!dailyByTs.has(point.timestamp)) dailyByTs.set(point.timestamp, point);
    }
  }
  const priceSeries: OhlcPoint[] = [...dailyByTs.values()].sort((a, b) => a.timestamp - b.timestamp);

  // Override the header price with the live subgraph spot. Token API's
  // OHLC caches hourly bars server-side so its `close` does not move
  // between bar boundaries; the V3 subgraph's `derivedETH` updates with
  // each indexed swap so polling actually shows price movement.
  if (spotPrice != null && spotPrice > 0) {
    summary.priceUsd = spotPrice;
    if (summary.circulatingSupply != null) {
      summary.marketCapUsd = summary.circulatingSupply * spotPrice;
    }
  }
  // Refresh the as-of stamp now that we've blended in spot data.
  summary.quoteAsOf = Date.now();

  // The OpenAPI declares `amount: number` but the API actually returns base-
  // units as a *string* (e.g. "2950586159470810704448008222" for 18-decimals
  // GRT). Normalize to a JS number scaled by `decimals`. Tracked as a
  // deficiency so we can ask the API team to either fix the type or ship a
  // pre-scaled `amount_decimal` field.
  const decimals = summary.decimals ?? 18;
  // Classify holder addresses as EOA vs contract via `eth_getCode`.
  // Cached per-process; one round-trip per new address. Failures fall
  // back to `null` (unknown) so the row simply doesn't get badged.
  const classified = await classifyAddresses(
    seed.chain,
    holdersRaw.map((h) => h.address)
  ).catch(() => new Map<string, boolean>());
  const topHolders: TokenHolder[] = holdersRaw.map((h) => {
    const raw = typeof h.amount === 'string' ? h.amount : String(h.amount ?? '0');
    if (typeof h.amount === 'string') {
      recordDeficiency(
        'TOKEN_API_HOLDERS_AMOUNT_STRING',
        `holders.amount returned as string base-units (OpenAPI says number): ${seed.symbol}`
      );
    }
    let scaled: number;
    try {
      const big = BigInt(raw.split('.')[0] ?? '0');
      scaled = Number(big) / 10 ** decimals;
    } catch {
      scaled = Number(raw) / 10 ** decimals;
    }
    // The API's `value` field has surprised us before (often equal to the
    // raw amount divided by 10^18 with no price applied). Trust priceUsd
    // over `value` and recompute when we have a price.
    const valueUsd = summary.priceUsd != null ? scaled * summary.priceUsd : (h.value ?? null);
    const lower = h.address.toLowerCase();
    const isContract = classified.has(lower) ? classified.get(lower)! : null;
    return { address: h.address, amount: scaled, valueUsd, isContract };
  });

  const markets = buildMarkets(poolsRaw, seed.contract);
  const recentSwaps = buildSwaps(swapsRaw, seed.contract, summary.priceUsd);
  const performance = buildPerformance(priceSeries);
  const range24h = buildRange24h(priceSeries);

  return { summary, priceSeries, topHolders, markets, recentSwaps, performance, range24h };
}

function buildMarkets(
  pools: import('./api').ApiPool[],
  seedContract: string
): TokenMarket[] {
  // Filter out the CoW settlement contract (tracked deficiency: it shows up
  // as a "pool" but is actually a multi-pair settlement address).
  const COW_SETTLEMENT = '0x9008d19f58aabd9ed0d60971565aa8510560ab41';
  const seedLower = seedContract.toLowerCase();
  const seen = new Set<string>();
  let leaked = 0;
  const out: TokenMarket[] = [];
  for (const p of pools) {
    if (p.pool.toLowerCase() === COW_SETTLEMENT) continue;
    if (seen.has(p.pool.toLowerCase())) continue;
    const inAddr = p.input_token?.address?.toLowerCase();
    const outAddr = p.output_token?.address?.toLowerCase();
    // Defensive: the API leaks unrelated pools when filtering by
    // `input_token` (e.g. DGNX/TUSD pools appear in GRT results).
    if (inAddr !== seedLower && outAddr !== seedLower) {
      leaked++;
      continue;
    }
    seen.add(p.pool.toLowerCase());
    const inSym = p.input_token?.symbol ?? '?';
    const outSym = p.output_token?.symbol ?? '?';
    const inIsSeed = inAddr === seedLower;
    out.push({
      pool: p.pool,
      protocol: p.protocol,
      feeBps: typeof p.fee === 'number' ? p.fee : null,
      baseSymbol: inIsSeed ? inSym : outSym,
      baseContract: inIsSeed ? (inAddr ?? '') : (outAddr ?? ''),
      quoteSymbol: inIsSeed ? outSym : inSym,
      quoteContract: inIsSeed ? (outAddr ?? '') : (inAddr ?? ''),
    });
  }
  if (leaked > 0) {
    recordDeficiency(
      'TOKEN_API_POOLS_FILTER_LEAKS',
      `pools?input_token=${seedContract.slice(0, 10)} returned ${leaked} unrelated pools (filter not enforced server-side)`
    );
  }
  return out.slice(0, 12);
}

function buildSwaps(
  swaps: import('./api').ApiSwap[],
  seedContract: string,
  priceUsd: number | null
): TokenSwap[] {
  const seedLower = seedContract.toLowerCase();
  return swaps.map((s) => {
    const inIsSeed = s.input_token?.address?.toLowerCase() === seedLower;
    // input_value already comes back as token-units (not base-units), so we
    // can use it directly. Sell = our token going in, Buy = our token coming out.
    const tokenAmount = inIsSeed
      ? Number(s.input_value)
      : Number(s.output_value);
    const counterpartySymbol = inIsSeed
      ? s.output_token?.symbol ?? '?'
      : s.input_token?.symbol ?? '?';
    const amountUsd = priceUsd != null ? tokenAmount * priceUsd : null;
    return {
      timestamp: s.timestamp ?? Math.floor(new Date(s.datetime).getTime() / 1000),
      txHash: s.transaction_id,
      pool: s.pool,
      protocol: s.protocol,
      side: inIsSeed ? 'sell' : 'buy',
      amount: tokenAmount,
      amountUsd,
      counterpartySymbol,
    };
  });
}

function pctVsLast(series: OhlcPoint[], hoursBack: number): number | null {
  if (series.length < 2) return null;
  const last = series[series.length - 1];
  const cutoff = last.timestamp - hoursBack * 3600;
  // Find the bar at or just before cutoff.
  let pivot: OhlcPoint | undefined;
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i].timestamp <= cutoff) { pivot = series[i]; break; }
  }
  if (!pivot || pivot.close <= 0) return null;
  return ((last.close - pivot.close) / pivot.close) * 100;
}

function buildPerformance(series: OhlcPoint[]): TokenPerformance {
  return {
    d1: pctVsLast(series, 24),
    d7: pctVsLast(series, 24 * 7),
    d14: pctVsLast(series, 24 * 14),
    d30: pctVsLast(series, 24 * 30),
  };
}

function buildRange24h(series: OhlcPoint[]): TokenRange24h | null {
  if (series.length === 0) return null;
  const last = series[series.length - 1];
  const cutoff = last.timestamp - 24 * 3600;
  const window = series.filter((p) => p.timestamp >= cutoff && p.close > 0);
  if (window.length === 0) return null;
  const lows = window.map((p) => (p.low > 0 ? p.low : p.close));
  const highs = window.map((p) => (p.high > 0 ? p.high : p.close));
  const low = Math.min(...lows);
  const high = Math.max(...highs);
  const current = last.close;
  const position = high === low ? 0.5 : Math.max(0, Math.min(1, (current - low) / (high - low)));
  return { low, high, current, position };
}
