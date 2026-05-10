/**
 * v0 prototype types for the Tokens section.
 *
 * Scope is intentionally smaller than the eventual /tokens page:
 * mainnet-only, 15 hand-picked tokens with known canonical Uniswap V3 pools.
 * Cross-chain and the top-250 fan-out come later.
 */

export type TokenChain = 'mainnet';

export interface CanonicalPool {
  address: string;
  /** 'eth' = priced in WETH (multiply by ethUsd), 'usd' = priced directly in USDC */
  quote: 'eth' | 'usd';
  /**
   * Is the seed token the base or quote side of the pool's `ticker`?
   * Used to invert the OHLC close when the pool is `WETH/<token>` rather
   * than `<token>/WETH`.
   */
  inverse: boolean;
}

export interface TokenSeed {
  contract: string;
  symbol: string;
  /** Optional override when Token API metadata is missing or wrong. */
  nameOverride?: string;
  chain: TokenChain;
  pool: CanonicalPool;
  /** web3icons slug fallback when Token API icon is null. */
  iconSlug?: string;
  /** When set, treat the token as a USD-pegged asset and bypass pool pricing. */
  pegUsd?: number;
  /**
   * Project page URL. Hand-curated because Token API doesn't return one.
   * Tracked as deficiency `TOKEN_API_NO_PROJECT_URL`.
   */
  website?: string;
  /**
   * Category tags. Hand-curated. Drives badge rendering and (later) directory
   * filters. Token API exposes no taxonomy, tracked as `TOKEN_API_NO_TAGS`.
   */
  tags?: TokenTag[];
  /**
   * Cross-chain contract addresses, used to look up DEX volume on subgraphs
   * for chains other than the seed's primary chain. Same project, different
   * deployment, different contract. Omit chains where the token doesn't have
   * meaningful presence; the volume aggregator just skips them.
   */
  altContracts?: {
    arbitrum?: string;
    base?: string;
    polygon?: string;
    optimism?: string;
  };
}

export type TokenTag =
  | 'Stablecoin'
  | 'Wrapped'
  | 'DEX'
  | 'Lending'
  | 'LST'
  | 'Restaking'
  | 'Governance'
  | 'Oracle'
  | 'Infrastructure'
  | 'Identity'
  | 'Memecoin'
  | 'DeFi'
  | 'AI'
  | 'RWA'
  | 'DePIN'
  | 'Gaming'
  | 'Bridge';

export interface TokenSummary {
  contract: string;
  chain: TokenChain;
  name: string;
  symbol: string;
  decimals: number;
  icon: string | null;
  /** Logo URL resolved server-side from Uniswap's default token list. */
  logoUri: string | null;
  priceUsd: number | null;
  change24hPct: number | null;
  change7dPct: number | null;
  change30dPct: number | null;
  change90dPct: number | null;
  volume24hUsd: number | null;
  circulatingSupply: number | null;
  totalSupply: number | null;
  marketCapUsd: number | null;
  fdvUsd: number | null;
  holders: number | null;
  website: string | null;
  tags: TokenTag[];
  /** Compact 7-day price series for the index sparkline (close-only). */
  sparkline: number[];
  /** Share of circulating supply held by top-10 holders combined, 0..1. */
  top10Share: number | null;
  /** Subset of top10Share held by externally-owned accounts (likely-human wallets). */
  top10EoaShare: number | null;
  /** Subset of top10Share held by smart contracts (bridges, staking, LP pools, vesting). */
  top10ContractShare: number | null;
  /**
   * Aggregated DEX volume (USD) across all subgraphs we query for this token,
   * from each subgraph's latest `tokenDayData`. Per-venue breakdown for tooltips.
   */
  dexVolume24hUsd: number | null;
  dexVolumeByVenue: Record<string, number>;
  /** Hyperliquid perp coin id (e.g. "BTC", "kPEPE"). Non-null when the
   *  seed maps to a live HL perp market — drives the "Perps" badge and
   *  the HL OI column on the directory. */
  hyperliquidCoin: string | null;
  /** HL open interest in USD (token notional × mark). Null when no
   *  perp market or OI is unreported. */
  hyperliquidOiUsd: number | null;
  /** HL hourly funding rate as a decimal. Sign + magnitude drive the
   *  inline direction indicator on the directory's HL OI column. */
  hyperliquidFundingHourly: number | null;
  /**
   * Cross-chain deployments hand-curated in the seed. Same project, different
   * chain, different contract. Empty when the token only exists on its
   * primary chain.
   */
  altContracts: Partial<Record<'arbitrum' | 'base' | 'polygon' | 'optimism', string>>;
  /** Per-token deficiencies surfaced from the data layer (used by deficiency log + UI tooltips). */
  warnings: string[];
  /** Server timestamp (ms) when this summary was assembled — drives the "as of HH:MM:SS" indicator. */
  quoteAsOf: number;
}

export interface OhlcPoint {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TokenHolder {
  address: string;
  amount: number;
  valueUsd: number | null;
  /** True if address has bytecode on-chain (contract). Null when classification failed. */
  isContract: boolean | null;
}

export interface TokenMarket {
  pool: string;
  protocol: string;
  feeBps: number | null;
  baseSymbol: string;
  baseContract: string;
  quoteSymbol: string;
  quoteContract: string;
  /** Current pool TVL in USD, when discoverable via the Uniswap V3 subgraph. */
  tvlUsd: number | null;
  /** Most recent day's pool volume in USD, when discoverable. */
  volume24hUsd: number | null;
  /**
   * Implied USD price of the seed token quoted by this specific pool. Only
   * populated for V3 pools paired against a stablecoin or WETH (we don't
   * carry USD references for arbitrary counterparties). Used to surface
   * cross-pool spread on the Markets card.
   */
  priceUsd: number | null;
}

export interface TokenSwap {
  timestamp: number;
  txHash: string;
  pool: string;
  protocol: string;
  side: 'buy' | 'sell';
  /** Token-units of the seed token transacted in this swap. */
  amount: number;
  /** USD value, when computable from priceUsd. */
  amountUsd: number | null;
  counterpartySymbol: string;
  /** Counterparty token contract — drives the inline icon in the swap row's
   *  Pair column (otherwise we'd only have a symbol fallback). */
  counterpartyContract: string | null;
  /** Originator of the swap — typically the EOA (or proxy) that signed.
   *  Used for the swap row's "Trader" column linked to Etherscan. */
  trader: string;
  /** Execution price in USD for the seed token at swap time. Reveals
   *  slippage / sandwich activity when it differs from the spot bar. */
  priceUsd: number | null;
}

export interface TokenPerformance {
  /** Each pct is computed from the priceSeries vs. the latest close. */
  d1: number | null;
  d7: number | null;
  d14: number | null;
  d30: number | null;
}

export interface TokenRange24h {
  low: number;
  high: number;
  /** 0..1 position of `current` between low and high. */
  position: number;
  current: number;
}

export interface TokenDetail {
  summary: TokenSummary;
  priceSeries: OhlcPoint[];
  /**
   * Daily ETH/USD closes covering roughly the same window as `priceSeries`.
   * Used to compute the "Nx ETH" volatility ratio in the chart card. May be
   * empty when the WETH/USDC reference pool's OHLC fetch fails.
   */
  benchmarkSeries: { timestamp: number; close: number }[];
  topHolders: TokenHolder[];
  markets: TokenMarket[];
  recentSwaps: TokenSwap[];
  performance: TokenPerformance;
  range24h: TokenRange24h | null;
  /** Aggregated lending-market data when the token is listed in any
   *  supported protocol (currently Aave V3 Core across Ethereum +
   *  Arbitrum + Base + Polygon + Optimism, rolled up to a single
   *  cross-chain summary). Null when the token isn't a lending-market
   *  asset. */
  lending: import('./lending').TokenLending | null;
  /** Hyperliquid perps-market summary when a corresponding perp exists.
   *  Null when no HL market matches the seed (most of the catalog). */
  hyperliquid: import('./hyperliquid').TokenHyperliquid | null;
}
