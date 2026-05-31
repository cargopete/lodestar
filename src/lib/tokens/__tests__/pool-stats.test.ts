import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchPoolStats } from '@/lib/tokens/pool-stats';

vi.mock('@/lib/tokens/deficiencies', () => ({
  recordDeficiency: vi.fn(),
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('fetchPoolStats', () => {
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

  it('returns empty map when API key is missing', async () => {
    delete process.env.GRAPH_API_KEY;
    const res = await fetchPoolStats(['0xpool'], '0xseed', 2000);
    expect(res.size).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns empty map for empty pool list', async () => {
    const res = await fetchPoolStats([], '0xseed', 2000);
    expect(res.size).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('parses V3 pool stats and derives seed price against a stablecoin counterparty', async () => {
    // V3 returns the pool; V2 returns nothing. fetchPoolStats fires both URLs;
    // route by URL substring.
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV')) {
        return Promise.resolve(
          jsonResponse({
            data: {
              pools: [
                {
                  id: '0xPOOL',
                  feeTier: '3000',
                  totalValueLockedUSD: '1000000',
                  // seed is token0, counterparty USDC is token1.
                  // token1Price = counterparty per seed = 1.5 USDC per seed.
                  token0Price: '0.6666',
                  token1Price: '1.5',
                  token0: { id: '0xSEED', symbol: 'SEED' },
                  token1: { id: '0xUSDC', symbol: 'USDC' },
                  poolDayData: [{ date: 1, volumeUSD: '50000' }],
                },
              ],
            },
          })
        );
      }
      return Promise.resolve(jsonResponse({ data: { pairs: [], pairDayDatas: [] } }));
    });

    const res = await fetchPoolStats(['0xPOOL'], '0xSEED', 2000);
    const stats = res.get('0xpool')!;
    expect(stats.tvlUsd).toBe(1000000);
    expect(stats.volume24hUsd).toBe(50000);
    expect(stats.feeBps).toBe(3000);
    expect(stats.seedPriceUsd).toBeCloseTo(1.5); // 1.5 USDC * $1
  });

  it('derives seed price against WETH using ethUsd', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV')) {
        return Promise.resolve(
          jsonResponse({
            data: {
              pools: [
                {
                  id: '0xpool2',
                  feeTier: '500',
                  totalValueLockedUSD: '500',
                  // seed is token1, counterparty WETH is token0.
                  // token0Price = counterparty(WETH) per seed = 0.001 WETH/seed
                  token0Price: '0.001',
                  token1Price: '1000',
                  token0: { id: '0xweth', symbol: 'WETH' },
                  token1: { id: '0xseed', symbol: 'SEED' },
                  poolDayData: [{ date: 1, volumeUSD: '0' }],
                },
              ],
            },
          })
        );
      }
      return Promise.resolve(jsonResponse({ data: { pairs: [], pairDayDatas: [] } }));
    });

    const res = await fetchPoolStats(['0xpool2'], '0xseed', 2000);
    const stats = res.get('0xpool2')!;
    expect(stats.seedPriceUsd).toBeCloseTo(0.001 * 2000); // $2
    expect(stats.volume24hUsd).toBeNull(); // 0 -> null
  });

  it('leaves seedPriceUsd null for non-stable/non-eth counterparty', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV')) {
        return Promise.resolve(
          jsonResponse({
            data: {
              pools: [
                {
                  id: '0xp3',
                  feeTier: '3000',
                  totalValueLockedUSD: '100',
                  token0Price: '1',
                  token1Price: '1',
                  token0: { id: '0xseed', symbol: 'SEED' },
                  token1: { id: '0xother', symbol: 'OTHER' },
                  poolDayData: [],
                },
              ],
            },
          })
        );
      }
      return Promise.resolve(jsonResponse({ data: { pairs: [], pairDayDatas: [] } }));
    });
    const res = await fetchPoolStats(['0xp3'], '0xseed', 2000);
    expect(res.get('0xp3')!.seedPriceUsd).toBeNull();
  });

  it('parses V2 pair stats, merging latest-day volume and hardcoded 0.3% fee', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('GmSczqdCDZ3hJeYY9JphwsADn5rePUzUKm8EZcVuhRAm')) {
        return Promise.resolve(
          jsonResponse({
            data: {
              pairs: [{ id: '0xPAIR', reserveUSD: '2000' }],
              pairDayDatas: [
                { pairAddress: '0xpair', date: 2, dailyVolumeUSD: '300' },
                { pairAddress: '0xpair', date: 1, dailyVolumeUSD: '100' }, // older, ignored
              ],
            },
          })
        );
      }
      return Promise.resolve(jsonResponse({ data: { pools: [] } }));
    });
    const res = await fetchPoolStats(['0xPAIR'], '0xseed', null);
    const stats = res.get('0xpair')!;
    expect(stats.tvlUsd).toBe(2000);
    expect(stats.volume24hUsd).toBe(300); // first (desc) wins
    expect(stats.feeBps).toBe(3000);
  });

  it('V2 entry overwrites V3 entry for the same pool id (merge order)', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV')) {
        return Promise.resolve(
          jsonResponse({
            data: {
              pools: [
                {
                  id: '0xdup',
                  feeTier: '3000',
                  totalValueLockedUSD: '111',
                  token0Price: '1',
                  token1Price: '1',
                  token0: { id: '0xa', symbol: 'A' },
                  token1: { id: '0xb', symbol: 'B' },
                  poolDayData: [],
                },
              ],
            },
          })
        );
      }
      return Promise.resolve(
        jsonResponse({
          data: {
            pairs: [{ id: '0xdup', reserveUSD: '222' }],
            pairDayDatas: [],
          },
        })
      );
    });
    const res = await fetchPoolStats(['0xdup'], '0xseed', null);
    expect(res.get('0xdup')!.tvlUsd).toBe(222); // V2 wins
  });

  it('records a deficiency and yields no V3 rows on non-ok V3 response', async () => {
    const { recordDeficiency } = await import('@/lib/tokens/deficiencies');
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV')) {
        return Promise.resolve(new Response('boom', { status: 500 }));
      }
      return Promise.resolve(jsonResponse({ data: { pairs: [], pairDayDatas: [] } }));
    });
    const res = await fetchPoolStats(['0xany'], '0xseed', null);
    expect(res.size).toBe(0);
    expect(recordDeficiency).toHaveBeenCalledWith(
      'POOL_STATS_QUERY_FAILED',
      expect.stringContaining('v3 pool-stats')
    );
  });

  it('records a deficiency on a V2 GraphQL errors body', async () => {
    const { recordDeficiency } = await import('@/lib/tokens/deficiencies');
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('GmSczqdCDZ3hJeYY9JphwsADn5rePUzUKm8EZcVuhRAm')) {
        return Promise.resolve(jsonResponse({ errors: [{ message: 'v2 bad' }] }));
      }
      return Promise.resolve(jsonResponse({ data: { pools: [] } }));
    });
    const res = await fetchPoolStats(['0xany'], '0xseed', null);
    expect(res.size).toBe(0);
    expect(recordDeficiency).toHaveBeenCalledWith(
      'POOL_STATS_QUERY_FAILED',
      expect.stringContaining('v2 pair-stats')
    );
  });
});
