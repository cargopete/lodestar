/**
 * Lending-market data for tokens used as collateral or borrow assets.
 * Sources Aave V3 across all five Graph-Network deployments (Ethereum,
 * Arbitrum, Base, Polygon, Optimism) in parallel. Future iterations can
 * layer in Compound, Morpho, Spark, etc. with the same shape.
 *
 * Why this exists: Token API has no notion of "listed in lending markets",
 * so the directory and detail page have no signal for whether a token
 * functions as collateral. Aave V3 alone gives us total supplied, total
 * borrowed, utilization and rates per asset for the bulk of the blue-chip
 * universe across the chains we already track.
 *
 * Schema notes (Aave V3 subgraph):
 *  - `liquidityRate` and `variableBorrowRate` are ray (1e27) APR values.
 *    Aave UIs typically display the APR; APY would compound per-second.
 *  - `totalATokenSupply` and `totalCurrentVariableDebt` are in token base
 *    units; divide by `10^decimals` to get human units.
 *  - `price.priceInEth` is misleadingly named — V3 uses USD-denominated
 *    Chainlink feeds with 8 decimals. The field kept its V1/V2 name. Some
 *    reserves return `0` (indexer gap, e.g. WBTC at the time of writing),
 *    so we accept a fallback price from the caller.
 */
import { recordDeficiency } from './deficiencies';

const GW_BASE = 'https://gateway-arbitrum.network.thegraph.com/api';
const RAY = 1e27;
const AAVE_PRICE_DECIMALS = 1e8;

export type LendingChain = 'mainnet' | 'arbitrum' | 'base' | 'polygon' | 'optimism';

interface AaveDeployment {
  chain: LendingChain;
  /** IPFS deployment hash (Qm…). Source: Graph Network gateway. */
  hash: string;
}

// Aave V3 deployments on The Graph Network. Discovered via the
// graph-aave MCP and verified individually against the gateway. The
// gateway accepts deployment hashes through `/deployments/id/<hash>`.
// Exported so smoke tests / coverage scripts can iterate over the same
// list this module queries against.
export const AAVE_V3_DEPLOYMENTS: AaveDeployment[] = [
  { chain: 'mainnet', hash: 'QmX2VfvEspbShTdcjefWeG3CKBVXKWm9naxH6TVhqPb9qY' },
  { chain: 'arbitrum', hash: 'Qmdn5hAZZj3wmWVuksXHtua3E6aWftCDeTFcW8YQ8Lu6pB' },
  { chain: 'base', hash: 'QmXZ53Kzz3L2LvvbGve2ebtLKWMhjjB1a3U2jnUj2YwGCW' },
  { chain: 'polygon', hash: 'QmceoHP3ekxJ6JYqAXhqrVgv8rb9WXumrGe1ZhVZah8Ar5' },
  { chain: 'optimism', hash: 'QmScPH3aFxzFgrie8MMDU4QtFu3CE7nTfsRfSQXiccxBPh' },
];

export interface LendingMarket {
  protocol: 'Aave V3 Core';
  chain: LendingChain;
  /** Lowercased underlying asset address as listed on `chain` — needed for
   *  the per-chain Aave deep link, since L2 token addresses differ from L1. */
  underlyingAsset: string;
  /** Direct link to the Aave reserve-overview page for this asset/chain. */
  aaveMarketUrl: string;
  isActive: boolean;
  isFrozen: boolean;
  borrowingEnabled: boolean;
  collateralEnabled: boolean;
  /** Decimal-adjusted supply in token units. */
  totalSuppliedTokens: number;
  /** USD value of supply. Null when neither subgraph price nor caller fallback resolved. */
  totalSuppliedUsd: number | null;
  /** Decimal-adjusted variable-rate debt in token units. */
  totalBorrowedTokens: number;
  /** USD value of variable-rate debt. */
  totalBorrowedUsd: number | null;
  /** Liquidity available to borrow right now, in token units. Equals
   *  `totalSuppliedTokens - totalBorrowedTokens` modulo any aToken reserves
   *  the protocol holds back; we use the subgraph's `availableLiquidity`
   *  field which is the authoritative figure. */
  availableLiquidityTokens: number;
  /** USD value of `availableLiquidityTokens`. */
  availableLiquidityUsd: number | null;
  /** Borrowed / supplied in token units, 0..1. */
  utilization: number;
  /** Supply APR as a decimal (0.0329 = 3.29%). */
  supplyApr: number;
  /** Variable-rate borrow APR as a decimal. */
  variableBorrowApr: number;
  /** Liquidation threshold in basis points (e.g. 7800 = 78%). Null when not collateralised. */
  liquidationThresholdBps: number | null;
  /** Per-asset supply cap in whole tokens. `null` when uncapped. Aave V3
   *  stores caps as plain integers (no decimal scaling); a cap of 0 means
   *  "no cap" so we fold that to null. */
  supplyCapTokens: number | null;
  /** Per-asset borrow cap in whole tokens. `null` when uncapped. */
  borrowCapTokens: number | null;
  /** USD price actually used to derive `totalSuppliedUsd` /
   *  `totalBorrowedUsd` for this row. Set initially to the per-subgraph
   *  Aave oracle price (or null when the oracle reports 0, e.g. WBTC),
   *  then overwritten by `summariseLending` with the seed's canonical
   *  spot price when one is available — that override is what keeps
   *  cross-chain aggregation on a single price basis. Read this as the
   *  valuation price, not necessarily the protocol's own oracle. */
  priceUsd: number | null;
}

export interface TokenLending {
  /** Per-deployment markets, sorted by `totalSuppliedUsd` desc. */
  markets: LendingMarket[];
  /** Aggregate `totalSuppliedUsd` across markets. Null when no USD figures resolved. */
  totalSuppliedUsd: number | null;
  totalBorrowedUsd: number | null;
  /** Aggregate borrowable liquidity in USD across markets. Null when no
   *  USD figures resolved. */
  availableLiquidityUsd: number | null;
  /** Aggregate utilization, 0..1. Null when no supply. */
  utilization: number | null;
}

interface ReserveRow {
  underlyingAsset: string;
  symbol: string;
  decimals: number;
  isActive: boolean;
  isFrozen: boolean;
  borrowingEnabled: boolean;
  usageAsCollateralEnabled: boolean;
  totalATokenSupply: string;
  totalCurrentVariableDebt: string;
  /** Borrowable liquidity in base units (same scale as totalATokenSupply). */
  availableLiquidity: string | null;
  /** Per-asset cap in WHOLE tokens (no decimal scaling); 0 means uncapped. */
  supplyCap: string | null;
  /** Per-asset cap in WHOLE tokens (no decimal scaling); 0 means uncapped. */
  borrowCap: string | null;
  liquidityRate: string;
  variableBorrowRate: string;
  reserveLiquidationThreshold: string | null;
  price: { priceInEth: string } | null;
}

interface ReservesResponse {
  data?: { reserves: ReserveRow[] };
  errors?: Array<{ message: string }>;
}

function rayToApr(ray: string | null | undefined): number {
  const n = Number(ray ?? '0');
  if (!Number.isFinite(n)) return 0;
  return n / RAY;
}

function tokenUnits(raw: string | null | undefined, decimals: number): number {
  if (!raw) return 0;
  try {
    const big = BigInt(raw.split('.')[0] ?? '0');
    return Number(big) / 10 ** decimals;
  } catch {
    return Number(raw) / 10 ** decimals;
  }
}

const RESERVES_QUERY = `
  query AaveV3Reserves($ids: [Bytes!]!) {
    reserves(where: { underlyingAsset_in: $ids }, first: 200) {
      underlyingAsset
      symbol
      decimals
      isActive
      isFrozen
      borrowingEnabled
      usageAsCollateralEnabled
      totalATokenSupply
      totalCurrentVariableDebt
      availableLiquidity
      supplyCap
      borrowCap
      liquidityRate
      variableBorrowRate
      reserveLiquidationThreshold
      price { priceInEth }
    }
  }
`;

// Aave's reserve-overview routes are scoped by a `marketName` slug; the
// chain key in `LendingChain` lines up cleanly with their convention.
const AAVE_MARKET_NAME: Record<LendingChain, string> = {
  mainnet: 'proto_mainnet_v3',
  arbitrum: 'proto_arbitrum_v3',
  base: 'proto_base_v3',
  polygon: 'proto_polygon_v3',
  optimism: 'proto_optimism_v3',
};

function aaveReserveUrl(chain: LendingChain, underlyingAsset: string): string {
  const market = AAVE_MARKET_NAME[chain];
  const addr = underlyingAsset.toLowerCase();
  return `https://app.aave.com/reserve-overview/?underlyingAsset=${addr}&marketName=${market}`;
}

async function queryDeployment(
  apiKey: string,
  deployment: AaveDeployment,
  contractsLower: string[]
): Promise<LendingMarket[]> {
  if (contractsLower.length === 0) return [];
  const url = `${GW_BASE}/${apiKey}/deployments/id/${deployment.hash}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: RESERVES_QUERY, variables: { ids: contractsLower } }),
  });
  if (!res.ok) throw new Error(`aave v3 ${deployment.chain} ${res.status}`);
  const body = (await res.json()) as ReservesResponse;
  if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join('; '));
  const out: LendingMarket[] = [];
  for (const r of body.data?.reserves ?? []) {
    const decimals = Number(r.decimals) || 18;
    const supplied = tokenUnits(r.totalATokenSupply, decimals);
    const borrowed = tokenUnits(r.totalCurrentVariableDebt, decimals);
    const available = tokenUnits(r.availableLiquidity, decimals);
    const priceUsd = Number(r.price?.priceInEth ?? '0') / AAVE_PRICE_DECIMALS;
    const validPrice = Number.isFinite(priceUsd) && priceUsd > 0 ? priceUsd : null;
    const liqBps = r.reserveLiquidationThreshold ? Number(r.reserveLiquidationThreshold) : null;
    // Caps are plain integers in whole tokens; 0 means uncapped on Aave V3.
    const supplyCapRaw = Number(r.supplyCap ?? '0');
    const borrowCapRaw = Number(r.borrowCap ?? '0');
    out.push({
      protocol: 'Aave V3 Core',
      chain: deployment.chain,
      underlyingAsset: r.underlyingAsset.toLowerCase(),
      aaveMarketUrl: aaveReserveUrl(deployment.chain, r.underlyingAsset),
      isActive: !!r.isActive,
      isFrozen: !!r.isFrozen,
      borrowingEnabled: !!r.borrowingEnabled,
      collateralEnabled: !!r.usageAsCollateralEnabled,
      totalSuppliedTokens: supplied,
      totalSuppliedUsd: validPrice != null ? supplied * validPrice : null,
      totalBorrowedTokens: borrowed,
      totalBorrowedUsd: validPrice != null ? borrowed * validPrice : null,
      availableLiquidityTokens: available,
      availableLiquidityUsd: validPrice != null ? available * validPrice : null,
      utilization: supplied > 0 ? Math.min(1, borrowed / supplied) : 0,
      supplyApr: rayToApr(r.liquidityRate),
      variableBorrowApr: rayToApr(r.variableBorrowRate),
      liquidationThresholdBps: liqBps && liqBps > 0 ? liqBps : null,
      supplyCapTokens: Number.isFinite(supplyCapRaw) && supplyCapRaw > 0 ? supplyCapRaw : null,
      borrowCapTokens: Number.isFinite(borrowCapRaw) && borrowCapRaw > 0 ? borrowCapRaw : null,
      priceUsd: validPrice,
    });
  }
  return out;
}

/**
 * Fetch every Aave V3 listing for a single seed across all five
 * deployments. The caller passes a chain → contract map so we can use
 * the seed's `altContracts` for L2 lookups (the L1 contract address
 * does not match the L2 deployment).
 */
export async function fetchAaveV3MultiChain(
  chainContracts: Partial<Record<LendingChain, string>>
): Promise<LendingMarket[]> {
  const apiKey = process.env.GRAPH_API_KEY;
  if (!apiKey) return [];
  const tasks = AAVE_V3_DEPLOYMENTS.map(async (d) => {
    const contract = chainContracts[d.chain];
    if (!contract) return [] as LendingMarket[];
    try {
      return await queryDeployment(apiKey, d, [contract.toLowerCase()]);
    } catch (e) {
      recordDeficiency(
        'AAVE_V3_QUERY_FAILED',
        `aave v3 ${d.chain}: ${(e as Error).message}`
      );
      return [] as LendingMarket[];
    }
  });
  const results = await Promise.all(tasks);
  return results.flat();
}

/**
 * Build a `TokenLending` summary from a list of markets. `canonicalPriceUsd`
 * is the seed's authoritative live USD price (typically from the Uniswap V3
 * mainnet spot module). When provided it overrides the per-subgraph oracle
 * price for *every* market, then drives `totalSuppliedUsd` /
 * `totalBorrowedUsd`. This is the right behavior for cross-chain
 * aggregation: each L2's Aave oracle has its own update cadence and can
 * drift materially (observed: WBTC mainnet $79.9k vs Polygon $56.6k vs
 * Arbitrum $66.6k on the same wall-clock day), and aggregating across
 * different price bases produces nonsense USDs. Per-subgraph oracle prices
 * are still surfaced via `priceUsd` for callers that want them.
 *
 * Falls back to the per-subgraph oracle price only when no canonical price
 * was supplied, so the card still renders something for tokens we have no
 * spot reference for.
 */
export function summariseLending(
  markets: LendingMarket[],
  canonicalPriceUsd: number | null
): TokenLending | null {
  if (markets.length === 0) return null;
  const haveCanonical = canonicalPriceUsd != null && canonicalPriceUsd > 0;
  const adjusted = markets.map((m) => {
    if (haveCanonical) {
      const p = canonicalPriceUsd as number;
      return {
        ...m,
        totalSuppliedUsd: m.totalSuppliedTokens * p,
        totalBorrowedUsd: m.totalBorrowedTokens * p,
        availableLiquidityUsd: m.availableLiquidityTokens * p,
        priceUsd: p,
      };
    }
    return m;
  });
  let totalSuppliedUsd = 0;
  let totalBorrowedUsd = 0;
  let totalAvailableUsd = 0;
  let hasSuppliedUsd = false;
  let hasBorrowedUsd = false;
  let hasAvailableUsd = false;
  for (const m of adjusted) {
    if (m.totalSuppliedUsd != null) {
      totalSuppliedUsd += m.totalSuppliedUsd;
      hasSuppliedUsd = true;
    }
    if (m.totalBorrowedUsd != null) {
      totalBorrowedUsd += m.totalBorrowedUsd;
      hasBorrowedUsd = true;
    }
    if (m.availableLiquidityUsd != null) {
      totalAvailableUsd += m.availableLiquidityUsd;
      hasAvailableUsd = true;
    }
  }
  // Markets sort largest-deployment-first so the UI leads with what
  // matters. Falls back to chain ordering when neither has USD.
  adjusted.sort((a, b) => (b.totalSuppliedUsd ?? 0) - (a.totalSuppliedUsd ?? 0));
  const aggregateUtil =
    hasSuppliedUsd && totalSuppliedUsd > 0 && hasBorrowedUsd
      ? Math.min(1, totalBorrowedUsd / totalSuppliedUsd)
      : null;
  return {
    markets: adjusted,
    totalSuppliedUsd: hasSuppliedUsd ? totalSuppliedUsd : null,
    totalBorrowedUsd: hasBorrowedUsd ? totalBorrowedUsd : null,
    availableLiquidityUsd: hasAvailableUsd ? totalAvailableUsd : null,
    utilization: aggregateUtil,
  };
}
