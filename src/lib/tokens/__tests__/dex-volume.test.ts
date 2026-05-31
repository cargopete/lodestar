import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchDexVolumes } from '@/lib/tokens/dex-volume';
import type { TokenSeed } from '@/lib/tokens/types';

function seed(overrides: Partial<TokenSeed> = {}): TokenSeed {
  return {
    contract: '0xSEED',
    symbol: 'SEED',
    chain: 'mainnet',
    pool: { address: '0xpool', quote: 'usd', inverse: false },
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('fetchDexVolumes', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
    process.env.GRAPH_API_KEY = 'test-key';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.GRAPH_API_KEY;
  });

  it('returns an empty map when GRAPH_API_KEY is missing', async () => {
    delete process.env.GRAPH_API_KEY;
    const res = await fetchDexVolumes([seed()]);
    expect(res.size).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('aggregates the mainnet Uniswap V3 day volume for a seed', async () => {
    mockFetch.mockImplementation((url: string) => {
      // Uniswap V3 mainnet subgraph id
      if (url.includes('5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV')) {
        return Promise.resolve(
          jsonResponse({
            data: { tokens: [{ id: '0xseed', tokenDayData: [{ volumeUSD: '1000' }] }] },
          })
        );
      }
      // Curve deployment
      if (url.includes('QmRpHzsesvv7VTrKjEuutiZ7xEfDfd6jH4mgSeDDbUDVRN')) {
        return Promise.resolve(jsonResponse({ data: { liquidityPools: [] } }));
      }
      // everything else (other subgraphs) -> no tokens
      return Promise.resolve(jsonResponse({ data: { tokens: [] } }));
    });

    const res = await fetchDexVolumes([seed({ contract: '0xSEED' })]);
    const entry = res.get('0xseed')!;
    expect(entry.contract).toBe('0xseed');
    expect(entry.totalUsd).toBe(1000);
    expect(entry.byVenue['Uniswap V3 · Ethereum']).toBe(1000);
  });

  it('uses v2 schema dailyVolumeUSD field for the V2 mainnet subgraph', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('GmSczqdCDZ3hJeYY9JphwsADn5rePUzUKm8EZcVuhRAm')) {
        return Promise.resolve(
          jsonResponse({
            data: { tokens: [{ id: '0xseed', tokenDayData: [{ dailyVolumeUSD: '777' }] }] },
          })
        );
      }
      if (url.includes('QmRpHzsesvv7VTrKjEuutiZ7xEfDfd6jH4mgSeDDbUDVRN')) {
        return Promise.resolve(jsonResponse({ data: { liquidityPools: [] } }));
      }
      return Promise.resolve(jsonResponse({ data: { tokens: [] } }));
    });

    const res = await fetchDexVolumes([seed({ contract: '0xSEED' })]);
    expect(res.get('0xseed')!.byVenue['Uniswap V2 · Ethereum']).toBe(777);
  });

  it('maps L2 volumes back to the primary contract via altContracts', async () => {
    mockFetch.mockImplementation((url: string) => {
      // Uniswap V3 Arbitrum deployment hash
      if (url.includes('QmZ5uwhnwsJXAQGYEF8qKPQ85iVhYAcVZcZAPfrF7ZNb9z')) {
        return Promise.resolve(
          jsonResponse({
            data: { tokens: [{ id: '0xarb', tokenDayData: [{ volumeUSD: '250' }] }] },
          })
        );
      }
      if (url.includes('QmRpHzsesvv7VTrKjEuutiZ7xEfDfd6jH4mgSeDDbUDVRN')) {
        return Promise.resolve(jsonResponse({ data: { liquidityPools: [] } }));
      }
      return Promise.resolve(jsonResponse({ data: { tokens: [] } }));
    });

    const s = seed({ contract: '0xPRIMARY', altContracts: { arbitrum: '0xARB' } });
    const res = await fetchDexVolumes([s]);
    const entry = res.get('0xprimary')!;
    expect(entry.totalUsd).toBe(250);
    expect(entry.byVenue['Uniswap V3 · Arbitrum']).toBe(250);
  });

  it('attributes Curve daily volume equally across input tokens and filters junk pools', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('QmRpHzsesvv7VTrKjEuutiZ7xEfDfd6jH4mgSeDDbUDVRN')) {
        return Promise.resolve(
          jsonResponse({
            data: {
              liquidityPools: [
                // real pool: 3 inputs, $300 daily -> $100 per leg
                {
                  totalValueLockedUSD: '1000000',
                  inputTokens: [{ id: '0xseed' }, { id: '0xusdc' }, { id: '0xdai' }],
                  dailySnapshots: [{ dailyVolumeUSD: '300' }],
                },
                // junk: TVL below floor -> dropped
                {
                  totalValueLockedUSD: '100',
                  inputTokens: [{ id: '0xseed' }],
                  dailySnapshots: [{ dailyVolumeUSD: '999999' }],
                },
              ],
            },
          })
        );
      }
      return Promise.resolve(jsonResponse({ data: { tokens: [] } }));
    });

    const res = await fetchDexVolumes([seed({ contract: '0xSEED' })]);
    const entry = res.get('0xseed')!;
    expect(entry.byVenue['Curve · Ethereum']).toBeCloseTo(100);
    expect(entry.totalUsd).toBeCloseTo(100);
  });

  it('tolerates a failing subgraph (non-ok) and still returns a seed entry', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV')) {
        return Promise.resolve(new Response('err', { status: 500 }));
      }
      if (url.includes('QmRpHzsesvv7VTrKjEuutiZ7xEfDfd6jH4mgSeDDbUDVRN')) {
        return Promise.resolve(jsonResponse({ data: { liquidityPools: [] } }));
      }
      return Promise.resolve(jsonResponse({ data: { tokens: [] } }));
    });
    const res = await fetchDexVolumes([seed({ contract: '0xSEED' })]);
    const entry = res.get('0xseed')!;
    expect(entry.totalUsd).toBe(0);
    expect(entry.byVenue).toEqual({});
  });

  it('returns a zero-total entry per seed when nothing matches', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('QmRpHzsesvv7VTrKjEuutiZ7xEfDfd6jH4mgSeDDbUDVRN')) {
        return Promise.resolve(jsonResponse({ data: { liquidityPools: [] } }));
      }
      return Promise.resolve(jsonResponse({ data: { tokens: [] } }));
    });
    const res = await fetchDexVolumes([seed({ contract: '0xA' }), seed({ contract: '0xB' })]);
    expect(res.get('0xa')!.totalUsd).toBe(0);
    expect(res.get('0xb')!.totalUsd).toBe(0);
  });

  it('swallows a Curve GraphQL error and yields no Curve volume', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('QmRpHzsesvv7VTrKjEuutiZ7xEfDfd6jH4mgSeDDbUDVRN')) {
        return Promise.resolve(jsonResponse({ errors: [{ message: 'curve bad' }] }));
      }
      return Promise.resolve(jsonResponse({ data: { tokens: [] } }));
    });
    const res = await fetchDexVolumes([seed({ contract: '0xSEED' })]);
    expect(res.get('0xseed')!.byVenue['Curve · Ethereum']).toBeUndefined();
  });
});
