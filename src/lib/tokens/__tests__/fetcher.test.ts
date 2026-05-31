import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TokenSeed } from '@/lib/tokens/types';

// ---------------------------------------------------------------------------
// Mock every sub-fetcher this module orchestrates. Each is a boundary; we
// drive their return values / throws to exercise fetcher.ts's own assembly,
// merge, fallback and partial-failure-tolerance logic.
// ---------------------------------------------------------------------------

const ETH_REFERENCE_POOL = '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640';
const GRT_POOL = '0xgrtpool';
const GRT_CONTRACT = '0xgrtcontract';

vi.mock('@/lib/tokens/api', () => ({
  fetchHolders: vi.fn(),
  fetchPoolOhlc: vi.fn(),
  fetchPoolsForToken: vi.fn(),
  fetchSwapsForToken: vi.fn(),
  fetchTokenMetadata: vi.fn(),
}));
vi.mock('@/lib/tokens/contract-detection', () => ({
  classifyAddresses: vi.fn(),
}));
vi.mock('@/lib/tokens/deficiencies', () => ({
  recordDeficiency: vi.fn(),
}));
vi.mock('@/lib/tokens/dex-volume', () => ({
  fetchDexVolumes: vi.fn(),
}));
vi.mock('@/lib/tokens/hyperliquid', () => ({
  fetchAllHyperliquidPerps: vi.fn(),
  fetchHyperliquidForSeed: vi.fn(),
  seedToHyperliquidCoin: vi.fn(),
}));
vi.mock('@/lib/tokens/lending', () => ({
  fetchAaveV3MultiChain: vi.fn(),
  summariseLending: vi.fn(),
}));
vi.mock('@/lib/tokens/pool-stats', () => ({
  fetchPoolStats: vi.fn(),
}));
vi.mock('@/lib/tokens/spot-price', () => ({
  fetchSpotPrices: vi.fn(),
}));
vi.mock('@/lib/tokens/total-supply', () => ({
  fetchTotalSupplies: vi.fn(),
}));
vi.mock('@/lib/tokens/uniswap-token-list', () => ({
  getUniswapLogoUri: vi.fn(),
}));

// Controlled seed list — one ETH-quoted token (GRT-like) keeps the maths
// non-trivial without dragging in the real 150-entry catalog.
const TEST_SEEDS: TokenSeed[] = [
  {
    contract: GRT_CONTRACT,
    symbol: 'GRT',
    chain: 'mainnet',
    pool: { address: GRT_POOL, quote: 'eth', inverse: false },
    iconSlug: 'grt',
    website: 'https://thegraph.com',
    tags: ['Infrastructure'],
    altContracts: { arbitrum: '0xgrtarb' },
  },
];
vi.mock('@/lib/tokens/seed', () => ({
  get TOKEN_SEEDS() {
    return TEST_SEEDS;
  },
}));

import { fetchTokenDirectory, fetchTokenDetail } from '@/lib/tokens/fetcher';
import {
  fetchHolders,
  fetchPoolOhlc,
  fetchPoolsForToken,
  fetchSwapsForToken,
  fetchTokenMetadata,
} from '@/lib/tokens/api';
import { classifyAddresses } from '@/lib/tokens/contract-detection';
import { fetchDexVolumes } from '@/lib/tokens/dex-volume';
import {
  fetchAllHyperliquidPerps,
  fetchHyperliquidForSeed,
  seedToHyperliquidCoin,
} from '@/lib/tokens/hyperliquid';
import { fetchAaveV3MultiChain, summariseLending } from '@/lib/tokens/lending';
import { fetchPoolStats } from '@/lib/tokens/pool-stats';
import { fetchSpotPrices } from '@/lib/tokens/spot-price';
import { fetchTotalSupplies } from '@/lib/tokens/total-supply';
import { getUniswapLogoUri } from '@/lib/tokens/uniswap-token-list';

// Cast helpers (mockable fns typed as their real signatures).
const mFetchPoolOhlc = fetchPoolOhlc as unknown as ReturnType<typeof vi.fn>;
const mFetchTokenMetadata = fetchTokenMetadata as unknown as ReturnType<typeof vi.fn>;
const mFetchHolders = fetchHolders as unknown as ReturnType<typeof vi.fn>;
const mFetchPoolsForToken = fetchPoolsForToken as unknown as ReturnType<typeof vi.fn>;
const mFetchSwapsForToken = fetchSwapsForToken as unknown as ReturnType<typeof vi.fn>;
const mGetUniswapLogoUri = getUniswapLogoUri as unknown as ReturnType<typeof vi.fn>;
const mClassifyAddresses = classifyAddresses as unknown as ReturnType<typeof vi.fn>;
const mFetchDexVolumes = fetchDexVolumes as unknown as ReturnType<typeof vi.fn>;
const mFetchAllHyperliquidPerps = fetchAllHyperliquidPerps as unknown as ReturnType<typeof vi.fn>;
const mFetchHyperliquidForSeed = fetchHyperliquidForSeed as unknown as ReturnType<typeof vi.fn>;
const mSeedToHyperliquidCoin = seedToHyperliquidCoin as unknown as ReturnType<typeof vi.fn>;
const mFetchAaveV3MultiChain = fetchAaveV3MultiChain as unknown as ReturnType<typeof vi.fn>;
const mSummariseLending = summariseLending as unknown as ReturnType<typeof vi.fn>;
const mFetchPoolStats = fetchPoolStats as unknown as ReturnType<typeof vi.fn>;
const mFetchSpotPrices = fetchSpotPrices as unknown as ReturnType<typeof vi.fn>;
const mFetchTotalSupplies = fetchTotalSupplies as unknown as ReturnType<typeof vi.fn>;

// --- OHLC fixtures ----------------------------------------------------------
// Token API returns ETH/USD reference pool as USDC-per-WETH (close > 0.01).
function ethOhlc(close: number, datetime: string, volume = 0) {
  return { datetime, ticker: 'WETHUSDC', pool: ETH_REFERENCE_POOL, open: close, high: close, low: close, close, volume, transactions: 1, network: 'mainnet' };
}
// Token pool bars: quote=eth, inverse=false → priceUsd = close * ethUsd.
function grtOhlc(close: number, datetime: string, volume = 0) {
  return { datetime, ticker: 'GRTWETH', pool: GRT_POOL, open: close, high: close * 1.1, low: close * 0.9, close, volume, transactions: 5, network: 'mainnet' };
}

// Default OHLC dispatcher keyed by pool address so the ETH reference pool and
// the token pool can be controlled independently.
function defaultOhlc(network: string, pool: string) {
  if (pool === ETH_REFERENCE_POOL) {
    return Promise.resolve([ethOhlc(2000, '2026-05-30T00:00:00Z'), ethOhlc(2100, '2026-05-31T00:00:00Z')]);
  }
  if (pool === GRT_POOL) {
    return Promise.resolve([
      grtOhlc(0.05, '2026-03-02T00:00:00Z', 1000), // ~90d back
      grtOhlc(0.06, '2026-05-01T00:00:00Z', 2000), // ~30d back
      grtOhlc(0.07, '2026-05-24T00:00:00Z', 3000), // ~7d back
      grtOhlc(0.08, '2026-05-30T00:00:00Z', 4000), // yesterday
      grtOhlc(0.1, '2026-05-31T00:00:00Z', 5000), // today
    ]);
  }
  return Promise.resolve([]);
}

function baseMetadata(overrides: Record<string, unknown> = {}) {
  return {
    contract: GRT_CONTRACT,
    name: 'The Graph',
    symbol: 'GRT',
    decimals: 18,
    circulating_supply: 1_000_000,
    total_supply: 10_000_000,
    holders: 50_000,
    total_transfers: 1,
    network: 'mainnet',
    icon: { web3icon: 'grt' },
    ...overrides,
  };
}

function resetToHappyPath() {
  vi.clearAllMocks();
  mFetchPoolOhlc.mockImplementation((network: string, pool: string) => defaultOhlc(network, pool));
  mFetchTokenMetadata.mockResolvedValue(baseMetadata());
  mFetchHolders.mockResolvedValue([
    { address: '0xAAA', amount: '500000000000000000000000', value: null, symbol: 'GRT', decimals: 18 }, // 500k tokens
    { address: '0xBBB', amount: '100000000000000000000000', value: null, symbol: 'GRT', decimals: 18 }, // 100k tokens
  ]);
  mFetchPoolsForToken.mockResolvedValue([]);
  mFetchSwapsForToken.mockResolvedValue([]);
  mGetUniswapLogoUri.mockResolvedValue('https://logo/grt.png');
  mClassifyAddresses.mockResolvedValue(new Map([['0xaaa', true], ['0xbbb', false]]));
  mFetchDexVolumes.mockResolvedValue(new Map());
  mFetchAllHyperliquidPerps.mockResolvedValue(new Map());
  mFetchHyperliquidForSeed.mockResolvedValue(null);
  mSeedToHyperliquidCoin.mockReturnValue(null);
  mFetchAaveV3MultiChain.mockResolvedValue([]);
  mSummariseLending.mockReturnValue(null);
  mFetchPoolStats.mockResolvedValue(new Map());
  mFetchSpotPrices.mockResolvedValue(new Map());
  mFetchTotalSupplies.mockResolvedValue(new Map());
}

beforeEach(() => {
  resetToHappyPath();
});

// ===========================================================================
describe('fetchTokenDirectory', () => {
  it('assembles one summary per seed with the expected shape', async () => {
    const res = await fetchTokenDirectory();
    expect(res).toHaveLength(1);
    const s = res[0];
    expect(s.contract).toBe(GRT_CONTRACT);
    expect(s.chain).toBe('mainnet');
    expect(s.symbol).toBe('GRT');
    expect(s.name).toBe('The Graph');
    expect(s.decimals).toBe(18);
    expect(s.logoUri).toBe('https://logo/grt.png');
    // ethUsd = 2100 (close > 0.01 so not inverted), today close 0.1 → 210 USD
    expect(s.priceUsd).toBeCloseTo(0.1 * 2100, 5);
    expect(s.circulatingSupply).toBe(1_000_000);
    // FDV/marketcap derive from price * supply
    expect(s.marketCapUsd).toBeCloseTo(1_000_000 * 0.1 * 2100, 0);
    expect(s.holders).toBe(50_000);
    expect(s.tags).toEqual(['Infrastructure']);
    expect(s.altContracts).toEqual({ arbitrum: '0xgrtarb' });
    expect(typeof s.quoteAsOf).toBe('number');
    expect(Array.isArray(s.sparkline)).toBe(true);
    expect(s.sparkline.length).toBeGreaterThan(0);
  });

  it('computes percentage changes from the OHLC offset bars', async () => {
    const res = await fetchTokenDirectory();
    const s = res[0];
    // priceUsd from today=0.1, yesterday=0.08 → +25%
    expect(s.change24hPct).toBeCloseTo(((0.1 - 0.08) / 0.08) * 100, 4);
    // 7d prior ~0.07 → ((0.1-0.07)/0.07)*100
    expect(s.change7dPct).toBeCloseTo(((0.1 - 0.07) / 0.07) * 100, 4);
    expect(s.change30dPct).toBeCloseTo(((0.1 - 0.06) / 0.06) * 100, 4);
    expect(s.change90dPct).toBeCloseTo(((0.1 - 0.05) / 0.05) * 100, 4);
  });

  it('splits top-10 holder share by EOA vs contract using classification', async () => {
    const res = await fetchTokenDirectory();
    const s = res[0];
    // total 600k of 1,000,000 circulating = 0.6
    expect(s.top10Share).toBeCloseTo(0.6, 6);
    // 0xAAA(500k) is contract, 0xBBB(100k) is eoa
    expect(s.top10ContractShare).toBeCloseTo(0.5, 6);
    expect(s.top10EoaShare).toBeCloseTo(0.1, 6);
  });

  it('treats unknown (unclassified) holders proportionally and warns', async () => {
    // Both addresses absent from the classification map => all unknown.
    mClassifyAddresses.mockResolvedValue(new Map());
    const res = await fetchTokenDirectory();
    const s = res[0];
    expect(s.top10Share).toBeCloseTo(0.6, 6);
    // knownSum === 0 → all attributed to EOA, contract share 0
    expect(s.top10EoaShare).toBeCloseTo(0.6, 6);
    expect(s.top10ContractShare).toBe(0);
    expect(s.warnings.some((w) => w.includes('classification'))).toBe(true);
  });

  it('merges DEX volume breakdown onto the matching summary', async () => {
    mFetchDexVolumes.mockResolvedValue(
      new Map([[GRT_CONTRACT.toLowerCase(), { totalUsd: 1234, byVenue: { uniswap: 1234 } }]])
    );
    const res = await fetchTokenDirectory();
    expect(res[0].dexVolume24hUsd).toBe(1234);
    expect(res[0].dexVolumeByVenue).toEqual({ uniswap: 1234 });
  });

  it('treats a zero total DEX volume as null but keeps the venue map', async () => {
    mFetchDexVolumes.mockResolvedValue(
      new Map([[GRT_CONTRACT.toLowerCase(), { totalUsd: 0, byVenue: { uniswap: 0 } }]])
    );
    const res = await fetchTokenDirectory();
    expect(res[0].dexVolume24hUsd).toBeNull();
    expect(res[0].dexVolumeByVenue).toEqual({ uniswap: 0 });
  });

  it('overrides totalSupply and recomputes FDV from on-chain supply', async () => {
    mFetchTotalSupplies.mockResolvedValue(
      new Map([[`mainnet:${GRT_CONTRACT.toLowerCase()}`, 42_000_000]])
    );
    const res = await fetchTokenDirectory();
    const s = res[0];
    expect(s.totalSupply).toBe(42_000_000);
    expect(s.fdvUsd).toBeCloseTo(42_000_000 * 0.1 * 2100, 0);
  });

  it('overrides priceUsd with the live spot price and recomputes caps', async () => {
    mFetchSpotPrices.mockResolvedValue(new Map([[GRT_CONTRACT.toLowerCase(), 250]]));
    const res = await fetchTokenDirectory();
    const s = res[0];
    expect(s.priceUsd).toBe(250);
    expect(s.marketCapUsd).toBeCloseTo(1_000_000 * 250, 0);
  });

  it('ignores non-positive spot prices', async () => {
    mFetchSpotPrices.mockResolvedValue(new Map([[GRT_CONTRACT.toLowerCase(), 0]]));
    const res = await fetchTokenDirectory();
    // falls back to OHLC-derived price
    expect(res[0].priceUsd).toBeCloseTo(0.1 * 2100, 5);
  });

  it('populates hyperliquid fields when the seed maps to a live perp', async () => {
    mSeedToHyperliquidCoin.mockReturnValue('GRT');
    mFetchAllHyperliquidPerps.mockResolvedValue(
      new Map([['GRT', { price: 0.2, open_interest: 1000, funding_rate: 0.0001 }]])
    );
    const res = await fetchTokenDirectory();
    const s = res[0];
    expect(s.hyperliquidCoin).toBe('GRT');
    expect(s.hyperliquidOiUsd).toBeCloseTo(1000 * 0.2, 6);
    expect(s.hyperliquidFundingHourly).toBeCloseTo(0.0001, 8);
  });

  it('leaves hyperliquid fields null when the perp price is non-positive', async () => {
    mSeedToHyperliquidCoin.mockReturnValue('GRT');
    mFetchAllHyperliquidPerps.mockResolvedValue(
      new Map([['GRT', { price: 0, open_interest: 1000, funding_rate: 0.0001 }]])
    );
    const res = await fetchTokenDirectory();
    expect(res[0].hyperliquidCoin).toBeNull();
    expect(res[0].hyperliquidOiUsd).toBeNull();
  });

  // --- partial-failure tolerance ------------------------------------------
  it('swallows metadata failure and falls back to seed-derived fields', async () => {
    mFetchTokenMetadata.mockRejectedValue(new Error('metadata boom'));
    const res = await fetchTokenDirectory();
    const s = res[0];
    expect(s.name).toBe('GRT'); // falls back to seed.symbol
    expect(s.circulatingSupply).toBeNull();
    expect(s.marketCapUsd).toBeNull();
    expect(s.warnings.some((w) => w.includes('metadata'))).toBe(true);
  });

  it('swallows OHLC page-1 failure (no prices) and records a warning', async () => {
    mFetchPoolOhlc.mockImplementation((network: string, pool: string, _i: string, _l: number, page = 1) => {
      if (pool === ETH_REFERENCE_POOL) return defaultOhlc(network, pool);
      if (page === 1) return Promise.reject(new Error('ohlc down'));
      return Promise.resolve([]);
    });
    const res = await fetchTokenDirectory();
    const s = res[0];
    expect(s.priceUsd).toBeNull();
    expect(s.sparkline).toEqual([]);
    expect(s.warnings.some((w) => w.includes('ohlc'))).toBe(true);
  });

  it('swallows holders failure (top-10 share stays null)', async () => {
    mFetchHolders.mockRejectedValue(new Error('holders down'));
    const res = await fetchTokenDirectory();
    expect(res[0].top10Share).toBeNull();
  });

  it('swallows logo failure (logoUri null)', async () => {
    mGetUniswapLogoUri.mockRejectedValue(new Error('no logo'));
    const res = await fetchTokenDirectory();
    expect(res[0].logoUri).toBeNull();
  });

  it('tolerates a thrown hyperliquid sweep (no perp data attached)', async () => {
    mSeedToHyperliquidCoin.mockReturnValue('GRT');
    mFetchAllHyperliquidPerps.mockRejectedValue(new Error('hl down'));
    const res = await fetchTokenDirectory();
    expect(res[0].hyperliquidCoin).toBeNull();
  });

  it('returns null ETH reference price when the reference pool is empty', async () => {
    mFetchPoolOhlc.mockImplementation((network: string, pool: string) => {
      if (pool === ETH_REFERENCE_POOL) return Promise.resolve([]);
      return defaultOhlc(network, pool);
    });
    const res = await fetchTokenDirectory();
    // ETH-quoted token cannot resolve USD without ethUsd
    expect(res[0].priceUsd).toBeNull();
  });

  it('inverts the ETH reference close when it is reported as a tiny fraction', async () => {
    mFetchPoolOhlc.mockImplementation((network: string, pool: string) => {
      if (pool === ETH_REFERENCE_POOL) {
        return Promise.resolve([ethOhlc(0.0005, '2026-05-31T00:00:00Z')]); // WETH-per-USDC → invert
      }
      return defaultOhlc(network, pool);
    });
    const res = await fetchTokenDirectory();
    // ethUsd = 1/0.0005 = 2000 → price 0.1 * 2000 = 200
    expect(res[0].priceUsd).toBeCloseTo(0.1 * 2000, 4);
  });
});

// ===========================================================================
describe('fetchTokenDetail', () => {
  it('returns null for an unknown seed', async () => {
    const res = await fetchTokenDetail('mainnet', '0xdoesnotexist');
    expect(res).toBeNull();
  });

  it('assembles the full detail shape for a known seed', async () => {
    const res = await fetchTokenDetail('mainnet', GRT_CONTRACT);
    expect(res).not.toBeNull();
    expect(res!.summary.contract).toBe(GRT_CONTRACT);
    expect(Array.isArray(res!.priceSeries)).toBe(true);
    expect(res!.priceSeries.length).toBeGreaterThan(0);
    expect(Array.isArray(res!.benchmarkSeries)).toBe(true);
    expect(Array.isArray(res!.topHolders)).toBe(true);
    expect(Array.isArray(res!.markets)).toBe(true);
    expect(Array.isArray(res!.recentSwaps)).toBe(true);
    expect(res!.performance).toHaveProperty('d1');
    expect(res!.performance).toHaveProperty('d30');
    // happy-path mocks return null lending/hyperliquid
    expect(res!.lending).toBeNull();
    expect(res!.hyperliquid).toBeNull();
  });

  it('builds top holders with scaled amounts and computed USD value', async () => {
    const res = await fetchTokenDetail('mainnet', GRT_CONTRACT);
    const holders = res!.topHolders;
    expect(holders).toHaveLength(2);
    // 500000000000000000000000 / 1e18 = 500000
    expect(holders[0].amount).toBeCloseTo(500_000, 0);
    expect(holders[0].isContract).toBe(true); // 0xaaa classified true
    expect(holders[1].isContract).toBe(false);
    // valueUsd = scaled * priceUsd (spot-overridden below; default OHLC price)
    expect(holders[0].valueUsd).not.toBeNull();
  });

  it('marks holder isContract null when classification omits the address', async () => {
    mClassifyAddresses.mockResolvedValue(new Map([['0xaaa', true]]));
    const res = await fetchTokenDetail('mainnet', GRT_CONTRACT);
    const bbb = res!.topHolders.find((h) => h.address === '0xBBB');
    expect(bbb!.isContract).toBeNull();
  });

  it('overrides header price with the live spot and recomputes caps', async () => {
    mFetchSpotPrices.mockResolvedValue(new Map([[GRT_CONTRACT.toLowerCase(), 300]]));
    const res = await fetchTokenDetail('mainnet', GRT_CONTRACT);
    expect(res!.summary.priceUsd).toBe(300);
    expect(res!.summary.marketCapUsd).toBeCloseTo(1_000_000 * 300, 0);
  });

  it('does not call spot price for pegged stables', async () => {
    TEST_SEEDS[0].pegUsd = 1;
    try {
      const res = await fetchTokenDetail('mainnet', GRT_CONTRACT);
      expect(res!.summary.priceUsd).toBe(1);
      // pegUsd short-circuits spot fetch in the detail batch
      expect(mFetchSpotPrices).not.toHaveBeenCalled();
    } finally {
      delete TEST_SEEDS[0].pegUsd;
    }
  });

  it('overrides totalSupply with on-chain supply and recomputes FDV', async () => {
    mFetchTotalSupplies.mockResolvedValue(
      new Map([[`mainnet:${GRT_CONTRACT.toLowerCase()}`, 99_000_000]])
    );
    const res = await fetchTokenDetail('mainnet', GRT_CONTRACT);
    expect(res!.summary.totalSupply).toBe(99_000_000);
  });

  it('builds markets from pools, ranking by TVL and dropping statless pools', async () => {
    mFetchPoolsForToken.mockResolvedValue([
      {
        pool: '0xpool1', factory: '0xf', protocol: 'uniswap_v3', fee: 3000,
        input_token: { address: GRT_CONTRACT, symbol: 'GRT', decimals: 18 },
        output_token: { address: '0xusdc', symbol: 'USDC', decimals: 6 },
        network: 'mainnet',
      },
      {
        pool: '0xpool2', factory: '0xf', protocol: 'uniswap_v3', fee: 500,
        input_token: { address: GRT_CONTRACT, symbol: 'GRT', decimals: 18 },
        output_token: { address: '0xweth', symbol: 'WETH', decimals: 18 },
        network: 'mainnet',
      },
      // statless pool — should be dropped
      {
        pool: '0xpool3', factory: '0xf', protocol: 'uniswap_v2', fee: 3000,
        input_token: { address: GRT_CONTRACT, symbol: 'GRT', decimals: 18 },
        output_token: { address: '0xdai', symbol: 'DAI', decimals: 18 },
        network: 'mainnet',
      },
    ]);
    mFetchPoolStats.mockResolvedValue(
      new Map([
        ['0xpool1', { tvlUsd: 5000, volume24hUsd: 100, feeBps: 30, seedPriceUsd: 0.21 }],
        ['0xpool2', { tvlUsd: 9000, volume24hUsd: 200, feeBps: 5, seedPriceUsd: 0.22 }],
      ])
    );
    const res = await fetchTokenDetail('mainnet', GRT_CONTRACT);
    const markets = res!.markets;
    expect(markets).toHaveLength(2); // pool3 dropped (no stats)
    // ranked by TVL desc → pool2 (9000) first
    expect(markets[0].pool).toBe('0xpool2');
    expect(markets[0].tvlUsd).toBe(9000);
    expect(markets[0].baseSymbol).toBe('GRT');
    expect(markets[0].quoteSymbol).toBe('WETH');
  });

  it('filters out the CoW settlement pseudo-pool', async () => {
    mFetchPoolsForToken.mockResolvedValue([
      {
        pool: '0x9008d19f58aabd9ed0d60971565aa8510560ab41', factory: '0xf', protocol: 'cow', fee: 0,
        input_token: { address: GRT_CONTRACT, symbol: 'GRT', decimals: 18 },
        output_token: { address: '0xusdc', symbol: 'USDC', decimals: 6 },
        network: 'mainnet',
      },
    ]);
    mFetchPoolStats.mockResolvedValue(new Map());
    const res = await fetchTokenDetail('mainnet', GRT_CONTRACT);
    expect(res!.markets).toHaveLength(0);
  });

  it('builds recent swaps with side, amounts and execution price', async () => {
    mFetchSpotPrices.mockResolvedValue(new Map([[GRT_CONTRACT.toLowerCase(), 0.2]]));
    mFetchSwapsForToken.mockResolvedValue([
      {
        datetime: '2026-05-31T00:00:00Z', timestamp: 1000, transaction_id: '0xtx1',
        pool: '0xpool1', protocol: 'uniswap_v3',
        input_token: { address: GRT_CONTRACT, symbol: 'GRT', decimals: 18 },
        output_token: { address: '0xusdc', symbol: 'USDC', decimals: 6 },
        input_amount: '100', output_amount: '20', input_value: 100, output_value: 20,
        price: null, user: '0xtrader', sender: '0xrouter', recipient: '0xrec',
      },
    ]);
    const res = await fetchTokenDetail('mainnet', GRT_CONTRACT);
    const swap = res!.recentSwaps[0];
    expect(swap.side).toBe('sell'); // seed token is the input leg
    expect(swap.amount).toBe(100);
    expect(swap.trader).toBe('0xtrader');
    // counterparty is stable USDC → exec price = (20 * 1) / 100 = 0.2
    expect(swap.priceUsd).toBeCloseTo(0.2, 6);
    expect(swap.counterpartySymbol).toBe('USDC');
  });

  it('classifies a buy when the seed token is the output leg', async () => {
    mFetchSwapsForToken.mockResolvedValue([
      {
        datetime: '2026-05-31T00:00:00Z', timestamp: 1000, transaction_id: '0xtx2',
        pool: '0xpool1', protocol: 'uniswap_v3',
        input_token: { address: '0xusdc', symbol: 'USDC', decimals: 6 },
        output_token: { address: GRT_CONTRACT, symbol: 'GRT', decimals: 18 },
        input_amount: '20', output_amount: '100', input_value: 20, output_value: 100,
        price: null, user: '0xtrader2', sender: '0xrouter', recipient: '0xrec',
      },
    ]);
    const res = await fetchTokenDetail('mainnet', GRT_CONTRACT);
    expect(res!.recentSwaps[0].side).toBe('buy');
  });

  it('passes Aave reserves and price through summariseLending', async () => {
    const fakeLending = { markets: [], totalSuppliedUsd: 100, totalBorrowedUsd: 50, availableLiquidityUsd: 50, utilization: 0.5 };
    mFetchAaveV3MultiChain.mockResolvedValue([{ chain: 'mainnet' }]);
    mSummariseLending.mockReturnValue(fakeLending);
    const res = await fetchTokenDetail('mainnet', GRT_CONTRACT);
    expect(res!.lending).toBe(fakeLending);
    expect(mSummariseLending).toHaveBeenCalledWith([{ chain: 'mainnet' }], expect.any(Number));
  });

  it('attaches hyperliquid summary when present', async () => {
    const hl = { coin: 'GRT', marketUrl: 'u', priceUsd: 0.2, priceChange24h: 0, trades24h: 1, uniqueUsers24h: 1, priceHigh24h: null, priceLow24h: null, priceHistory24h: [], volume24hUsd: 0, openInterestTokens: 0, openInterestUsd: 0, openInterestChange24h: null };
    mFetchHyperliquidForSeed.mockResolvedValue(hl);
    const res = await fetchTokenDetail('mainnet', GRT_CONTRACT);
    expect(res!.hyperliquid).toBe(hl);
  });

  // --- partial-failure tolerance ------------------------------------------
  it('tolerates pools / swaps / lending / hyperliquid all throwing', async () => {
    mFetchPoolsForToken.mockRejectedValue(new Error('pools down'));
    mFetchSwapsForToken.mockRejectedValue(new Error('swaps down'));
    mFetchAaveV3MultiChain.mockRejectedValue(new Error('aave down'));
    mFetchHyperliquidForSeed.mockRejectedValue(new Error('hl down'));
    const res = await fetchTokenDetail('mainnet', GRT_CONTRACT);
    expect(res).not.toBeNull();
    expect(res!.markets).toEqual([]);
    expect(res!.recentSwaps).toEqual([]);
    expect(res!.hyperliquid).toBeNull();
  });

  it('tolerates classification failure (holders keep null isContract)', async () => {
    mClassifyAddresses.mockRejectedValue(new Error('rpc down'));
    const res = await fetchTokenDetail('mainnet', GRT_CONTRACT);
    expect(res!.topHolders.every((h) => h.isContract === null)).toBe(true);
  });

  it('drops a spike-and-revert candle from the price series', async () => {
    // Three bars: 1.0, 5.0 (spike), 1.0 → middle should be filtered out.
    mFetchPoolOhlc.mockImplementation((network: string, pool: string, _i: string, _l: number, page = 1) => {
      if (pool === ETH_REFERENCE_POOL) return Promise.resolve([ethOhlc(1, '2026-05-31T00:00:00Z')]);
      if (pool === GRT_POOL) {
        if (page === 1) {
          return Promise.resolve([
            grtOhlc(1.0, '2026-05-29T00:00:00Z'),
            grtOhlc(5.0, '2026-05-30T00:00:00Z'),
            grtOhlc(1.0, '2026-05-31T00:00:00Z'),
          ]);
        }
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });
    const res = await fetchTokenDetail('mainnet', GRT_CONTRACT);
    // ethUsd = 1, quote eth → close * 1. Spike bar (5.0) removed, 2 remain.
    expect(res!.priceSeries).toHaveLength(2);
    expect(res!.priceSeries.every((p) => p.close <= 2)).toBe(true);
  });
});
