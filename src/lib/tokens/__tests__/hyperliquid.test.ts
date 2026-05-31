import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  seedToHyperliquidCoin,
  fetchAllHyperliquidPerps,
  fetchHyperliquidForSeed,
} from '@/lib/tokens/hyperliquid';
import type { TokenSeed } from '@/lib/tokens/types';

const tokenApiGet = vi.fn();
vi.mock('@/lib/tokens/api', () => ({
  tokenApiGet: (...args: unknown[]) => tokenApiGet(...args),
}));
vi.mock('@/lib/tokens/deficiencies', () => ({ recordDeficiency: vi.fn() }));

function seed(overrides: Partial<TokenSeed> = {}): TokenSeed {
  return {
    contract: '0xseed',
    symbol: 'BTC',
    chain: 'mainnet',
    pool: { address: '0xpool', quote: 'usd', inverse: false },
    ...overrides,
  };
}

// Route tokenApiGet calls by endpoint path to a per-path response factory.
function routeApi(map: Record<string, unknown[]>) {
  tokenApiGet.mockImplementation((path: string) => {
    const data = map[path] ?? [];
    return Promise.resolve({ data });
  });
}

beforeEach(() => {
  tokenApiGet.mockReset();
});

describe('seedToHyperliquidCoin', () => {
  it('maps wrapped symbols to their unwrapped HL coin', () => {
    expect(seedToHyperliquidCoin(seed({ symbol: 'WBTC' }))).toBe('BTC');
    expect(seedToHyperliquidCoin(seed({ symbol: 'WETH' }))).toBe('ETH');
  });

  it('maps low-unit memecoins to the k-prefixed coin', () => {
    expect(seedToHyperliquidCoin(seed({ symbol: 'PEPE' }))).toBe('kPEPE');
    expect(seedToHyperliquidCoin(seed({ symbol: 'shib' }))).toBe('kSHIB');
  });

  it('passes through unmapped symbols uppercased', () => {
    expect(seedToHyperliquidCoin(seed({ symbol: 'sol' }))).toBe('SOL');
  });

  it('returns null for stablecoins and empty symbols', () => {
    expect(seedToHyperliquidCoin(seed({ symbol: 'USDC', tags: ['Stablecoin'] }))).toBeNull();
    expect(seedToHyperliquidCoin(seed({ symbol: '' }))).toBeNull();
  });
});

describe('fetchAllHyperliquidPerps', () => {
  it('filters to perps dex and keys by coin', async () => {
    let call = 0;
    tokenApiGet.mockImplementation(() => {
      call++;
      if (call === 1) {
        return Promise.resolve({
          data: [
            { coin: 'BTC', dex: 'perps' },
            { coin: 'FOO', dex: 'spot' },
          ],
        });
      }
      return Promise.resolve({ data: [] });
    });
    const map = await fetchAllHyperliquidPerps();
    expect(map.has('BTC')).toBe(true);
    expect(map.has('FOO')).toBe(false);
  });

  it('tolerates a rejecting page without throwing', async () => {
    let call = 0;
    tokenApiGet.mockImplementation(() => {
      call++;
      if (call === 1) return Promise.reject(new Error('boom'));
      if (call === 2) return Promise.resolve({ data: [{ coin: 'ETH', dex: 'perps' }] });
      return Promise.resolve({ data: [] });
    });
    const map = await fetchAllHyperliquidPerps();
    expect(map.has('ETH')).toBe(true);
  });
});

describe('fetchHyperliquidForSeed', () => {
  it('returns null when the seed maps to no coin (stablecoin)', async () => {
    const res = await fetchHyperliquidForSeed(seed({ symbol: 'USDC', tags: ['Stablecoin'] }));
    expect(res).toBeNull();
    expect(tokenApiGet).not.toHaveBeenCalled();
  });

  it('returns null when no perp snapshot exists for the coin', async () => {
    routeApi({
      '/v1/hyperliquid/markets': [], // snapshot find -> none
      '/v1/hyperliquid/markets/liquidations/ohlc': [],
      '/v1/hyperliquid/markets/oi': [],
      '/v1/hyperliquid/markets/ohlc': [],
      '/v1/hyperliquid/markets/liquidations': [],
    });
    const res = await fetchHyperliquidForSeed(seed({ symbol: 'SOL' }));
    expect(res).toBeNull();
  });

  it('assembles a full summary on the happy path', async () => {
    const oiRows = Array.from({ length: 25 }, (_, i) => ({
      timestamp: `2026-05-31 0${i % 10}:00:00`,
      coin: 'BTC',
      interval_min: 60,
      // newest is index 0; oldest (index 24) used for delta.
      open_interest: i === 0 ? 110 : i === 24 ? 100 : 105,
      long_positions: 10,
      short_positions: 5,
      long_size: 1000,
      short_size: -800,
      funding_rate: 1.25e-5,
    }));
    const ohlcRows = [
      { timestamp: 't2', open: 1, high: 110, low: 90, close: 105 },
      { timestamp: 't1', open: 1, high: 120, low: 80, close: 100 },
    ];
    const recentLiqIso = new Date().toISOString().replace('T', ' ').replace('Z', '').slice(0, 19);

    tokenApiGet.mockImplementation((path: string, params: Record<string, unknown>) => {
      switch (path) {
        case '/v1/hyperliquid/markets':
          // snapshot lookup (has coin param). Return a perps row.
          if (params.coin) {
            return Promise.resolve({
              data: [
                {
                  coin: 'BTC',
                  dex: 'perps',
                  price: 50000,
                  price_24h_change: 0.05,
                  trades_24h: 1234,
                  unique_users_24h: 99,
                  volume_24h: 1e9,
                  buy_volume_24h: 6e8,
                  sell_volume_24h: 4e8,
                  open_interest: 2,
                  funding_rate: 1.25e-5,
                  funding_snapshot_time: '2026-05-31 12:00:00',
                },
              ],
            });
          }
          return Promise.resolve({ data: [] });
        case '/v1/hyperliquid/markets/liquidations/ohlc':
          return Promise.resolve({
            data: [
              {
                timestamp: '2026-05-31 00:00:00',
                coin: 'BTC',
                interval_min: 1440,
                open: 1,
                close: 1,
                gross_volume: 0,
                close_long_volume: 1000,
                close_short_volume: 500,
                transactions: 7,
                unique_liquidated: 4,
              },
            ],
          });
        case '/v1/hyperliquid/markets/oi':
          return Promise.resolve({ data: oiRows });
        case '/v1/hyperliquid/markets/ohlc':
          return Promise.resolve({ data: ohlcRows });
        case '/v1/hyperliquid/markets/liquidations':
          return Promise.resolve({
            data: [
              { timestamp: recentLiqIso, coin: 'BTC', liquidated_user: '0xabc', direction: 'Close Long', notional: 250000 },
            ],
          });
        default:
          return Promise.resolve({ data: [] });
      }
    });

    const res = (await fetchHyperliquidForSeed(seed({ symbol: 'WBTC' })))!;
    expect(res).not.toBeNull();
    expect(res.coin).toBe('BTC');
    expect(res.priceUsd).toBe(50000);
    expect(res.openInterestTokens).toBe(2);
    expect(res.openInterestUsd).toBe(2 * 50000);
    // delta: (110 - 100) / 100
    expect(res.openInterestChange24h).toBeCloseTo(0.1);
    expect(res.fundingHourly).toBeCloseTo(1.25e-5);
    expect(res.fundingAnnualized).toBeCloseTo(1.25e-5 * 24 * 365);
    expect(res.fundingAtBaseline).toBe(true); // 25 rows pinned at baseline
    expect(res.priceHigh24h).toBe(120);
    expect(res.priceLow24h).toBe(80);
    expect(res.priceHistory24h).toEqual([100, 105]); // reversed to oldest->newest
    expect(res.positioning).toEqual({
      longCount: 10,
      shortCount: 5,
      longSizeTokens: 1000,
      shortSizeTokens: 800, // abs of -800
    });
    expect(res.liquidations24h).toEqual({
      events: 7,
      uniqueUsers: 4,
      longNotionalUsd: 1000,
      shortNotionalUsd: 500,
      totalNotionalUsd: 1500,
      bucketStart: '2026-05-31 00:00:00',
    });
    expect(res.largestLiquidation24h).toEqual({
      notionalUsd: 250000,
      side: 'long',
      user: '0xabc',
      timestamp: recentLiqIso,
    });
    expect(res.marketUrl).toBe('https://app.hyperliquid.xyz/trade/BTC');
  });

  it('omits a stale (>24h) largest liquidation', async () => {
    tokenApiGet.mockImplementation((path: string, params: Record<string, unknown>) => {
      if (path === '/v1/hyperliquid/markets' && params.coin) {
        return Promise.resolve({
          data: [{ coin: 'ETH', dex: 'perps', price: 3000, open_interest: 1, funding_rate: 0 }],
        });
      }
      if (path === '/v1/hyperliquid/markets/liquidations') {
        return Promise.resolve({
          data: [{ timestamp: '2020-01-01 00:00:00', coin: 'ETH', liquidated_user: '0xz', direction: 'Close Short', notional: 999 }],
        });
      }
      return Promise.resolve({ data: [] });
    });
    const res = (await fetchHyperliquidForSeed(seed({ symbol: 'ETH' })))!;
    expect(res.largestLiquidation24h).toBeNull();
    // no oi rows -> delta null, positioning null, liquidations null
    expect(res.openInterestChange24h).toBeNull();
    expect(res.positioning).toBeNull();
    expect(res.liquidations24h).toBeNull();
  });
});
