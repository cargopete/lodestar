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
  // RWA-specific extras. Lending-shaped RWA protocols issue infrequent, large
  // institutional drawdowns rather than continuous spot loans, so we surface
  // pool/borrower/default metrics that better reflect the asset class.
  rwaDrawnBalanceUSD?: number;
  rwaCumulativeBorrowUSD?: number;
  rwaPoolCount?: number;
  rwaUniqueBorrowers?: number;
  rwaOpenPositionCount?: number;
  rwaDefaultsUSD?: number;
  // Perpetuals-specific extras. Open interest is the headline state metric
  // for derivatives venues (the value of all currently-open positions);
  // distinct from TVL which is LP capital backing the venue.
  perpOpenInterestUSD?: number;
  perpLongOpenInterestUSD?: number;
  perpShortOpenInterestUSD?: number;
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
    /** Human-readable market question, hydrated from the Polymarket CLOB API. */
    title?: string;
    /** URL slug for `polymarket.com/event/{slug}`, if returned by the CLOB API. */
    slug?: string;
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

// --- Messari RWA schema (uncollateralised real-world credit pools) ---
//
// Same `lendingProtocols` shape as standard Messari Lending but the meaningful
// daily activity is interest accrual, not new borrowing. RWA originations
// happen in discrete institutional drawdowns (often months apart) so a
// dailyBorrowUSD-driven volume series reads as flat zero for healthy
// protocols. We map the headline cumulative + daily volume metrics to the
// revenue stream and expose pool/borrower/default extras.

interface MessariRwaData {
  lendingProtocols: Array<{
    totalValueLockedUSD: string;
    totalDepositBalanceUSD: string;
    totalBorrowBalanceUSD: string;
    cumulativeBorrowUSD: string;
    cumulativeTotalRevenueUSD: string;
    cumulativeLiquidateUSD: string;
    totalPoolCount: number;
    openPositionCount: number;
    cumulativeUniqueBorrowers: number;
  }>;
  financialsDailySnapshots: Array<{
    timestamp: string;
    totalValueLockedUSD: string;
    dailyTotalRevenueUSD: string;
  }>;
}

const MESSARI_RWA_QUERY = `{
  lendingProtocols(first: 1) {
    totalValueLockedUSD
    totalDepositBalanceUSD
    totalBorrowBalanceUSD
    cumulativeBorrowUSD
    cumulativeTotalRevenueUSD
    cumulativeLiquidateUSD
    totalPoolCount
    openPositionCount
    cumulativeUniqueBorrowers
  }
  financialsDailySnapshots(first: 90, orderBy: timestamp, orderDirection: desc) {
    timestamp
    totalValueLockedUSD
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

// --- Messari Bridge schema (Hop, Stargate, cBridge, Axelar, Across V2 etc.) ---
//
// Standard Messari bridge template: protocol-level `bridgeProtocols` plus
// `financialsDailySnapshots` with per-chain volumeIn / volumeOut series.
// We use cumulativeTotalVolumeUSD as the headline cumulative metric and
// dailyVolumeOutUSD as the daily series so the volume chart shows what
// users sent through the bridge from this chain.

interface MessariBridgeData {
  bridgeProtocols: Array<{
    totalValueLockedUSD: string;
    cumulativeTotalVolumeUSD: string;
    cumulativeTotalRevenueUSD: string;
  }>;
  financialsDailySnapshots: Array<{
    timestamp: string;
    totalValueLockedUSD: string;
    dailyVolumeOutUSD: string;
    dailyTotalRevenueUSD: string;
  }>;
}

const MESSARI_BRIDGE_QUERY = `{
  bridgeProtocols(first: 1) {
    totalValueLockedUSD
    cumulativeTotalVolumeUSD
    cumulativeTotalRevenueUSD
  }
  financialsDailySnapshots(first: 90, orderBy: timestamp, orderDirection: desc) {
    timestamp
    totalValueLockedUSD
    dailyVolumeOutUSD
    dailyTotalRevenueUSD
  }
}`;

// --- Messari Perpetuals schema (Kwenta, MUX, GMX-shape protocols) ---
//
// Standard Messari derivPerpProtocols template. TVL is LP capital backing
// the venue; the headline activity metric is cumulative trade volume
// (cumulativeVolumeUSD) and the headline state metric is total open
// interest (totalOpenInterestUSD), which we surface as a separate hero
// stat distinct from TVL.

interface MessariPerpData {
  derivPerpProtocols: Array<{
    totalValueLockedUSD: string;
    cumulativeVolumeUSD: string;
    cumulativeTotalRevenueUSD: string;
    totalOpenInterestUSD: string;
    longOpenInterestUSD: string;
    shortOpenInterestUSD: string;
  }>;
  financialsDailySnapshots: Array<{
    timestamp: string;
    totalValueLockedUSD: string;
    dailyVolumeUSD: string;
    dailyTotalRevenueUSD: string;
  }>;
}

const MESSARI_PERP_QUERY = `{
  derivPerpProtocols(first: 1) {
    totalValueLockedUSD
    cumulativeVolumeUSD
    cumulativeTotalRevenueUSD
    totalOpenInterestUSD
    longOpenInterestUSD
    shortOpenInterestUSD
  }
  financialsDailySnapshots(first: 90, orderBy: timestamp, orderDirection: desc) {
    timestamp
    totalValueLockedUSD
    dailyVolumeUSD
    dailyTotalRevenueUSD
  }
}`;

// --- GMX V2 Synthetics schema adapter ---
//
// The gmx-io team publishes the canonical synthetics-stats subgraph for
// GMX V2 with their own custom schema (positionVolumeInfo,
// collectedMarketFeesInfo, etc.). Rather than running a competing
// Messari-perp subgraph, this adapter aggregates synthetics-stats rows
// client-side into the same ProtocolDetail shape lodestar uses for every
// other Perpetuals protocol.
//
// USD scale: synthetics-stats encodes USD with 30 decimal places (1e30).
// We rescale to plain USD floats at parse time.
//
// v1 limitations -- TVL and Open Interest both come back as 0:
//   - TVL: GM market pool value isn't a single field on synthetics-stats.
//     Computing it requires the latest PoolAmountUpdate per market times
//     the latest TokenPrice, summed across all markets -- non-trivial,
//     deferred.
//   - Open Interest: synthetics-stats doesn't expose OI as a queryable
//     scalar; deriving it from positionIncrease/Decrease deltas would
//     require pagination across the full event history.
// Volume, fees, and the 90-day daily series are accurate.

const GMX_USD_SCALE = 1e30;

interface GmxV2VolumeRow {
  timestamp: string;
  volumeUsd: string;
}
interface GmxV2FeeRow {
  timestampGroup: string;
  feeUsdForPool: string;
}

interface GmxV2SyntheticsData {
  totalPosition: GmxV2VolumeRow[];
  totalFees: GmxV2FeeRow[];
  // 5 paged 1000-row windows of daily volume rows, 5000 total. With ~100
  // market-day rows per UTC day on Arbitrum that resolves to roughly 50 days
  // of coverage -- enough for a 30d window and the bulk of the 90-day chart.
  dp0: GmxV2VolumeRow[];
  dp1: GmxV2VolumeRow[];
  dp2: GmxV2VolumeRow[];
  dp3: GmxV2VolumeRow[];
  dp4: GmxV2VolumeRow[];
  df0: GmxV2FeeRow[];
  df1: GmxV2FeeRow[];
  df2: GmxV2FeeRow[];
  df3: GmxV2FeeRow[];
  df4: GmxV2FeeRow[];
}

// Synthetics-stats stores period rollups ("total", "1d", "1h"). Each row is
// keyed per market or token pair, so we sum across rows in the normalizer.
// Daily windows use 5 paginated 1000-row queries (`dp0..dp4`, `df0..df4`)
// to bypass the 1000-row Graph page cap; without pagination the most-recent
// 100 markets-per-day eat the whole window in ~10 days.
const GMX_V2_SYNTHETICS_QUERY = `{
  totalPosition: positionVolumeInfos(first: 1000, where: {period: "total"}) { timestamp volumeUsd }
  totalFees: collectedMarketFeesInfos(first: 1000, where: {period: "total"}) { timestampGroup feeUsdForPool }
  dp0: positionVolumeInfos(first: 1000, where: {period: "1d"}, orderBy: timestamp, orderDirection: desc) { timestamp volumeUsd }
  dp1: positionVolumeInfos(first: 1000, where: {period: "1d"}, orderBy: timestamp, orderDirection: desc, skip: 1000) { timestamp volumeUsd }
  dp2: positionVolumeInfos(first: 1000, where: {period: "1d"}, orderBy: timestamp, orderDirection: desc, skip: 2000) { timestamp volumeUsd }
  dp3: positionVolumeInfos(first: 1000, where: {period: "1d"}, orderBy: timestamp, orderDirection: desc, skip: 3000) { timestamp volumeUsd }
  dp4: positionVolumeInfos(first: 1000, where: {period: "1d"}, orderBy: timestamp, orderDirection: desc, skip: 4000) { timestamp volumeUsd }
  df0: collectedMarketFeesInfos(first: 1000, where: {period: "1d"}, orderBy: timestampGroup, orderDirection: desc) { timestampGroup feeUsdForPool }
  df1: collectedMarketFeesInfos(first: 1000, where: {period: "1d"}, orderBy: timestampGroup, orderDirection: desc, skip: 1000) { timestampGroup feeUsdForPool }
  df2: collectedMarketFeesInfos(first: 1000, where: {period: "1d"}, orderBy: timestampGroup, orderDirection: desc, skip: 2000) { timestampGroup feeUsdForPool }
  df3: collectedMarketFeesInfos(first: 1000, where: {period: "1d"}, orderBy: timestampGroup, orderDirection: desc, skip: 3000) { timestampGroup feeUsdForPool }
  df4: collectedMarketFeesInfos(first: 1000, where: {period: "1d"}, orderBy: timestampGroup, orderDirection: desc, skip: 4000) { timestampGroup feeUsdForPool }
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
// "Disputed" headline. We cap the disputed bucket at 250 — enough for the
// "250+ tracked" banner while keeping the resolution-subgraph response fast.
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
  disputedSample: marketResolutions(first: 250, where: {wasDisputed: true}) {
    id
  }
}`;

// Polymarket CLOB API exposes per-condition market metadata — title, slug,
// description, status, etc. Used to hydrate top-OI condition IDs into
// human-readable rows in the UI. Hits run inside the cached fetch path so
// the per-condition HTTP cost is amortised over the 1-hour cache window.
const POLYMARKET_CLOB_BASE = 'https://clob.polymarket.com/markets';
const POLYMARKET_CLOB_TIMEOUT_MS = 4000;

interface ClobMarketResponse {
  condition_id?: string;
  question?: string;
  market_slug?: string;
}

async function fetchClobMarket(conditionId: string): Promise<ClobMarketResponse | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), POLYMARKET_CLOB_TIMEOUT_MS);
    const res = await fetch(`${POLYMARKET_CLOB_BASE}/${conditionId}`, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(t);
    if (!res.ok) return null;
    return (await res.json()) as ClobMarketResponse;
  } catch {
    return null;
  }
}

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

// --- Algebra V1 schema (Camelot V3 etc.) ---
//
// Algebra is the concentrated-liquidity engine Camelot V3 uses. Same Factory
// + day-data shape as Uniswap V3 except the day entity is `algebraDayDatas`.
// We fetch with the renamed entity and reuse normalizeUniswapV3 unchanged.

interface AlgebraV1Data {
  factories: Array<{
    totalVolumeUSD: string;
    totalValueLockedUSD: string;
    totalFeesUSD: string;
    txCount: string;
  }>;
  algebraDayDatas: Array<{
    date: string;
    volumeUSD: string;
    feesUSD: string;
    tvlUSD: string;
  }>;
}

const ALGEBRA_V1_QUERY = `{
  factories(first: 1) {
    totalVolumeUSD
    totalValueLockedUSD
    totalFeesUSD
    txCount
  }
  algebraDayDatas(first: 90, orderBy: date, orderDirection: desc) {
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

function normalizeMessariRwa(slug: string, data: MessariRwaData): ProtocolDetail {
  const p = data.lendingProtocols[0];
  // For RWA, the "volume" series is daily interest accrued. Real-world credit
  // pools earn interest on outstanding principal continuously even when no
  // new originations happen, so this gives a non-zero daily series for
  // healthy harvest-mode protocols (e.g. Goldfinch).
  const snapshots: ProtocolDaySnapshot[] = data.financialsDailySnapshots
    .map((s) => {
      const interestUSD = parseF(s.dailyTotalRevenueUSD);
      return {
        timestamp: parseInt(s.timestamp),
        tvlUSD: parseF(s.totalValueLockedUSD),
        // Volume = interest earned. Fees = the same number (the interest is
        // the fee in this asset class) so the fees panel renders meaningfully.
        volumeUSD: interestUSD,
        feesUSD: interestUSD,
      };
    })
    .sort((a, b) => a.timestamp - b.timestamp);

  const clean = filterFeeOutliers(snapshots);
  const snapshotVolumeSum = clean.reduce((acc, s) => acc + s.volumeUSD, 0);

  return {
    summary: computeSummary(
      slug,
      parseF(p?.totalValueLockedUSD),
      // Cumulative volume = lifetime interest paid out. Sanitize against the
      // 90-day snapshot sum the same way the other Messari fetchers do.
      sanitizeCumulative(parseF(p?.cumulativeTotalRevenueUSD), snapshotVolumeSum),
      sanitizeCumulative(parseF(p?.cumulativeTotalRevenueUSD), snapshotVolumeSum),
      clean,
      {
        totalBorrowUSD: parseF(p?.totalBorrowBalanceUSD),
        rwaDrawnBalanceUSD: parseF(p?.totalBorrowBalanceUSD),
        rwaCumulativeBorrowUSD: parseF(p?.cumulativeBorrowUSD),
        rwaPoolCount: p?.totalPoolCount ?? 0,
        rwaUniqueBorrowers: p?.cumulativeUniqueBorrowers ?? 0,
        rwaOpenPositionCount: p?.openPositionCount ?? 0,
        rwaDefaultsUSD: parseF(p?.cumulativeLiquidateUSD),
      },
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

function normalizeMessariBridge(slug: string, data: MessariBridgeData): ProtocolDetail {
  const p = data.bridgeProtocols[0];
  const snapshots: ProtocolDaySnapshot[] = data.financialsDailySnapshots
    .map((s) => ({
      timestamp: parseInt(s.timestamp),
      tvlUSD: parseF(s.totalValueLockedUSD),
      volumeUSD: parseF(s.dailyVolumeOutUSD),
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
      sanitizeCumulative(parseF(p?.cumulativeTotalVolumeUSD), snapshotVolumeSum),
      sanitizeCumulative(parseF(p?.cumulativeTotalRevenueUSD), snapshotFeesSum),
      clean,
    ),
    snapshots: clean,
  };
}

function normalizeMessariPerp(slug: string, data: MessariPerpData): ProtocolDetail {
  const p = data.derivPerpProtocols[0];
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
      {
        perpOpenInterestUSD: parseF(p?.totalOpenInterestUSD),
        perpLongOpenInterestUSD: parseF(p?.longOpenInterestUSD),
        perpShortOpenInterestUSD: parseF(p?.shortOpenInterestUSD),
      },
    ),
    snapshots: clean,
  };
}

function normalizeGmxV2Synthetics(slug: string, data: GmxV2SyntheticsData): ProtocolDetail {
  // Sum cumulative volume across every (collateral, index) market row.
  let cumulativeVolume = 0;
  for (const r of data.totalPosition) {
    cumulativeVolume += parseF(r.volumeUsd) / GMX_USD_SCALE;
  }
  // Sum cumulative pool-side fees across every market.
  let cumulativeFees = 0;
  for (const r of data.totalFees) {
    cumulativeFees += parseF(r.feeUsdForPool) / GMX_USD_SCALE;
  }

  // Concatenate the paginated daily windows (dp0..dp4, df0..df4) before
  // bucketing by UTC day.
  const dailyPositionRows = data.dp0
    .concat(data.dp1, data.dp2, data.dp3, data.dp4);
  const dailyFeeRows = data.df0
    .concat(data.df1, data.df2, data.df3, data.df4);

  const dailyVolByTs = new Map<number, number>();
  for (const r of dailyPositionRows) {
    const ts = parseInt(r.timestamp);
    const v = parseF(r.volumeUsd) / GMX_USD_SCALE;
    dailyVolByTs.set(ts, (dailyVolByTs.get(ts) ?? 0) + v);
  }
  const dailyFeeByTs = new Map<number, number>();
  for (const r of dailyFeeRows) {
    const ts = parseInt(r.timestampGroup);
    const v = parseF(r.feeUsdForPool) / GMX_USD_SCALE;
    dailyFeeByTs.set(ts, (dailyFeeByTs.get(ts) ?? 0) + v);
  }

  // Materialise the snapshot series, taking the *intersection* of volume+fee
  // day keys. The volume and fee paginated queries return rows in slightly
  // different orderings across markets, so the leading edge of each window
  // covers a different stretch -- earlier we took the union and ended up with
  // 4 days near the beginning where vol=0 but fees>0 (or vice-versa), which
  // surfaced as misleading flat-zero bars on the chart. Intersection drops
  // those partial days so every rendered bar has both metrics.
  const allDays = [...dailyVolByTs.keys()].filter((ts) => dailyFeeByTs.has(ts));
  const snapshots: ProtocolDaySnapshot[] = allDays
    .sort((a, b) => a - b)
    .map((ts) => ({
      timestamp: ts,
      tvlUSD: 0, // v1 limitation -- see GMX V2 schema notes.
      volumeUSD: dailyVolByTs.get(ts) ?? 0,
      feesUSD: dailyFeeByTs.get(ts) ?? 0,
    }));

  const clean = filterFeeOutliers(snapshots);
  const snapshotVolumeSum = clean.reduce((acc, s) => acc + s.volumeUSD, 0);
  const snapshotFeesSum = clean.reduce((acc, s) => acc + s.feesUSD, 0);

  return {
    summary: computeSummary(
      slug,
      0, // v1: TVL deferred until per-market pool valuation lands.
      sanitizeCumulative(cumulativeVolume, snapshotVolumeSum),
      sanitizeCumulative(cumulativeFees, snapshotFeesSum),
      clean,
    ),
    snapshots: clean,
  };
}

// --- Balancer V2 schema adapter ---
//
// Balancer Labs maintains a single team-native schema deployed across
// Ethereum, Polygon, Arbitrum, Avalanche, and Gnosis. The top-level
// `balancers` entity exposes cumulative liquidity/volume/fees, and
// `balancerSnapshots` stores running cumulative totals per UTC day
// (not deltas). This adapter converts the cumulative-snapshot shape
// into the daily-delta convention used by every other DEX entry by
// subtracting consecutive snapshots.
//
// Caveat: protocol-level `totalSwapVolume` and `totalSwapFee` are
// unreliable across the Balancer fleet -- the Ethereum subgraph
// overflowed to ~$1.6e16 in May 2026, Arbitrum sits at ~$4.4e13,
// and bb-* pool rebasing has historically inflated counts on Polygon
// too. The snapshot deltas, by contrast, agree with on-chain reality
// (independently verified against $2.5M/day on Eth, $250K/day on
// Polygon). This adapter therefore always exposes cumulative as the
// 90-day snapshot-window sum -- honest about what we have rather than
// optimistic about what the schema claims.

interface BalancerV2Snapshot {
  timestamp: string;
  totalLiquidity: string;
  totalSwapVolume: string;
  totalSwapFee: string;
}

interface BalancerV2Protocol {
  id: string;
  totalLiquidity: string;
  totalSwapVolume: string;
  totalSwapFee: string;
  poolCount: number;
}

interface BalancerV2Data {
  balancers: BalancerV2Protocol[];
  balancerSnapshots: BalancerV2Snapshot[];
}

const BALANCER_V2_QUERY = `{
  balancers(first: 1) {
    id
    totalLiquidity
    totalSwapVolume
    totalSwapFee
    poolCount
  }
  balancerSnapshots(first: 90, orderBy: timestamp, orderDirection: desc) {
    timestamp
    totalLiquidity
    totalSwapVolume
    totalSwapFee
  }
}`;

function normalizeBalancerV2(slug: string, data: BalancerV2Data): ProtocolDetail {
  const p = data.balancers[0];
  const ascending = [...data.balancerSnapshots].sort(
    (a, b) => parseInt(a.timestamp) - parseInt(b.timestamp),
  );

  // Snapshots store cumulative totals; convert to daily deltas. Skip
  // the first snapshot (no prior anchor). Clamp negative deltas to 0
  // so a one-off cumVolume regeneration doesn't poison the series.
  const snapshots: ProtocolDaySnapshot[] = [];
  for (let i = 1; i < ascending.length; i++) {
    const curr = ascending[i];
    const prev = ascending[i - 1];
    const dailyVol = Math.max(0, parseF(curr.totalSwapVolume) - parseF(prev.totalSwapVolume));
    const dailyFee = Math.max(0, parseF(curr.totalSwapFee) - parseF(prev.totalSwapFee));
    snapshots.push({
      timestamp: parseInt(curr.timestamp),
      tvlUSD: parseF(curr.totalLiquidity),
      volumeUSD: dailyVol,
      feesUSD: dailyFee,
    });
  }

  const clean = filterFeeOutliers(snapshots);
  const snapshotVolumeSum = clean.reduce((acc, s) => acc + s.volumeUSD, 0);
  const snapshotFeesSum = clean.reduce((acc, s) => acc + s.feesUSD, 0);

  return {
    summary: computeSummary(
      slug,
      parseF(p?.totalLiquidity),
      snapshotVolumeSum,
      snapshotFeesSum,
      clean,
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
    case 'messari-rwa': {
      const data = await queryProtocolSubgraph<MessariRwaData>(config.subgraphId, MESSARI_RWA_QUERY);
      return normalizeMessariRwa(config.slug, data);
    }
    case 'messari-staking': {
      const data = await queryProtocolSubgraph<MessariStakingData>(config.subgraphId, MESSARI_STAKING_QUERY);
      return normalizeMessariStaking(config.slug, data);
    }
    case 'messari-yield': {
      const data = await queryProtocolSubgraph<MessariYieldData>(config.subgraphId, MESSARI_YIELD_QUERY);
      return normalizeMessariYield(config.slug, data);
    }
    case 'messari-bridge': {
      const data = await queryProtocolSubgraph<MessariBridgeData>(config.subgraphId, MESSARI_BRIDGE_QUERY);
      return normalizeMessariBridge(config.slug, data);
    }
    case 'messari-perp': {
      const data = await queryProtocolSubgraph<MessariPerpData>(config.subgraphId, MESSARI_PERP_QUERY);
      return normalizeMessariPerp(config.slug, data);
    }
    case 'gmx-v2-synthetics': {
      const data = await queryProtocolSubgraph<GmxV2SyntheticsData>(config.subgraphId, GMX_V2_SYNTHETICS_QUERY);
      return normalizeGmxV2Synthetics(config.slug, data);
    }
    case 'balancer-v2': {
      const data = await queryProtocolSubgraph<BalancerV2Data>(config.subgraphId, BALANCER_V2_QUERY);
      return normalizeBalancerV2(config.slug, data);
    }
    case 'uniswap-v2': {
      const data = await queryProtocolSubgraph<UniswapV2Data>(config.subgraphId, UNISWAP_V2_QUERY);
      return normalizeUniswapV2(config.slug, data);
    }
    case 'uniswap-v3': {
      const data = await queryProtocolSubgraph<UniswapV3Data>(config.subgraphId, UNISWAP_V3_QUERY);
      return normalizeUniswapV3(config.slug, data);
    }
    case 'algebra-v1': {
      const data = await queryProtocolSubgraph<AlgebraV1Data>(config.subgraphId, ALGEBRA_V1_QUERY);
      return normalizeUniswapV3(config.slug, {
        factories: data.factories,
        uniswapDayDatas: data.algebraDayDatas,
      });
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
      const detail = normalizePolymarket(config.slug, orderbook, oi, main, resolution);
      // Hydrate top-OI condition IDs with human-readable market questions from
      // the Polymarket CLOB API. Fan out in parallel and tolerate per-request
      // failures so a single 404/timeout doesn't blank the whole table.
      if (detail.predictionMarkets) {
        const top = detail.predictionMarkets.topMarketsByOI;
        const lookups = await Promise.allSettled(top.map((m) => fetchClobMarket(m.id)));
        detail.predictionMarkets.topMarketsByOI = top.map((m, i) => {
          const r = lookups[i];
          if (r.status !== 'fulfilled' || !r.value) return m;
          return { ...m, title: r.value.question, slug: r.value.market_slug };
        });
      }
      return detail;
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
