import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  summariseLending,
  fetchAaveV3MultiChain,
  AAVE_V3_DEPLOYMENTS,
  type LendingMarket,
} from '@/lib/tokens/lending';

vi.mock('@/lib/tokens/deficiencies', () => ({
  recordDeficiency: vi.fn(),
}));

function market(overrides: Partial<LendingMarket> = {}): LendingMarket {
  return {
    protocol: 'Aave V3 Core',
    chain: 'mainnet',
    underlyingAsset: '0xabc',
    aaveMarketUrl: 'https://app.aave.com/x',
    isActive: true,
    isFrozen: false,
    borrowingEnabled: true,
    collateralEnabled: true,
    totalSuppliedTokens: 100,
    totalSuppliedUsd: 200,
    totalBorrowedTokens: 50,
    totalBorrowedUsd: 100,
    availableLiquidityTokens: 50,
    availableLiquidityUsd: 100,
    utilization: 0.5,
    supplyApr: 0.03,
    variableBorrowApr: 0.05,
    liquidationThresholdBps: 7800,
    supplyCapTokens: null,
    borrowCapTokens: null,
    priceUsd: 2,
    ...overrides,
  };
}

describe('summariseLending', () => {
  it('returns null for an empty market list', () => {
    expect(summariseLending([], 100)).toBeNull();
    expect(summariseLending([], null)).toBeNull();
  });

  it('overrides every market USD with the canonical price when supplied', () => {
    const markets = [
      market({ chain: 'mainnet', totalSuppliedTokens: 10, totalBorrowedTokens: 4, availableLiquidityTokens: 6, priceUsd: 999 }),
      market({ chain: 'arbitrum', totalSuppliedTokens: 5, totalBorrowedTokens: 1, availableLiquidityTokens: 4, priceUsd: 1 }),
    ];
    const res = summariseLending(markets, 100)!;
    expect(res).not.toBeNull();
    // canonical price 100 applied: supplied USD = (10+5)*100
    expect(res.totalSuppliedUsd).toBe(1500);
    expect(res.totalBorrowedUsd).toBe(500); // (4+1)*100
    expect(res.availableLiquidityUsd).toBe(1000); // (6+4)*100
    // every market priceUsd overwritten
    for (const m of res.markets) {
      expect(m.priceUsd).toBe(100);
    }
    // aggregate util = borrowed/supplied
    expect(res.utilization).toBeCloseTo(500 / 1500);
  });

  it('sorts markets by totalSuppliedUsd descending', () => {
    const markets = [
      market({ chain: 'arbitrum', totalSuppliedTokens: 1 }),
      market({ chain: 'mainnet', totalSuppliedTokens: 100 }),
      market({ chain: 'base', totalSuppliedTokens: 10 }),
    ];
    const res = summariseLending(markets, 5)!;
    expect(res.markets.map((m) => m.chain)).toEqual(['mainnet', 'base', 'arbitrum']);
  });

  it('falls back to per-subgraph oracle USD when no canonical price', () => {
    const markets = [
      market({ totalSuppliedUsd: 200, totalBorrowedUsd: 100, availableLiquidityUsd: 100, priceUsd: 2 }),
    ];
    const res = summariseLending(markets, null)!;
    expect(res.totalSuppliedUsd).toBe(200);
    expect(res.totalBorrowedUsd).toBe(100);
    expect(res.markets[0].priceUsd).toBe(2); // unchanged
  });

  it('treats a zero / non-positive canonical price as "no canonical"', () => {
    const markets = [market({ totalSuppliedUsd: 200, totalBorrowedUsd: 100, priceUsd: 7 })];
    const res = summariseLending(markets, 0)!;
    expect(res.markets[0].priceUsd).toBe(7); // not overridden
    expect(res.totalSuppliedUsd).toBe(200);
  });

  it('returns null aggregate USD figures when no market carries USD and no canonical', () => {
    const markets = [
      market({ totalSuppliedUsd: null, totalBorrowedUsd: null, availableLiquidityUsd: null, priceUsd: null }),
    ];
    const res = summariseLending(markets, null)!;
    expect(res.totalSuppliedUsd).toBeNull();
    expect(res.totalBorrowedUsd).toBeNull();
    expect(res.availableLiquidityUsd).toBeNull();
    expect(res.utilization).toBeNull();
  });

  it('caps aggregate utilization at 1', () => {
    const markets = [
      market({ totalSuppliedTokens: 10, totalBorrowedTokens: 100 }),
    ];
    const res = summariseLending(markets, 1)!;
    expect(res.utilization).toBe(1);
  });
});

describe('fetchAaveV3MultiChain', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
    process.env.GRAPH_API_KEY = 'test-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GRAPH_API_KEY;
  });

  it('returns [] when GRAPH_API_KEY is missing', async () => {
    delete process.env.GRAPH_API_KEY;
    const res = await fetchAaveV3MultiChain({ mainnet: '0xAbC' });
    expect(res).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('skips chains with no contract and queries only mapped ones', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ data: { reserves: [] } }), { status: 200 })
    );
    await fetchAaveV3MultiChain({ mainnet: '0xAbC' });
    // only the one chain with a contract issues a fetch
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const url = mockFetch.mock.calls[0][0] as string;
    const mainnetHash = AAVE_V3_DEPLOYMENTS.find((d) => d.chain === 'mainnet')!.hash;
    expect(url).toContain(mainnetHash);
    expect(url).toContain('test-key');
  });

  it('maps a reserve row into a LendingMarket with decimal-adjusted values', async () => {
    const reserve = {
      underlyingAsset: '0xDEAD',
      symbol: 'WBTC',
      decimals: 8,
      isActive: true,
      isFrozen: false,
      borrowingEnabled: true,
      usageAsCollateralEnabled: true,
      totalATokenSupply: String(2n * 10n ** 8n), // 2 tokens
      totalCurrentVariableDebt: String(1n * 10n ** 8n), // 1 token
      availableLiquidity: String(1n * 10n ** 8n), // 1 token
      supplyCap: '0',
      borrowCap: '500',
      liquidityRate: String(0.03 * 1e27), // 3% APR
      variableBorrowRate: String(0.05 * 1e27),
      reserveLiquidationThreshold: '7800',
      price: { priceInEth: String(50000 * 1e8) }, // $50k, 8 decimals
    };
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ data: { reserves: [reserve] } }), { status: 200 })
    );
    const res = await fetchAaveV3MultiChain({ mainnet: '0xDEAD' });
    expect(res).toHaveLength(1);
    const m = res[0];
    expect(m.underlyingAsset).toBe('0xdead');
    expect(m.totalSuppliedTokens).toBe(2);
    expect(m.totalBorrowedTokens).toBe(1);
    expect(m.totalSuppliedUsd).toBe(2 * 50000);
    expect(m.priceUsd).toBe(50000);
    expect(m.supplyApr).toBeCloseTo(0.03);
    expect(m.variableBorrowApr).toBeCloseTo(0.05);
    expect(m.liquidationThresholdBps).toBe(7800);
    expect(m.supplyCapTokens).toBeNull(); // 0 = uncapped
    expect(m.borrowCapTokens).toBe(500);
    expect(m.utilization).toBeCloseTo(0.5);
  });

  it('sets USD fields null when the oracle price is 0', async () => {
    const reserve = {
      underlyingAsset: '0xfeed',
      symbol: 'X',
      decimals: 18,
      isActive: true,
      isFrozen: false,
      borrowingEnabled: false,
      usageAsCollateralEnabled: false,
      totalATokenSupply: String(10n ** 18n),
      totalCurrentVariableDebt: '0',
      availableLiquidity: String(10n ** 18n),
      supplyCap: '0',
      borrowCap: '0',
      liquidityRate: '0',
      variableBorrowRate: '0',
      reserveLiquidationThreshold: '0',
      price: { priceInEth: '0' },
    };
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ data: { reserves: [reserve] } }), { status: 200 })
    );
    const res = await fetchAaveV3MultiChain({ mainnet: '0xfeed' });
    expect(res[0].priceUsd).toBeNull();
    expect(res[0].totalSuppliedUsd).toBeNull();
    expect(res[0].totalBorrowedUsd).toBeNull();
    expect(res[0].liquidationThresholdBps).toBeNull(); // 0 -> null
  });

  it('swallows a non-ok response per chain and records a deficiency', async () => {
    const { recordDeficiency } = await import('@/lib/tokens/deficiencies');
    mockFetch.mockResolvedValue(new Response('boom', { status: 502 }));
    const res = await fetchAaveV3MultiChain({ mainnet: '0xabc', arbitrum: '0xdef' });
    expect(res).toEqual([]);
    expect(recordDeficiency).toHaveBeenCalledWith(
      'AAVE_V3_QUERY_FAILED',
      expect.stringContaining('aave v3')
    );
  });

  it('swallows a GraphQL errors body per chain', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ errors: [{ message: 'bad query' }] }), { status: 200 })
    );
    const res = await fetchAaveV3MultiChain({ base: '0xabc' });
    expect(res).toEqual([]);
  });
});
