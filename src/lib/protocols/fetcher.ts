import {
  POLYMARKET_OI_DEPLOYMENT,
  POLYMARKET_MAIN_DEPLOYMENT,
  POLYMARKET_RESOLUTION_DEPLOYMENT,
  type ProtocolConfig,
} from './config';

export interface ProtocolDaySnapshot {
  timestamp: number; // unix seconds
  tvlUSD: number;
  volumeUSD: number;
  feesUSD: number;
}

export interface ProtocolSummary {
  slug: string;
  tvlUSD: number;
  cumulativeVolumeUSD: number;
  cumulativeFeesUSD: number;
  volume30dUSD: number;
  fees30dUSD: number;
  totalBorrowUSD?: number;
  stakingAPR?: number;
}

export interface ProtocolDetail {
  summary: ProtocolSummary;
  snapshots: ProtocolDaySnapshot[];
  /**
   * Category-specific extension. Populated for protocols whose native data
   * shape doesn't fit the standard TVL/Volume/Fees + 90d-snapshot pattern
   * (currently: Prediction Markets). The detail page reads this when the
   * protocol's category is configured for a tailored layout.
   */
  predictionMarkets?: PredictionMarketsDetail;
}

export interface PredictionMarketsDetail {
  totalMarkets: number;
  activeMarkets: number;
  resolvedMarkets: number;
  totalTraders: number;
  totalTrades: number;
  avgTradeSize: number;
  marketCountWithOI: number;
  disputedCount: number;
  recentResolutions: Array<{
    id: string;
    title: string;
    outcome: 'YES' | 'NO' | 'PARTIAL' | 'UNRESOLVED';
    outcomePrice: number;       // 0..1
    resolvedAt: number;          // unix seconds
    wasDisputed: boolean;
    flagged: boolean;
  }>;
  topMarketsByOI: Array<{
    id: string;
    amountUSD: number;
    splitCount: number;
    mergeCount: number;
  }>;
}

// --- Generic gateway query ---

async function queryProtocolSubgraph<T>(subgraphId: string, query: string): Promise<T> {
  const apiKey = process.env.GRAPH_API_KEY;
  if (!apiKey) throw new Error('GRAPH_API_KEY not configured');
  const url = `https://gateway-arbitrum.network.thegraph.com/api/${apiKey}/subgraphs/id/${subgraphId}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Protocol subgraph request failed: ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  return json.data as T;
}

// IPFS-pinned deployments that aren't registered as network Subgraphs but are
// served by the gateway via /deployments/id/{hash}. Used for Polymarket where
// the team publishes data through unregistered deployment hashes.
async function queryDeployment<T>(ipfsHash: string, query: string): Promise<T> {
  const apiKey = process.env.GRAPH_API_KEY;
  if (!apiKey) throw new Error('GRAPH_API_KEY not configured');
  const url = `https://gateway.thegraph.com/api/${apiKey}/deployments/id/${ipfsHash}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Deployment request failed: ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  return json.data as T;
}

// --- Messari DEX schema ---

interface MessariDexData {
  dexAmmProtocols: Array<{
    totalValueLockedUSD: string;
    cumulativeVolumeUSD: string;
    cumulativeTotalRevenueUSD: string;
  }>;
  financialsDailySnapshots: Array<{
    timestamp: string;
    totalValueLockedUSD: string;
    dailyVolumeUSD: string;
    dailyTotalRevenueUSD: string;
  }>;
}

const MESSARI_DEX_QUERY = `{
  dexAmmProtocols(first: 1) {
    totalValueLockedUSD
    cumulativeVolumeUSD
    cumulativeTotalRevenueUSD
  }
  financialsDailySnapshots(first: 90, orderBy: timestamp, orderDirection: desc) {
    timestamp
    totalValueLockedUSD
    dailyVolumeUSD
    dailyTotalRevenueUSD
  }
}`;

// --- Messari Lending schema ---

interface MessariLendingData {
  lendingProtocols: Array<{
    totalValueLockedUSD: string;
    totalBorrowBalanceUSD: string;
    cumulativeBorrowUSD: string;
    cumulativeTotalRevenueUSD: string;
  }>;
  financialsDailySnapshots: Array<{
    timestamp: string;
    totalValueLockedUSD: string;
    dailyBorrowUSD: string;
    dailyTotalRevenueUSD: string;
  }>;
}

const MESSARI_LENDING_QUERY = `{
  lendingProtocols(first: 1) {
    totalValueLockedUSD
    totalBorrowBalanceUSD
    cumulativeBorrowUSD
    cumulativeTotalRevenueUSD
  }
  financialsDailySnapshots(first: 90, orderBy: timestamp, orderDirection: desc) {
    timestamp
    totalValueLockedUSD
    dailyBorrowUSD
    dailyTotalRevenueUSD
  }
}`;

// --- Messari Staking / Yield schema (used by the Messari Lido subgraph).
//
// Same `protocols` + `financialsDailySnapshots` shape as the other Messari templates,
// but volume / fee semantics are different: dailySupplySideRevenueUSD is yield earned
// by stakers and the protocol's cut is captured cumulatively but not split daily.
//
// Most Messari staking deployments (including Lido) write `dailyProtocolSideRevenueUSD = 0`
// across every snapshot while still maintaining a non-zero `cumulativeProtocolSideRevenueUSD`.
// To produce a usable daily-fees series we estimate it as a constant fraction of supply-side
// revenue, derived from the protocol-level cumulative ratio.

interface MessariStakingData {
  protocols: Array<{
    totalValueLockedUSD: string;
    cumulativeSupplySideRevenueUSD: string;
    cumulativeProtocolSideRevenueUSD: string;
    cumulativeTotalRevenueUSD: string;
  }>;
  financialsDailySnapshots: Array<{
    timestamp: string;
    totalValueLockedUSD: string;
    dailySupplySideRevenueUSD: string;
    dailyProtocolSideRevenueUSD: string;
  }>;
}

const MESSARI_STAKING_QUERY = `{
  protocols(first: 1) {
    totalValueLockedUSD
    cumulativeSupplySideRevenueUSD
    cumulativeProtocolSideRevenueUSD
    cumulativeTotalRevenueUSD
  }
  financialsDailySnapshots(first: 90, orderBy: timestamp, orderDirection: desc) {
    timestamp
    totalValueLockedUSD
    dailySupplySideRevenueUSD
    dailyProtocolSideRevenueUSD
  }
}`;

// --- Messari Yield Aggregator schema (used by Yearn V2 Ethereum and similar).
//
// Mirrors the Messari Staking shape: same field names, same dailyProtocolSide=0
// quirk, same proportional fee back-derivation. The only difference is the
// protocol-level entity is `yieldAggregators` instead of `protocols`.

interface MessariYieldData {
  yieldAggregators: Array<{
    totalValueLockedUSD: string;
    cumulativeSupplySideRevenueUSD: string;
    cumulativeProtocolSideRevenueUSD: string;
    cumulativeTotalRevenueUSD: string;
  }>;
  financialsDailySnapshots: Array<{
    timestamp: string;
    totalValueLockedUSD: string;
    dailySupplySideRevenueUSD: string;
    dailyProtocolSideRevenueUSD: string;
  }>;
}

const MESSARI_YIELD_QUERY = `{
  yieldAggregators(first: 1) {
    totalValueLockedUSD
    cumulativeSupplySideRevenueUSD
    cumulativeProtocolSideRevenueUSD
    cumulativeTotalRevenueUSD
  }
  financialsDailySnapshots(first: 90, orderBy: timestamp, orderDirection: desc) {
    timestamp
    totalValueLockedUSD
    dailySupplySideRevenueUSD
    dailyProtocolSideRevenueUSD
  }
}`;

// --- Uniswap V2 native schema ---
//
// V2 has no fees field on either the factory or the daily snapshot. Every swap
// pays a flat 0.30% to LPs, so fees are derived from volume at query time.

const UNISWAP_V2_FEE_RATE = 0.003;
const UNISWAP_V2_FACTORY_ETH = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f';

interface UniswapV2Data {
  uniswapFactory: {
    totalVolumeUSD: string;
    totalLiquidityUSD: string;
  } | null;
  uniswapDayDatas: Array<{
    date: string;
    dailyVolumeUSD: string;
    totalLiquidityUSD: string;
  }>;
}

const UNISWAP_V2_QUERY = `{
  uniswapFactory(id: "${UNISWAP_V2_FACTORY_ETH}") {
    totalVolumeUSD
    totalLiquidityUSD
  }
  uniswapDayDatas(first: 90, orderBy: date, orderDirection: desc) {
    date
    dailyVolumeUSD
    totalLiquidityUSD
  }
}`;

// --- Polymarket multi-deployment schema ---
//
// Polymarket data lives across two unregistered IPFS deployments served by
// the gateway: an Orderbook subgraph (lifetime trade volume + fees + count)
// and an Open Interest subgraph (aggregate USDC locked across markets).
// We use the OI total as a TVL proxy. The orderbook subgraph has no daily
// aggregate entity, so 30d windows are not computed for this protocol;
// directory cells will render as 0 / "—" for the 30d columns.

const POLYMARKET_USDC_DECIMALS = 1_000_000;

interface PolymarketOrderbookData {
  ordersMatchedGlobals: Array<{
    tradesQuantity: string;
    scaledCollateralVolume: string; // already decimal-scaled by the subgraph
    totalFees: string;              // raw USDC, needs /1e6
    averageTradeSize: string;
  }>;
}

interface PolymarketOIData {
  // Top markets by OI, excluding obvious single-market outliers (>$10B).
  // Used as the "active OI" headline because globalOpenInterests.amount is
  // inflated by resolved-market dead money across 700k+ historical markets.
  marketOpenInterests: Array<{
    id: string;
    amount: string;       // decimal-scaled USDC
    splitCount: string;
    mergeCount: string;
  }>;
  globalOpenInterests: Array<{
    marketCount: number;
  }>;
}

interface PolymarketMainData {
  globals: Array<{
    numConditions: string;
    numOpenConditions: string;
    numClosedConditions: string;
    numTraders: string;
  }>;
}

interface PolymarketResolutionData {
  recentResolutions: Array<{
    id: string;
    status: string;
    flagged: boolean;
    wasDisputed: boolean;
    price: string;        // 1e18-scaled outcome
    lastUpdateTimestamp: string;
    ancillaryData: string;
  }>;
  disputedSample: Array<{ id: string }>;
}

const POLYMARKET_ORDERBOOK_QUERY = `{
  ordersMatchedGlobals(first: 1) {
    tradesQuantity
    scaledCollateralVolume
    totalFees
    averageTradeSize
  }
}`;

const POLYMARKET_OI_QUERY = `{
  marketOpenInterests(first: 200, orderBy: amount, orderDirection: desc, where: {amount_lt: "10000000000"}) {
    id
    amount
    splitCount
    mergeCount
  }
  globalOpenInterests(first: 1) {
    marketCount
  }
}`;

const POLYMARKET_MAIN_QUERY = `{
  globals(first: 1) {
    numConditions
    numOpenConditions
    numClosedConditions
    numTraders
  }
}`;

// Resolution returns recent resolved markets (ancillaryData carries the human-
// readable question text) plus a sample of disputed markets used to size a
// "Disputed" headline. The disputed bucket is capped at 1000 by the subgraph;
// for our purposes the lower-bound is sufficient signal.
const POLYMARKET_RESOLUTION_QUERY = `{
  recentResolutions: marketResolutions(
    first: 12,
    orderBy: lastUpdateTimestamp,
    orderDirection: desc,
    where: {status: "resolved"}
  ) {
    id
    status
    flagged
    wasDisputed
    price
    lastUpdateTimestamp
    ancillaryData
  }
  disputedSample: marketResolutions(first: 1000, where: {wasDisputed: true}) {
    id
  }
}`;

// MarketResolution.ancillaryData is the UMA-encoded UTF-8 prompt sent to the
// optimistic oracle. It always begins with "q: title: <TITLE>, description: ..."
// for Polymarket-issued questions. We extract just the title for the UI.
function decodeMarketTitle(hexAncillary: string): string {
  if (!hexAncillary || !hexAncillary.startsWith('0x')) return '';
  try {
    const buf = Buffer.from(hexAncillary.slice(2), 'hex');
    const text = buf.toString('utf-8');
    const match = text.match(/title:\s*(.*?)(?:,\s*description:|$)/);
    return match ? match[1].trim() : '';
  } catch {
    return '';
  }
}

function classifyOutcome(priceWei: string): {
  outcome: 'YES' | 'NO' | 'PARTIAL' | 'UNRESOLVED';
  outcomePrice: number;
} {
  const p = parseF(priceWei) / 1e18;
  if (!Number.isFinite(p)) return { outcome: 'UNRESOLVED', outcomePrice: 0 };
  if (p >= 0.99) return { outcome: 'YES', outcomePrice: p };
  if (p <= 0.01) return { outcome: 'NO', outcomePrice: p };
  return { outcome: 'PARTIAL', outcomePrice: p };
}

function normalizePolymarket(
  slug: string,
  orderbook: PolymarketOrderbookData,
  oi: PolymarketOIData,
  main: PolymarketMainData,
  resolution: PolymarketResolutionData,
): ProtocolDetail {
  const ob = orderbook.ordersMatchedGlobals[0];
  const tvlUSD = oi.marketOpenInterests.reduce((sum, m) => sum + parseF(m.amount), 0);
  const cumulativeVolumeUSD = parseF(ob?.scaledCollateralVolume);
  const cumulativeFeesUSD = parseF(ob?.totalFees) / POLYMARKET_USDC_DECIMALS;

  const g = main.globals[0];
  const recentResolutions = resolution.recentResolutions.map((r) => {
    const { outcome, outcomePrice } = classifyOutcome(r.price);
    return {
      id: r.id,
      title: decodeMarketTitle(r.ancillaryData),
      outcome,
      outcomePrice,
      resolvedAt: parseInt(r.lastUpdateTimestamp),
      wasDisputed: r.wasDisputed,
      flagged: r.flagged,
    };
  });

  const topMarketsByOI = oi.marketOpenInterests.slice(0, 10).map((m) => ({
    id: m.id,
    amountUSD: parseF(m.amount),
    splitCount: parseInt(m.splitCount),
    mergeCount: parseInt(m.mergeCount),
  }));

  const predictionMarkets: PredictionMarketsDetail = {
    totalMarkets: parseInt(g?.numConditions ?? '0'),
    activeMarkets: parseInt(g?.numOpenConditions ?? '0'),
    resolvedMarkets: parseInt(g?.numClosedConditions ?? '0'),
    totalTraders: parseInt(g?.numTraders ?? '0'),
    totalTrades: parseInt(ob?.tradesQuantity ?? '0'),
    avgTradeSize: parseF(ob?.averageTradeSize),
    marketCountWithOI: oi.globalOpenInterests[0]?.marketCount ?? 0,
    disputedCount: resolution.disputedSample.length,
    recentResolutions,
    topMarketsByOI,
  };

  // No daily aggregate entity exists on the orderbook subgraph, and
  // paginating through ~5M trades/day to derive a 30d window is not feasible
  // at request time. We return an empty snapshots array; the detail page
  // renders the predictionMarkets-tailored layout instead.
  return {
    summary: {
      slug,
      tvlUSD,
      cumulativeVolumeUSD,
      cumulativeFeesUSD,
      volume30dUSD: 0,
      fees30dUSD: 0,
    },
    snapshots: [],
    predictionMarkets,
  };
}

// --- Uniswap V3 native schema ---

interface UniswapV3Data {
  factories: Array<{
    totalVolumeUSD: string;
    totalValueLockedUSD: string;
    totalFeesUSD: string;
    txCount: string;
  }>;
  uniswapDayDatas: Array<{
    date: string;
    volumeUSD: string;
    feesUSD: string;
    tvlUSD: string;
  }>;
}

const UNISWAP_V3_QUERY = `{
  factories(first: 1) {
    totalVolumeUSD
    totalValueLockedUSD
    totalFeesUSD
    txCount
  }
  uniswapDayDatas(first: 90, orderBy: date, orderDirection: desc) {
    date
    volumeUSD
    feesUSD
    tvlUSD
  }
}`;

// --- EtherFi native schema ---
//
// ether.fi's v3 subgraph stores values in ETH (BigInt wei) and exposes a
// stream of `rebaseEvents` carrying the post-rebase totalEthLocked and
// totalEEthShares. To produce the same TVL/Volume/Fees/APR shape as the
// other Liquid Staking protocols we:
//
//   1. Fetch all rebases in the last ~95 days (5 events/day average).
//   2. Group by day, take the last event of each day.
//   3. Derive net yield-to-stakers via the eETH share-price delta:
//        priceUSD(day) = totalEthLocked(day) / totalEEthShares(day)
//        yieldEth(day) = sharesPrev * (priceUSD(day) - priceUSD(day-1))
//      This isolates rebase yield from deposits and withdrawals, since
//      share price only moves with rebases (deposits mint at par).
//   4. Multiply by current ETH/USD (fetched in parallel from Uniswap V3
//      mainnet) for USD denomination. Historic rebases are anchored to
//      today's ETH price, an acceptable approximation given Lodestar's
//      'current snapshot' framing.
//   5. Approximate protocol fees as 10% of supply-side yield, matching
//      ether.fi's documented protocol take. Replace with a real source
//      if/when the subgraph exposes it.

const ETHERFI_PROTOCOL_FEE_RATIO = 0.10;
// ETH mainnet Uniswap V3 subgraph (already used elsewhere in lodestar) —
// queried only for `bundle.ethPriceUSD` to convert ETH-denominated values.
const UNISWAP_V3_ETH_MAINNET_SUBGRAPH = '5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV';

interface EtherFiData {
  rebaseEvents: Array<{
    timestamp: string;
    totalEthLocked: string;
    totalEEthShares: string;
    aprs: string[];
  }>;
}

interface EthPriceData {
  bundles: Array<{ ethPriceUSD: string }>;
}

const ETHERFI_QUERY = `{
  rebaseEvents(
    first: 1000
    orderBy: timestamp
    orderDirection: desc
    where: { timestamp_gt: "$SINCE" }
  ) {
    timestamp
    totalEthLocked
    totalEEthShares
    aprs
  }
}`;

const ETH_PRICE_QUERY = `{ bundles(first: 1) { ethPriceUSD } }`;

// --- Shared normalisation ---

function filterFeeOutliers(snapshots: ProtocolDaySnapshot[]): ProtocolDaySnapshot[] {
  if (snapshots.length < 3) return snapshots;
  const fees = snapshots.map((s) => s.feesUSD).sort((a, b) => a - b);
  const median = fees[Math.floor(fees.length / 2)];
  if (median === 0) return snapshots;
  return snapshots.filter((s) => s.feesUSD <= median * 50);
}

function computeSummary(
  slug: string,
  tvlUSD: number,
  cumulativeVolumeUSD: number,
  cumulativeFeesUSD: number,
  snapshots: ProtocolDaySnapshot[],
  extras: Partial<ProtocolSummary> = {},
): ProtocolSummary {
  const thirtyDaysAgo = Date.now() / 1000 - 30 * 86400;
  const recent = snapshots.filter((s) => s.timestamp >= thirtyDaysAgo);
  return {
    slug,
    tvlUSD,
    cumulativeVolumeUSD,
    cumulativeFeesUSD,
    volume30dUSD: recent.reduce((s, d) => s + d.volumeUSD, 0),
    fees30dUSD: recent.reduce((s, d) => s + d.feesUSD, 0),
    ...extras,
  };
}

function parseF(v: string | null | undefined): number {
  return parseFloat(v ?? '0') || 0;
}

// Some Messari subgraphs (Curve mainnet, certain Aave snapshots) leak unscaled
// integer values into USD fields, producing impossible numbers like 3.7e20.
// Anything north of $1 quadrillion (1e15) is a data-quality artefact, not a
// real protocol metric. Clamp it to a snapshot-derived fallback so the UI
// never renders "$ 376424613377.91B" and breaks card layout.
const SANE_USD_CEILING = 1e15;

function sanitizeCumulative(raw: number, snapshotSum: number): number {
  if (!Number.isFinite(raw) || raw < 0 || raw > SANE_USD_CEILING) {
    return Number.isFinite(snapshotSum) && snapshotSum >= 0 ? snapshotSum : 0;
  }
  return raw;
}

function normalizeMessariDex(slug: string, data: MessariDexData): ProtocolDetail {
  const p = data.dexAmmProtocols[0];
  const snapshots: ProtocolDaySnapshot[] = data.financialsDailySnapshots
    .map((s) => ({
      timestamp: parseInt(s.timestamp),
      tvlUSD: parseF(s.totalValueLockedUSD),
      volumeUSD: parseF(s.dailyVolumeUSD),
      feesUSD: parseF(s.dailyTotalRevenueUSD),
    }))
    .sort((a, b) => a.timestamp - b.timestamp);

  const clean = filterFeeOutliers(snapshots);
  const snapshotVolumeSum = clean.reduce((acc, s) => acc + s.volumeUSD, 0);
  const snapshotFeesSum = clean.reduce((acc, s) => acc + s.feesUSD, 0);

  return {
    summary: computeSummary(
      slug,
      parseF(p?.totalValueLockedUSD),
      sanitizeCumulative(parseF(p?.cumulativeVolumeUSD), snapshotVolumeSum),
      sanitizeCumulative(parseF(p?.cumulativeTotalRevenueUSD), snapshotFeesSum),
      clean,
    ),
    snapshots: clean,
  };
}

function normalizeMessariLending(slug: string, data: MessariLendingData): ProtocolDetail {
  const p = data.lendingProtocols[0];
  const snapshots: ProtocolDaySnapshot[] = data.financialsDailySnapshots
    .map((s) => ({
      timestamp: parseInt(s.timestamp),
      tvlUSD: parseF(s.totalValueLockedUSD),
      volumeUSD: parseF(s.dailyBorrowUSD),
      feesUSD: parseF(s.dailyTotalRevenueUSD),
    }))
    .sort((a, b) => a.timestamp - b.timestamp);

  const clean = filterFeeOutliers(snapshots);
  const snapshotVolumeSum = clean.reduce((acc, s) => acc + s.volumeUSD, 0);
  const snapshotFeesSum = clean.reduce((acc, s) => acc + s.feesUSD, 0);

  return {
    summary: computeSummary(
      slug,
      parseF(p?.totalValueLockedUSD),
      sanitizeCumulative(parseF(p?.cumulativeBorrowUSD), snapshotVolumeSum),
      sanitizeCumulative(parseF(p?.cumulativeTotalRevenueUSD), snapshotFeesSum),
      clean,
      { totalBorrowUSD: parseF(p?.totalBorrowBalanceUSD) },
    ),
    snapshots: clean,
  };
}

function normalizeMessariStaking(slug: string, data: MessariStakingData): ProtocolDetail {
  const p = data.protocols[0];

  // Estimate the daily fee from the cumulative protocol/supply-side ratio. Most
  // staking deployments leave dailyProtocolSideRevenueUSD at 0 even though the
  // cumulative is correct, so we back-derive it for a continuous fees chart.
  const cumulativeSupply = parseF(p?.cumulativeSupplySideRevenueUSD);
  const cumulativeProtocol = parseF(p?.cumulativeProtocolSideRevenueUSD);
  const protocolFeeRatio = cumulativeSupply > 0
    ? cumulativeProtocol / cumulativeSupply
    : 0;

  const snapshots: ProtocolDaySnapshot[] = data.financialsDailySnapshots
    .map((s) => {
      const supply = parseF(s.dailySupplySideRevenueUSD);
      const reportedProtocol = parseF(s.dailyProtocolSideRevenueUSD);
      // Use the reported daily fee if present, else estimate from the ratio.
      const fees = reportedProtocol > 0 ? reportedProtocol : supply * protocolFeeRatio;
      return {
        timestamp: parseInt(s.timestamp),
        tvlUSD: parseF(s.totalValueLockedUSD),
        volumeUSD: supply,
        feesUSD: fees,
      };
    })
    .sort((a, b) => a.timestamp - b.timestamp);

  const clean = filterFeeOutliers(snapshots);
  const snapshotVolumeSum = clean.reduce((acc, s) => acc + s.volumeUSD, 0);
  const snapshotFeesSum = clean.reduce((acc, s) => acc + s.feesUSD, 0);

  // Estimate APR from the most recent 30 days of supply-side revenue vs current TVL.
  const tvl = parseF(p?.totalValueLockedUSD);
  const last30 = clean.slice(-30);
  const last30Yield = last30.reduce((sum, d) => sum + d.volumeUSD, 0);
  const stakingAPR = tvl > 0 && last30.length > 0
    ? (last30Yield / tvl) * (365 / last30.length) * 100
    : 0;

  return {
    summary: computeSummary(
      slug,
      tvl,
      sanitizeCumulative(cumulativeSupply, snapshotVolumeSum),
      sanitizeCumulative(cumulativeProtocol, snapshotFeesSum),
      clean,
      { stakingAPR },
    ),
    snapshots: clean,
  };
}

function normalizeMessariYield(slug: string, data: MessariYieldData): ProtocolDetail {
  // Same back-derivation pattern as normalizeMessariStaking: yield-aggregator
  // subgraphs leave dailyProtocolSideRevenueUSD at 0 in snapshots while the
  // cumulative figure is correct. We back-derive a daily protocol fee using
  // the cumulative protocol/supply ratio so the fees chart renders.
  const p = data.yieldAggregators[0];
  const cumulativeSupply = parseF(p?.cumulativeSupplySideRevenueUSD);
  const cumulativeProtocol = parseF(p?.cumulativeProtocolSideRevenueUSD);
  const protocolFeeRatio = cumulativeSupply > 0
    ? cumulativeProtocol / cumulativeSupply
    : 0;

  const snapshots: ProtocolDaySnapshot[] = data.financialsDailySnapshots
    .map((s) => {
      const supply = parseF(s.dailySupplySideRevenueUSD);
      const reportedProtocol = parseF(s.dailyProtocolSideRevenueUSD);
      const fees = reportedProtocol > 0 ? reportedProtocol : supply * protocolFeeRatio;
      return {
        timestamp: parseInt(s.timestamp),
        tvlUSD: parseF(s.totalValueLockedUSD),
        volumeUSD: supply,
        feesUSD: fees,
      };
    })
    .sort((a, b) => a.timestamp - b.timestamp);

  const clean = filterFeeOutliers(snapshots);
  const snapshotVolumeSum = clean.reduce((acc, s) => acc + s.volumeUSD, 0);
  const snapshotFeesSum = clean.reduce((acc, s) => acc + s.feesUSD, 0);

  // 30d-window APY estimate, identical formula to Liquid Staking.
  const tvl = parseF(p?.totalValueLockedUSD);
  const last30 = clean.slice(-30);
  const last30Yield = last30.reduce((sum, d) => sum + d.volumeUSD, 0);
  const stakingAPR = tvl > 0 && last30.length > 0
    ? (last30Yield / tvl) * (365 / last30.length) * 100
    : 0;

  return {
    summary: computeSummary(
      slug,
      tvl,
      sanitizeCumulative(cumulativeSupply, snapshotVolumeSum),
      sanitizeCumulative(cumulativeProtocol, snapshotFeesSum),
      clean,
      { stakingAPR },
    ),
    snapshots: clean,
  };
}

function normalizeUniswapV2(slug: string, data: UniswapV2Data): ProtocolDetail {
  const f = data.uniswapFactory;
  const totalVolume = parseF(f?.totalVolumeUSD);
  const snapshots: ProtocolDaySnapshot[] = data.uniswapDayDatas
    .map((s) => {
      const volumeUSD = parseF(s.dailyVolumeUSD);
      return {
        timestamp: parseInt(s.date),
        tvlUSD: parseF(s.totalLiquidityUSD),
        volumeUSD,
        feesUSD: volumeUSD * UNISWAP_V2_FEE_RATE,
      };
    })
    .sort((a, b) => a.timestamp - b.timestamp);

  const clean = filterFeeOutliers(snapshots);
  return {
    summary: computeSummary(
      slug,
      parseF(f?.totalLiquidityUSD),
      totalVolume,
      totalVolume * UNISWAP_V2_FEE_RATE,
      clean,
    ),
    snapshots: clean,
  };
}

function normalizeEtherFi(
  slug: string,
  rebases: EtherFiData['rebaseEvents'],
  ethPriceUSD: number,
): ProtocolDetail {
  if (rebases.length === 0 || ethPriceUSD <= 0) {
    return {
      summary: computeSummary(slug, 0, 0, 0, []),
      snapshots: [],
    };
  }

  // Group rebases by UTC day, keeping the last event of each day.
  const byDay = new Map<number, EtherFiData['rebaseEvents'][number]>();
  for (const r of rebases) {
    const day = Math.floor(parseInt(r.timestamp) / 86400);
    const existing = byDay.get(day);
    if (!existing || parseInt(r.timestamp) > parseInt(existing.timestamp)) {
      byDay.set(day, r);
    }
  }
  const sorted = Array.from(byDay.values()).sort(
    (a, b) => parseInt(a.timestamp) - parseInt(b.timestamp),
  );

  const latest = sorted[sorted.length - 1];
  const tvlUSD = (parseFloat(latest.totalEthLocked) / 1e18) * ethPriceUSD;

  const snapshots: ProtocolDaySnapshot[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const sharesPrev = parseFloat(prev.totalEEthShares) / 1e18;
    const sharesCurr = parseFloat(curr.totalEEthShares) / 1e18;
    const ethPrev = parseFloat(prev.totalEthLocked) / 1e18;
    const ethCurr = parseFloat(curr.totalEthLocked) / 1e18;
    const pricePrev = sharesPrev > 0 ? ethPrev / sharesPrev : 1;
    const priceCurr = sharesCurr > 0 ? ethCurr / sharesCurr : 1;
    const yieldEth = Math.max(0, sharesPrev * (priceCurr - pricePrev));
    const yieldUSD = yieldEth * ethPriceUSD;
    snapshots.push({
      timestamp: parseInt(curr.timestamp),
      tvlUSD: ethCurr * ethPriceUSD,
      volumeUSD: yieldUSD,
      feesUSD: yieldUSD * ETHERFI_PROTOCOL_FEE_RATIO,
    });
  }

  const clean = filterFeeOutliers(snapshots);
  const cumulativeYield = clean.reduce((sum, s) => sum + s.volumeUSD, 0);
  const cumulativeFees = clean.reduce((sum, s) => sum + s.feesUSD, 0);

  const last30 = clean.slice(-30);
  const last30Yield = last30.reduce((sum, s) => sum + s.volumeUSD, 0);
  const stakingAPR = tvlUSD > 0 && last30.length > 0
    ? (last30Yield / tvlUSD) * (365 / last30.length) * 100
    : 0;

  return {
    summary: computeSummary(slug, tvlUSD, cumulativeYield, cumulativeFees, clean, { stakingAPR }),
    snapshots: clean,
  };
}

function normalizeUniswapV3(slug: string, data: UniswapV3Data): ProtocolDetail {
  const f = data.factories[0];
  const snapshots: ProtocolDaySnapshot[] = data.uniswapDayDatas
    .map((s) => ({
      timestamp: parseInt(s.date),
      tvlUSD: parseF(s.tvlUSD),
      volumeUSD: parseF(s.volumeUSD),
      feesUSD: parseF(s.feesUSD),
    }))
    .sort((a, b) => a.timestamp - b.timestamp);

  const clean = filterFeeOutliers(snapshots);
  return {
    summary: computeSummary(
      slug,
      parseF(f?.totalValueLockedUSD),
      parseF(f?.totalVolumeUSD),
      parseF(f?.totalFeesUSD),
      clean,
    ),
    snapshots: clean,
  };
}

// --- Public API ---

export async function fetchProtocolDetail(config: ProtocolConfig): Promise<ProtocolDetail> {
  switch (config.schemaType) {
    case 'messari-dex': {
      const data = await queryProtocolSubgraph<MessariDexData>(config.subgraphId, MESSARI_DEX_QUERY);
      return normalizeMessariDex(config.slug, data);
    }
    case 'messari-lending': {
      const data = await queryProtocolSubgraph<MessariLendingData>(config.subgraphId, MESSARI_LENDING_QUERY);
      return normalizeMessariLending(config.slug, data);
    }
    case 'messari-staking': {
      const data = await queryProtocolSubgraph<MessariStakingData>(config.subgraphId, MESSARI_STAKING_QUERY);
      return normalizeMessariStaking(config.slug, data);
    }
    case 'messari-yield': {
      const data = await queryProtocolSubgraph<MessariYieldData>(config.subgraphId, MESSARI_YIELD_QUERY);
      return normalizeMessariYield(config.slug, data);
    }
    case 'uniswap-v2': {
      const data = await queryProtocolSubgraph<UniswapV2Data>(config.subgraphId, UNISWAP_V2_QUERY);
      return normalizeUniswapV2(config.slug, data);
    }
    case 'uniswap-v3': {
      const data = await queryProtocolSubgraph<UniswapV3Data>(config.subgraphId, UNISWAP_V3_QUERY);
      return normalizeUniswapV3(config.slug, data);
    }
    case 'etherfi-native': {
      const since = Math.floor(Date.now() / 1000) - 95 * 86400;
      const query = ETHERFI_QUERY.replace('$SINCE', String(since));
      const [rebases, price] = await Promise.all([
        queryProtocolSubgraph<EtherFiData>(config.subgraphId, query),
        queryProtocolSubgraph<EthPriceData>(UNISWAP_V3_ETH_MAINNET_SUBGRAPH, ETH_PRICE_QUERY),
      ]);
      const ethPriceUSD = parseF(price.bundles[0]?.ethPriceUSD);
      return normalizeEtherFi(config.slug, rebases.rebaseEvents, ethPriceUSD);
    }
    case 'polymarket': {
      const [orderbook, oi, main, resolution] = await Promise.all([
        queryDeployment<PolymarketOrderbookData>(config.subgraphId, POLYMARKET_ORDERBOOK_QUERY),
        queryDeployment<PolymarketOIData>(POLYMARKET_OI_DEPLOYMENT, POLYMARKET_OI_QUERY),
        queryDeployment<PolymarketMainData>(POLYMARKET_MAIN_DEPLOYMENT, POLYMARKET_MAIN_QUERY),
        queryDeployment<PolymarketResolutionData>(POLYMARKET_RESOLUTION_DEPLOYMENT, POLYMARKET_RESOLUTION_QUERY),
      ]);
      return normalizePolymarket(config.slug, orderbook, oi, main, resolution);
    }
  }
}

export async function fetchProtocolSummary(config: ProtocolConfig): Promise<ProtocolSummary | null> {
  try {
    const detail = await fetchProtocolDetail(config);
    return detail.summary;
  } catch {
    return null;
  }
}
