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
import { fetchAllHyperliquidPerps, fetchHyperliquidForSeed, seedToHyperliquidCoin } from './hyperliquid';
import { fetchAaveV3MultiChain, summariseLending, type LendingChain } from './lending';
import { TOKEN_SEEDS } from './seed';
import { fetchPoolStats, type PoolStats } from './pool-stats';
import { fetchSpotPrices } from './spot-price';
import { fetchTotalSupplies } from './total-supply';
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

// Token API rate limit: 500/min on our plan. With 4 calls per token (metadata
// + sparkline ohlc + holders + logo), an unbounded fan-out at ~150 seeds
// blows past the limit instantly. Cap concurrency so the calls trickle out
// at sub-limit rate; per-call latency is ~150ms so 12 in flight = ~80 req/s,
// well under the per-minute ceiling once the burst absorbs.
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

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
  // Parallelize the Token API calls. The directory fan-out runs buildSummary
  // for every seed at once, so each token's wall time is max(metadata, ohlc,
  // holders) instead of the sum.
  //
  // OHLC: two pages of 1d × 100. Token API caps `limit` at 100 *and* returns
  // each datetime twice (verified empirically), so a single page yields only
  // ~50 unique days. Two pages give ~100 unique days — enough for 90d
  // performance with a small buffer.
  const [meta, ohlcP1, ohlcP2, holdersForShare, logoUri] = await Promise.all([
    fetchTokenMetadata(seed.chain, seed.contract).catch((e) => {
      warnings.push(`metadata: ${(e as Error).message}`);
      return null;
    }),
    fetchPoolOhlc(seed.chain, seed.pool.address, '1d', 100, 1).catch((e) => {
      warnings.push(`ohlc: ${(e as Error).message}`);
      return [] as Awaited<ReturnType<typeof fetchPoolOhlc>>;
    }),
    fetchPoolOhlc(seed.chain, seed.pool.address, '1d', 100, 2).catch(() => {
      // Page 2 absence isn't worth a warning; fresh listings simply lack 90d
      // history. Caller already has the page-1 fallback.
      return [] as Awaited<ReturnType<typeof fetchPoolOhlc>>;
    }),
    fetchHolders(seed.chain, seed.contract, 10).catch(() => []),
    getUniswapLogoUri(seed.chain, seed.contract).catch(() => null),
  ]);
  // Merge the two pages by datetime; first occurrence wins (page 1 is fresher
  // for any overlap).
  const ohlcMap = new Map<string, (typeof ohlcP1)[number]>();
  for (const page of [ohlcP1, ohlcP2]) {
    for (const p of page) if (!ohlcMap.has(p.datetime)) ohlcMap.set(p.datetime, p);
  }
  const ohlc = [...ohlcMap.values()].sort((a, b) => a.datetime.localeCompare(b.datetime));

  const today = ohlc[ohlc.length - 1];
  // Locate historical bars by timestamp offset rather than fixed index, since
  // the API can return gaps (and de-dupe shrinks the array). Walk back from
  // `today` and pick the most recent bar at-or-before each cutoff.
  const todayTs = today ? Math.floor(new Date(today.datetime).getTime() / 1000) : 0;
  const reversed = [...ohlc].reverse();
  function priceAtOffsetDays(days: number): number | null {
    if (!today) return null;
    const cutoff = todayTs - days * 86400;
    const bar = reversed.find((p) => Math.floor(new Date(p.datetime).getTime() / 1000) <= cutoff);
    return bar ? priceFromOhlc(bar, seed, ethUsd) : null;
  }

  const priceUsd =
    seed.pegUsd != null ? seed.pegUsd : today ? priceFromOhlc(today, seed, ethUsd) : null;
  const priceYesterday = seed.pegUsd != null ? seed.pegUsd : priceAtOffsetDays(1);
  const price7d = seed.pegUsd != null ? seed.pegUsd : priceAtOffsetDays(7);
  const price30d = seed.pegUsd != null ? seed.pegUsd : priceAtOffsetDays(30);
  const price90d = seed.pegUsd != null ? seed.pegUsd : priceAtOffsetDays(90);

  function pctChange(current: number | null, prior: number | null): number | null {
    if (current == null || prior == null || prior === 0) return null;
    return ((current - prior) / prior) * 100;
  }
  const change24hPct = pctChange(priceUsd, priceYesterday);
  const change7dPct = pctChange(priceUsd, price7d);
  const change30dPct = pctChange(priceUsd, price30d);
  const change90dPct = pctChange(priceUsd, price90d);

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
  const totalSupply = meta?.total_supply ?? null;
  const marketCapUsd =
    circulatingSupply != null && priceUsd != null ? circulatingSupply * priceUsd : null;
  const fdvUsd = totalSupply != null && priceUsd != null ? totalSupply * priceUsd : null;

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
    change7dPct,
    change30dPct,
    change90dPct,
    volume24hUsd,
    circulatingSupply,
    totalSupply,
    marketCapUsd,
    fdvUsd,
    holders: meta?.holders ?? null,
    website: seed.website ?? null,
    tags: seed.tags ?? [],
    sparkline: sparklineFinal,
    top10Share,
    top10EoaShare,
    top10ContractShare,
    dexVolume24hUsd: null,
    dexVolumeByVenue: {},
    hyperliquidCoin: null,
    hyperliquidOiUsd: null,
    hyperliquidFundingHourly: null,
    altContracts: seed.altContracts ?? {},
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
  // ERC-20 totalSupply via on-chain RPC. Token API and the V3 subgraph both
  // return null/garbage for total supply, so we hit the contract directly.
  // viem batches into a few large JSON-RPC calls per chain. Runs in parallel
  // with the Token API fan-out — the seed list already carries `decimals`
  // for non-existing tokens we'd default to 18 anyway.
  // Decimals come from the same atomic RPC call that reads totalSupply, so
  // we don't need to know them up front.
  const totalSupplyInput = TOKEN_SEEDS.map((s) => ({
    chain: s.chain,
    contract: s.contract,
  }));
  const [summaries, volumes, spotPrices, totalSupplies, hlPerps] = await Promise.all([
    mapWithConcurrency(TOKEN_SEEDS, 6, (s) => buildSummary(s, ethUsd)),
    fetchDexVolumes(TOKEN_SEEDS),
    fetchSpotPrices(mainnetContracts),
    fetchTotalSupplies(totalSupplyInput),
    // One paginated sweep of `/v1/hyperliquid/markets` builds a coin →
    // snapshot map; per-seed lookup is then O(1). Far cheaper than
    // calling the snapshot endpoint once per seed.
    fetchAllHyperliquidPerps().catch(() => new Map()),
  ]);

  for (const summary of summaries) {
    const breakdown = volumes.get(summary.contract.toLowerCase());
    if (breakdown) {
      summary.dexVolume24hUsd = breakdown.totalUsd > 0 ? breakdown.totalUsd : null;
      summary.dexVolumeByVenue = breakdown.byVenue;
    }
    const supplyKey = `${summary.chain}:${summary.contract.toLowerCase()}`;
    const ts = totalSupplies.get(supplyKey);
    if (ts != null) {
      summary.totalSupply = ts;
      if (summary.priceUsd != null) summary.fdvUsd = ts * summary.priceUsd;
    }
    const seed = TOKEN_SEEDS.find(
      (s) => s.chain === summary.chain && s.contract.toLowerCase() === summary.contract.toLowerCase()
    );
    // Hyperliquid perps lookup. The mapping function short-circuits for
    // stablecoins and tokens that don't fit the wrapped/k-prefix patterns,
    // so this is a cheap O(1) hit on the prebuilt map for ~134 of 153
    // seeds and a no-op for the rest.
    if (seed) {
      const hlCoin = seedToHyperliquidCoin(seed);
      if (hlCoin) {
        const market = hlPerps.get(hlCoin);
        if (market && Number.isFinite(market.price) && market.price > 0) {
          summary.hyperliquidCoin = hlCoin;
          const oiTokens = Number(market.open_interest ?? 0);
          summary.hyperliquidOiUsd = oiTokens > 0 ? oiTokens * market.price : null;
          summary.hyperliquidFundingHourly =
            market.funding_rate != null ? Number(market.funding_rate) : null;
        }
      }
    }
    // Override priceUsd with live subgraph spot when available. The
    // matching seed determines whether to skip pegged stables — they
    // already short-circuit pricing in buildSummary.
    if (seed?.pegUsd != null) continue;
    const live = spotPrices.get(summary.contract.toLowerCase());
    if (live != null && live > 0) {
      summary.priceUsd = live;
      if (summary.circulatingSupply != null) {
        summary.marketCapUsd = summary.circulatingSupply * live;
      }
      if (summary.totalSupply != null) {
        summary.fdvUsd = summary.totalSupply * live;
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

  // OHLC `limit` is capped at 100 (verified empirically: limit=100 OK,
  // limit>=101 returns 0 rows) AND returns ~75% same-day duplicates, so
  // 100 raw rows often collapse to ~25-50 unique datetimes. We paginate 4
  // pages in parallel and dedupe across pages by timestamp to span ~100
  // unique days. (An earlier "cap to 10" patch was based on a misread of
  // the actual API limit; the real cap is 100.)
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
    dexVolumes,
    aaveReserves,
    hyperliquid,
    ethBmP1,
    ethBmP2,
    onChainSupplyRaw,
  ] = await Promise.all([
    buildSummary(seed, ethUsd),
    fetchPoolOhlc(seed.chain, seed.pool.address, '1d', 100, 1),
    fetchPoolOhlc(seed.chain, seed.pool.address, '1d', 100, 2),
    fetchPoolOhlc(seed.chain, seed.pool.address, '1d', 100, 3),
    fetchPoolOhlc(seed.chain, seed.pool.address, '1d', 100, 4),
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
    // DEX volume aggregation runs once per detail load. Same call shape the
    // directory uses, just scoped to this single seed. Without it the detail
    // page's "24h DEX Vol" card stays blank because `buildSummary` only
    // initialises those fields to null.
    fetchDexVolumes([seed]).catch(() => new Map<string, { totalUsd: number; byVenue: Record<string, number> }>()),
    // Lending market data — Aave V3 across mainnet + Arbitrum + Base +
    // Polygon + Optimism. Built from the seed's primary contract plus its
    // `altContracts` map; chains without a known address are skipped.
    fetchAaveV3MultiChain(buildLendingChainContracts(seed)).catch(() => []),
    // Hyperliquid perps snapshot. Returns null for any seed without a
    // matching HL coin (most of the catalog) and silently degrades when
    // the API is unavailable.
    fetchHyperliquidForSeed(seed).catch(() => null),
    // ETH benchmark and on-chain total supply — independent of the above,
    // batched here to avoid sequential round-trips after the main await.
    fetchPoolOhlc('mainnet', ETH_REFERENCE_POOL, '1d', 100, 1).catch(() => []),
    fetchPoolOhlc('mainnet', ETH_REFERENCE_POOL, '1d', 100, 2).catch(() => []),
    fetchTotalSupplies([{ chain: seed.chain, contract: seed.contract }]),
  ]);
  const ethBenchmark = [ethBmP1, ethBmP2];
  const dexBreakdown = dexVolumes.get(seed.contract.toLowerCase());
  if (dexBreakdown) {
    summary.dexVolume24hUsd = dexBreakdown.totalUsd > 0 ? dexBreakdown.totalUsd : null;
    summary.dexVolumeByVenue = dexBreakdown.byVenue;
  }

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
  // Build the ETH benchmark as `{ timestamp, close }` rows. The reference
  // pool's ticker logic is the same as `getEthUsd`: a close < 0.01 means the
  // pair returns USDC-per-WETH inverted, so flip it.
  const ethDailyByTs = new Map<number, { timestamp: number; close: number }>();
  for (const page of ethBenchmark) {
    for (const p of page) {
      const ts = Math.floor(new Date(p.datetime).getTime() / 1000);
      const close = p.close < 0.01 ? 1 / p.close : p.close;
      if (!ethDailyByTs.has(ts) && close > 0) ethDailyByTs.set(ts, { timestamp: ts, close });
    }
  }
  const benchmarkSeries = [...ethDailyByTs.values()].sort((a, b) => a.timestamp - b.timestamp);
  const priceSeriesRaw: OhlcPoint[] = [...dailyByTs.values()].sort((a, b) => a.timestamp - b.timestamp);
  // Drop "spike-and-revert" bars: a single candle whose close is far from
  // both neighbors while the neighbors themselves are close to each other.
  // The Token API occasionally emits one bad candle from a mispriced
  // indexer swap (e.g. RLUSD/USDC on 2026-02-09 reported a close of $1.125
  // surrounded by $1.000 bars on either side), and that single bar wrecks
  // the chart's y-axis on the 3M view. Threshold is relative — a bar is
  // dropped if its close differs from the neighbors' average by more than
  // 5x the gap between the neighbors themselves, with a 5% floor so calm
  // periods don't flag tiny normal movements.
  const priceSeries: OhlcPoint[] = priceSeriesRaw.filter((p, i) => {
    if (p.close <= 0) return false;
    if (i === 0 || i === priceSeriesRaw.length - 1) return true;
    const prev = priceSeriesRaw[i - 1].close;
    const next = priceSeriesRaw[i + 1].close;
    if (prev <= 0 || next <= 0) return true;
    const neighborAvg = (prev + next) / 2;
    const neighborGap = Math.abs(prev - next);
    const deviation = Math.abs(p.close - neighborAvg);
    const threshold = Math.max(neighborGap * 5, neighborAvg * 0.05);
    return deviation <= threshold;
  });

  const tsKey = `${seed.chain}:${seed.contract.toLowerCase()}`;
  const ts = onChainSupplyRaw.get(tsKey);
  if (ts != null) {
    summary.totalSupply = ts;
    if (summary.priceUsd != null) summary.fdvUsd = ts * summary.priceUsd;
  }

  // Override the header price with the live subgraph spot. Token API's
  // OHLC caches hourly bars server-side so its `close` does not move
  // between bar boundaries; the V3 subgraph's `derivedETH` updates with
  // each indexed swap so polling actually shows price movement.
  if (spotPrice != null && spotPrice > 0) {
    summary.priceUsd = spotPrice;
    if (summary.circulatingSupply != null) {
      summary.marketCapUsd = summary.circulatingSupply * spotPrice;
    }
    if (summary.totalSupply != null) {
      summary.fdvUsd = summary.totalSupply * spotPrice;
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
  // Classify holder addresses (EOA vs contract) and fetch pool stats in
  // parallel — both depend on the main batch but are independent of each other.
  const poolIds = poolsRaw.map((p) => p.pool);
  const [classified, poolStats] = await Promise.all([
    classifyAddresses(seed.chain, holdersRaw.map((h) => h.address)).catch(() => new Map<string, boolean>()),
    poolIds.length > 0
      ? fetchPoolStats(poolIds, seed.contract, ethUsd)
      : Promise.resolve(new Map<string, PoolStats>()),
  ]);
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

  const markets = buildMarkets(poolsRaw, seed.contract, poolStats);
  const recentSwaps = buildSwaps(swapsRaw, seed.contract, summary.priceUsd, ethUsd);
  const performance = buildPerformance(priceSeries);
  const range24h = buildRange24h(priceSeries);
  const lending = summariseLending(aaveReserves, summary.priceUsd);

  return { summary, priceSeries, benchmarkSeries, topHolders, markets, recentSwaps, performance, range24h, lending, hyperliquid };
}

// Map a seed's contracts onto the chain keys that the lending module
// understands. The primary `seed.contract` is the mainnet identifier;
// `altContracts` covers the four L2s. Chains without a known address
// fall through (the lending module skips them).
function buildLendingChainContracts(seed: TokenSeed): Partial<Record<LendingChain, string>> {
  const out: Partial<Record<LendingChain, string>> = {};
  if (seed.chain === 'mainnet') out.mainnet = seed.contract;
  if (seed.altContracts?.arbitrum) out.arbitrum = seed.altContracts.arbitrum;
  if (seed.altContracts?.base) out.base = seed.altContracts.base;
  if (seed.altContracts?.polygon) out.polygon = seed.altContracts.polygon;
  if (seed.altContracts?.optimism) out.optimism = seed.altContracts.optimism;
  return out;
}

function buildMarkets(
  pools: import('./api').ApiPool[],
  seedContract: string,
  stats: Map<string, PoolStats>
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
    const s = stats.get(p.pool.toLowerCase());
    // Token API frequently returns `fee: 0` on pools where the protocol has
    // dynamic or non-tier-based fees (e.g. it labels Kyber Elastic / V3-fork
    // pools with no fee at all). Subgraph `feeTier` is the authoritative
    // value — fall back to it whenever the API value is missing or 0.
    const apiFee = typeof p.fee === 'number' && p.fee > 0 ? p.fee : null;
    const fee = apiFee ?? s?.feeBps ?? null;
    out.push({
      pool: p.pool,
      protocol: p.protocol,
      feeBps: fee,
      baseSymbol: inIsSeed ? inSym : outSym,
      baseContract: inIsSeed ? (inAddr ?? '') : (outAddr ?? ''),
      quoteSymbol: inIsSeed ? outSym : inSym,
      quoteContract: inIsSeed ? (outAddr ?? '') : (inAddr ?? ''),
      tvlUsd: s?.tvlUsd ?? null,
      volume24hUsd: s?.volume24hUsd ?? null,
      priceUsd: s?.seedPriceUsd ?? null,
    });
  }
  if (leaked > 0) {
    recordDeficiency(
      'TOKEN_API_POOLS_FILTER_LEAKS',
      `pools?input_token=${seedContract.slice(0, 10)} returned ${leaked} unrelated pools (filter not enforced server-side)`
    );
  }
  // Rank pools by TVL when known so the markets table leads with deepest
  // liquidity. Drop pools that have neither TVL nor volume — Token API
  // surfaces ancient pools (Uniswap V1, dead Bancor pairs) and out-of-scope
  // ones (V4 before its subgraph indexes everything) where every stat
  // resolves to null. Those rows just clutter the table.
  const ranked = out
    .filter((m) => m.tvlUsd != null || m.volume24hUsd != null)
    .sort((a, b) => (b.tvlUsd ?? -1) - (a.tvlUsd ?? -1));
  return ranked.slice(0, 12);
}

// Stablecoin counterparty symbols treated as $1.00 when computing execution
// price. The list intentionally covers the breadth of seeds we support so
// that any swap against one of them resolves to a USD price directly.
const STABLE_SYMBOLS = new Set([
  'USDC', 'USDT', 'DAI', 'FRAX', 'LUSD', 'GHO', 'USDe', 'USD0', 'USDS',
  'crvUSD', 'PYUSD', 'TUSD', 'GUSD', 'AUSD', 'RLUSD', 'MIM', 'BOLD',
]);

function buildSwaps(
  swaps: import('./api').ApiSwap[],
  seedContract: string,
  priceUsd: number | null,
  ethUsd: number | null
): TokenSwap[] {
  const seedLower = seedContract.toLowerCase();
  return swaps.map((s) => {
    const inIsSeed = s.input_token?.address?.toLowerCase() === seedLower;
    // input_value / output_value come back as decimal-adjusted token units
    // (not USD, despite the suggestive `_value` name). Sell = our token
    // going in, Buy = our token coming out.
    const tokenAmount = inIsSeed
      ? Number(s.input_value)
      : Number(s.output_value);
    const counterpartyAmount = inIsSeed
      ? Number(s.output_value)
      : Number(s.input_value);
    const counterpartySymbol = inIsSeed
      ? s.output_token?.symbol ?? '?'
      : s.input_token?.symbol ?? '?';
    const counterpartyContract = inIsSeed
      ? s.output_token?.address ?? null
      : s.input_token?.address ?? null;
    const amountUsd = priceUsd != null ? tokenAmount * priceUsd : null;
    // Execution price in USD per seed token. Derived from the counterparty
    // leg whenever we know the counterparty's USD value:
    //   - Stable counterparty → 1 USD per token
    //   - WETH counterparty → ethUsd per token
    //   - Anything else → fall back to the spot priceUsd (no slippage signal,
    //     but at least the column isn't blank)
    let execPriceUsd: number | null = null;
    if (tokenAmount > 0 && Number.isFinite(counterpartyAmount) && counterpartyAmount > 0) {
      const cpSym = counterpartySymbol.toUpperCase();
      let cpUsdPerUnit: number | null = null;
      if (STABLE_SYMBOLS.has(counterpartySymbol) || cpSym === 'USDC' || cpSym === 'USDT' || cpSym === 'DAI') {
        cpUsdPerUnit = 1;
      } else if (cpSym === 'WETH' || cpSym === 'ETH') {
        cpUsdPerUnit = ethUsd;
      }
      if (cpUsdPerUnit != null) {
        execPriceUsd = (counterpartyAmount * cpUsdPerUnit) / tokenAmount;
      } else if (priceUsd != null) {
        execPriceUsd = priceUsd;
      }
    }
    return {
      timestamp: s.timestamp ?? Math.floor(new Date(s.datetime).getTime() / 1000),
      txHash: s.transaction_id,
      pool: s.pool,
      protocol: s.protocol,
      side: inIsSeed ? 'sell' : 'buy',
      amount: tokenAmount,
      amountUsd,
      counterpartySymbol,
      counterpartyContract,
      // Token API exposes three address fields: `user` (originator), `sender`
      // (immediate caller, often a router contract), and `recipient`. `user`
      // is the meaningful "trader" column — the EOA that signed the trade.
      trader: s.user || s.sender || s.recipient,
      priceUsd: execPriceUsd,
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
