import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchProtocolDetail, fetchProtocolSummary } from '../fetcher';
import type { ProtocolConfig, SchemaType } from '../config';

// fetchProtocolDetail issues a POST to the Graph gateway and normalizes the
// JSON response per schema. We mock fetch and feed each normalizer a crafted
// payload. Time is frozen so the 30-day window is deterministic.

const FIXED_NOW = 1_700_000_000_000; // 2023-11-14T...Z
const NOW_S = Math.floor(FIXED_NOW / 1000);
const DAY = 86400;

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
  mockFetch = vi.fn();
  vi.stubGlobal('fetch', mockFetch);
  process.env.GRAPH_API_KEY = 'gk';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete process.env.GRAPH_API_KEY;
});

function graphOk(data: unknown) {
  return new Response(JSON.stringify({ data }), { status: 200 });
}

function cfg(schemaType: SchemaType, over: Partial<ProtocolConfig> = {}): ProtocolConfig {
  return {
    slug: 'test-proto',
    name: 'Test',
    category: 'DEX',
    description: 'd',
    subgraphId: 'sg1',
    schemaType,
    website: 'https://x',
    chains: ['Ethereum'],
    color: '#FFFFFF',
    ...over,
  };
}

// Recent (within 30d) and old (outside 30d) timestamps for window tests.
const TS_RECENT = NOW_S - 5 * DAY;
const TS_OLD = NOW_S - 60 * DAY;

describe('queryProtocolSubgraph error handling (via fetchProtocolDetail)', () => {
  it('throws when GRAPH_API_KEY is missing', async () => {
    delete process.env.GRAPH_API_KEY;
    await expect(fetchProtocolDetail(cfg('messari-dex'))).rejects.toThrow('GRAPH_API_KEY not configured');
  });

  it('throws on a non-ok HTTP response', async () => {
    mockFetch.mockResolvedValue(new Response('boom', { status: 500 }));
    await expect(fetchProtocolDetail(cfg('messari-dex'))).rejects.toThrow(/request failed: 500/);
  });

  it('throws when the GraphQL body carries errors', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ errors: [{ message: 'bad' }] }), { status: 200 }));
    await expect(fetchProtocolDetail(cfg('messari-dex'))).rejects.toThrow(/GraphQL errors/);
  });

  it('POSTs the query as JSON to the gateway url with the api key', async () => {
    mockFetch.mockResolvedValue(graphOk({ dexAmmProtocols: [], financialsDailySnapshots: [] }));
    await fetchProtocolDetail(cfg('messari-dex', { subgraphId: 'SG' }));
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/gk/subgraphs/id/SG');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body).query).toContain('dexAmmProtocols');
  });
});

describe('normalizeMessariDex', () => {
  it('maps snapshots, computes the 30d window, and surfaces cumulative metrics', async () => {
    mockFetch.mockResolvedValue(
      graphOk({
        dexAmmProtocols: [{ totalValueLockedUSD: '1000', cumulativeVolumeUSD: '5000', cumulativeTotalRevenueUSD: '50' }],
        financialsDailySnapshots: [
          { timestamp: String(TS_RECENT), totalValueLockedUSD: '1000', dailyVolumeUSD: '200', dailyTotalRevenueUSD: '2' },
          { timestamp: String(TS_OLD), totalValueLockedUSD: '900', dailyVolumeUSD: '999', dailyTotalRevenueUSD: '9' },
        ],
      }),
    );
    const d = await fetchProtocolDetail(cfg('messari-dex'));
    expect(d.summary.tvlUSD).toBe(1000);
    expect(d.summary.cumulativeVolumeUSD).toBe(5000);
    expect(d.summary.cumulativeFeesUSD).toBe(50);
    // Only the recent snapshot counts toward the 30d window.
    expect(d.summary.volume30dUSD).toBe(200);
    expect(d.summary.fees30dUSD).toBe(2);
    // Snapshots are sorted ascending by timestamp.
    expect(d.snapshots[0].timestamp).toBeLessThan(d.snapshots[1].timestamp);
  });

  it('falls back to the snapshot sum when cumulative is an absurd unscaled value', async () => {
    mockFetch.mockResolvedValue(
      graphOk({
        dexAmmProtocols: [{ totalValueLockedUSD: '1', cumulativeVolumeUSD: '1e30', cumulativeTotalRevenueUSD: '0' }],
        financialsDailySnapshots: [
          { timestamp: String(TS_RECENT), totalValueLockedUSD: '1', dailyVolumeUSD: '100', dailyTotalRevenueUSD: '1' },
          { timestamp: String(TS_OLD), totalValueLockedUSD: '1', dailyVolumeUSD: '100', dailyTotalRevenueUSD: '1' },
        ],
      }),
    );
    const d = await fetchProtocolDetail(cfg('messari-dex'));
    // 1e30 > 1e15 ceiling -> clamps to snapshot volume sum (200).
    expect(d.summary.cumulativeVolumeUSD).toBe(200);
  });

  it('handles a protocol entity that is entirely absent', async () => {
    mockFetch.mockResolvedValue(graphOk({ dexAmmProtocols: [], financialsDailySnapshots: [] }));
    const d = await fetchProtocolDetail(cfg('messari-dex'));
    expect(d.summary.tvlUSD).toBe(0);
    expect(d.snapshots).toEqual([]);
  });
});

describe('normalizeMessariLending', () => {
  it('maps dailyBorrowUSD to volume and surfaces totalBorrowUSD', async () => {
    mockFetch.mockResolvedValue(
      graphOk({
        lendingProtocols: [{ totalValueLockedUSD: '2000', totalBorrowBalanceUSD: '700', cumulativeBorrowUSD: '8000', cumulativeTotalRevenueUSD: '80' }],
        financialsDailySnapshots: [
          { timestamp: String(TS_RECENT), totalValueLockedUSD: '2000', dailyBorrowUSD: '300', dailyTotalRevenueUSD: '3' },
        ],
      }),
    );
    const d = await fetchProtocolDetail(cfg('messari-lending'));
    expect(d.summary.totalBorrowUSD).toBe(700);
    expect(d.summary.volume30dUSD).toBe(300);
    expect(d.summary.cumulativeVolumeUSD).toBe(8000);
  });
});

describe('normalizeMessariRwa', () => {
  it('uses revenue as both volume and fees and exposes rwa extras', async () => {
    mockFetch.mockResolvedValue(
      graphOk({
        lendingProtocols: [{
          totalValueLockedUSD: '500', totalDepositBalanceUSD: '500', totalBorrowBalanceUSD: '400',
          cumulativeBorrowUSD: '9000', cumulativeTotalRevenueUSD: '120', cumulativeLiquidateUSD: '7',
          totalPoolCount: 4, openPositionCount: 3, cumulativeUniqueBorrowers: 12,
        }],
        financialsDailySnapshots: [
          { timestamp: String(TS_RECENT), totalValueLockedUSD: '500', dailyTotalRevenueUSD: '10' },
        ],
      }),
    );
    const d = await fetchProtocolDetail(cfg('messari-rwa'));
    expect(d.snapshots[0].volumeUSD).toBe(10);
    expect(d.snapshots[0].feesUSD).toBe(10);
    expect(d.summary.rwaPoolCount).toBe(4);
    expect(d.summary.rwaUniqueBorrowers).toBe(12);
    expect(d.summary.rwaOpenPositionCount).toBe(3);
    expect(d.summary.rwaDefaultsUSD).toBe(7);
    expect(d.summary.rwaDrawnBalanceUSD).toBe(400);
    expect(d.summary.rwaCumulativeBorrowUSD).toBe(9000);
  });
});

describe('normalizeMessariStaking', () => {
  it('back-derives daily protocol fees from the cumulative ratio when reported daily is 0', async () => {
    // ratio = protocol/supply = 100/1000 = 0.1; daily supply 50 -> fee 5.
    mockFetch.mockResolvedValue(
      graphOk({
        protocols: [{ totalValueLockedUSD: '10000', cumulativeSupplySideRevenueUSD: '1000', cumulativeProtocolSideRevenueUSD: '100', cumulativeTotalRevenueUSD: '1100' }],
        financialsDailySnapshots: [
          { timestamp: String(TS_RECENT), totalValueLockedUSD: '10000', dailySupplySideRevenueUSD: '50', dailyProtocolSideRevenueUSD: '0' },
        ],
      }),
    );
    const d = await fetchProtocolDetail(cfg('messari-staking'));
    expect(d.snapshots[0].volumeUSD).toBe(50);
    expect(d.snapshots[0].feesUSD).toBeCloseTo(5, 6);
    expect(d.summary.stakingAPR).toBeGreaterThan(0);
  });

  it('prefers a reported daily protocol fee over the estimate', async () => {
    mockFetch.mockResolvedValue(
      graphOk({
        protocols: [{ totalValueLockedUSD: '10000', cumulativeSupplySideRevenueUSD: '1000', cumulativeProtocolSideRevenueUSD: '100', cumulativeTotalRevenueUSD: '1100' }],
        financialsDailySnapshots: [
          { timestamp: String(TS_RECENT), totalValueLockedUSD: '10000', dailySupplySideRevenueUSD: '50', dailyProtocolSideRevenueUSD: '42' },
        ],
      }),
    );
    const d = await fetchProtocolDetail(cfg('messari-staking'));
    expect(d.snapshots[0].feesUSD).toBe(42);
  });
});

describe('normalizeMessariYield', () => {
  it('reads from yieldAggregators and back-derives fees like staking', async () => {
    mockFetch.mockResolvedValue(
      graphOk({
        yieldAggregators: [{ totalValueLockedUSD: '5000', cumulativeSupplySideRevenueUSD: '200', cumulativeProtocolSideRevenueUSD: '20', cumulativeTotalRevenueUSD: '220' }],
        financialsDailySnapshots: [
          { timestamp: String(TS_RECENT), totalValueLockedUSD: '5000', dailySupplySideRevenueUSD: '100', dailyProtocolSideRevenueUSD: '0' },
        ],
      }),
    );
    const d = await fetchProtocolDetail(cfg('messari-yield'));
    // ratio 20/200 = 0.1 -> fee 10.
    expect(d.snapshots[0].feesUSD).toBeCloseTo(10, 6);
  });
});

describe('normalizeMessariBridge', () => {
  it('maps dailyVolumeOutUSD to volume', async () => {
    mockFetch.mockResolvedValue(
      graphOk({
        bridgeProtocols: [{ totalValueLockedUSD: '3000', cumulativeTotalVolumeUSD: '90000', cumulativeTotalRevenueUSD: '900' }],
        financialsDailySnapshots: [
          { timestamp: String(TS_RECENT), totalValueLockedUSD: '3000', dailyVolumeOutUSD: '400', dailyTotalRevenueUSD: '4' },
        ],
      }),
    );
    const d = await fetchProtocolDetail(cfg('messari-bridge'));
    expect(d.snapshots[0].volumeUSD).toBe(400);
    expect(d.summary.cumulativeVolumeUSD).toBe(90000);
  });
});

describe('normalizeMessariPerp', () => {
  it('surfaces open-interest extras', async () => {
    mockFetch.mockResolvedValue(
      graphOk({
        derivPerpProtocols: [{ totalValueLockedUSD: '100', cumulativeVolumeUSD: '500', cumulativeTotalRevenueUSD: '5', totalOpenInterestUSD: '70', longOpenInterestUSD: '40', shortOpenInterestUSD: '30' }],
        financialsDailySnapshots: [
          { timestamp: String(TS_RECENT), totalValueLockedUSD: '100', dailyVolumeUSD: '10', dailyTotalRevenueUSD: '1' },
        ],
      }),
    );
    const d = await fetchProtocolDetail(cfg('messari-perp'));
    expect(d.summary.perpOpenInterestUSD).toBe(70);
    expect(d.summary.perpLongOpenInterestUSD).toBe(40);
    expect(d.summary.perpShortOpenInterestUSD).toBe(30);
  });
});

describe('normalizeUniswapV3', () => {
  it('reads factory cumulative fields and day data', async () => {
    mockFetch.mockResolvedValue(
      graphOk({
        factories: [{ totalVolumeUSD: '7000', totalValueLockedUSD: '600', totalFeesUSD: '21', txCount: '99' }],
        uniswapDayDatas: [
          { date: String(TS_RECENT), volumeUSD: '250', feesUSD: '0.75', tvlUSD: '600' },
        ],
      }),
    );
    const d = await fetchProtocolDetail(cfg('uniswap-v3'));
    expect(d.summary.tvlUSD).toBe(600);
    expect(d.summary.cumulativeVolumeUSD).toBe(7000);
    expect(d.summary.cumulativeFeesUSD).toBe(21);
    expect(d.snapshots[0].volumeUSD).toBe(250);
  });
});

describe('algebra-v1 reuses the uniswap-v3 normalizer', () => {
  it('maps algebraDayDatas through the v3 shape', async () => {
    mockFetch.mockResolvedValue(
      graphOk({
        factories: [{ totalVolumeUSD: '10', totalValueLockedUSD: '5', totalFeesUSD: '1', txCount: '2' }],
        algebraDayDatas: [{ date: String(TS_RECENT), volumeUSD: '3', feesUSD: '0.1', tvlUSD: '5' }],
      }),
    );
    const d = await fetchProtocolDetail(cfg('algebra-v1'));
    expect(d.snapshots[0].volumeUSD).toBe(3);
    expect(d.summary.tvlUSD).toBe(5);
  });
});

describe('normalizeUniswapV2', () => {
  it('derives fees from volume at the flat 0.30% rate', async () => {
    mockFetch.mockResolvedValue(
      graphOk({
        uniswapFactory: { totalVolumeUSD: '1000', totalLiquidityUSD: '500' },
        uniswapDayDatas: [{ date: String(TS_RECENT), dailyVolumeUSD: '100', totalLiquidityUSD: '500' }],
      }),
    );
    const d = await fetchProtocolDetail(cfg('uniswap-v2'));
    expect(d.summary.cumulativeFeesUSD).toBeCloseTo(3, 6); // 1000 * 0.003
    expect(d.snapshots[0].feesUSD).toBeCloseTo(0.3, 6); // 100 * 0.003
  });

  it('handles a null factory', async () => {
    mockFetch.mockResolvedValue(graphOk({ uniswapFactory: null, uniswapDayDatas: [] }));
    const d = await fetchProtocolDetail(cfg('uniswap-v2'));
    expect(d.summary.cumulativeVolumeUSD).toBe(0);
    expect(d.summary.tvlUSD).toBe(0);
  });
});

describe('normalizeBalancerV2', () => {
  it('converts cumulative snapshots into daily deltas, clamping regressions to 0', async () => {
    // ascending timestamps; deltas computed from i-1.
    mockFetch.mockResolvedValue(
      graphOk({
        balancers: [{ id: '1', totalLiquidity: '900', totalSwapVolume: '0', totalSwapFee: '0', poolCount: 5 }],
        balancerSnapshots: [
          { timestamp: String(TS_RECENT - 2 * DAY), totalLiquidity: '800', totalSwapVolume: '1000', totalSwapFee: '10' },
          { timestamp: String(TS_RECENT - 1 * DAY), totalLiquidity: '850', totalSwapVolume: '1300', totalSwapFee: '13' }, // +300 / +3
          { timestamp: String(TS_RECENT), totalLiquidity: '900', totalSwapVolume: '1200', totalSwapFee: '15' },          // regression vol -> 0, fee +2
        ],
      }),
    );
    const d = await fetchProtocolDetail(cfg('balancer-v2'));
    // First snapshot is the anchor (skipped) -> 2 delta rows.
    expect(d.snapshots).toHaveLength(2);
    expect(d.snapshots[0].volumeUSD).toBe(300);
    expect(d.snapshots[1].volumeUSD).toBe(0); // clamped negative delta
    // Cumulative is the snapshot-window sum, not the protocol field.
    expect(d.summary.cumulativeVolumeUSD).toBe(300);
    expect(d.summary.tvlUSD).toBe(900);
  });
});

describe('normalizeGmxV2Synthetics', () => {
  it('rescales 1e30 USD, intersects volume+fee day keys, and sums cumulative', async () => {
    const S = 1e30;
    mockFetch.mockResolvedValue(
      graphOk({
        totalPosition: [{ timestamp: '0', volumeUsd: String(2 * S) }, { timestamp: '0', volumeUsd: String(3 * S) }],
        totalFees: [{ timestampGroup: '0', feeUsdForPool: String(1 * S) }],
        // day with both vol+fee kept; day with only vol dropped by intersection.
        dp0: [{ timestamp: String(TS_RECENT), volumeUsd: String(10 * S) }, { timestamp: String(TS_OLD), volumeUsd: String(99 * S) }],
        dp1: [], dp2: [], dp3: [], dp4: [],
        df0: [{ timestampGroup: String(TS_RECENT), feeUsdForPool: String(1 * S) }],
        df1: [], df2: [], df3: [], df4: [],
      }),
    );
    const d = await fetchProtocolDetail(cfg('gmx-v2-synthetics'));
    expect(d.summary.cumulativeVolumeUSD).toBe(5); // (2+3)
    expect(d.summary.cumulativeFeesUSD).toBe(1);
    expect(d.summary.tvlUSD).toBe(0); // v1 limitation
    // Only the day present in both vol and fee maps survives.
    expect(d.snapshots).toHaveLength(1);
    expect(d.snapshots[0].timestamp).toBe(TS_RECENT);
    expect(d.snapshots[0].volumeUSD).toBe(10);
    expect(d.snapshots[0].feesUSD).toBe(1);
  });
});

describe('etherfi-native', () => {
  it('returns a zeroed detail when there are no rebase events', async () => {
    // First call: rebase events (empty). Second: eth price.
    mockFetch
      .mockResolvedValueOnce(graphOk({ rebaseEvents: [] }))
      .mockResolvedValueOnce(graphOk({ bundles: [{ ethPriceUSD: '2000' }] }));
    const d = await fetchProtocolDetail(cfg('etherfi-native'));
    expect(d.summary.tvlUSD).toBe(0);
    expect(d.snapshots).toEqual([]);
  });

  it('derives TVL and per-day yield from rebase share-price deltas', async () => {
    const ethPrice = 2000;
    // day1: price 1.0 (100 eth / 100 shares). day2: price 1.1 (110/100).
    // yield = sharesPrev(100) * (1.1 - 1.0) = 10 eth -> $20000.
    mockFetch
      .mockResolvedValueOnce(
        graphOk({
          rebaseEvents: [
            { timestamp: String(TS_RECENT - DAY), totalEthLocked: String(100n * 10n ** 18n), totalEEthShares: String(100n * 10n ** 18n), aprs: [] },
            { timestamp: String(TS_RECENT), totalEthLocked: String(110n * 10n ** 18n), totalEEthShares: String(100n * 10n ** 18n), aprs: [] },
          ],
        }),
      )
      .mockResolvedValueOnce(graphOk({ bundles: [{ ethPriceUSD: String(ethPrice) }] }));
    const d = await fetchProtocolDetail(cfg('etherfi-native'));
    expect(d.summary.tvlUSD).toBeCloseTo(110 * ethPrice, 0);
    expect(d.snapshots).toHaveLength(1);
    expect(d.snapshots[0].volumeUSD).toBeCloseTo(20000, 0);
    expect(d.snapshots[0].feesUSD).toBeCloseTo(2000, 0); // 10% of yield
  });
});

describe('polymarket', () => {
  it('normalizes orderbook/oi/main/resolution into a prediction-markets detail and hydrates titles', async () => {
    // 5 parallel-ish calls: orderbook, oi, main, resolution (4 queryDeployment),
    // then CLOB hydration for each top market (1 here).
    mockFetch.mockImplementation((url: string, opts: { body: string }) => {
      const body = opts?.body ? JSON.parse(opts.body).query : '';
      if (typeof url === 'string' && url.startsWith('https://clob.polymarket.com')) {
        return Promise.resolve(new Response(JSON.stringify({ condition_id: 'm1', question: 'Will X happen?', market_slug: 'will-x' }), { status: 200 }));
      }
      if (body.includes('ordersMatchedGlobals')) {
        return Promise.resolve(graphOk({ ordersMatchedGlobals: [{ tradesQuantity: '1000', scaledCollateralVolume: '500000', totalFees: '6000000', averageTradeSize: '500' }] }));
      }
      if (body.includes('marketOpenInterests')) {
        return Promise.resolve(graphOk({ marketOpenInterests: [{ id: 'm1', amount: '12345', splitCount: '3', mergeCount: '1' }], globalOpenInterests: [{ marketCount: 42 }] }));
      }
      if (body.includes('globals')) {
        return Promise.resolve(graphOk({ globals: [{ numConditions: '700', numOpenConditions: '120', numClosedConditions: '580', numTraders: '9000' }] }));
      }
      if (body.includes('marketResolutions')) {
        return Promise.resolve(graphOk({
          recentResolutions: [{ id: 'r1', status: 'resolved', flagged: false, wasDisputed: true, price: String(10n ** 18n), lastUpdateTimestamp: String(TS_RECENT), ancillaryData: '0x' }],
          disputedSample: [{ id: 'd1' }, { id: 'd2' }],
        }));
      }
      return Promise.resolve(graphOk({}));
    });
    const d = await fetchProtocolDetail(cfg('polymarket'));
    expect(d.snapshots).toEqual([]);
    expect(d.summary.tvlUSD).toBe(12345); // sum of market OI
    expect(d.summary.cumulativeVolumeUSD).toBe(500000);
    expect(d.summary.cumulativeFeesUSD).toBeCloseTo(6, 6); // 6000000 / 1e6
    expect(d.predictionMarkets).toBeDefined();
    const pm = d.predictionMarkets!;
    expect(pm.totalMarkets).toBe(700);
    expect(pm.resolvedMarkets).toBe(580);
    expect(pm.totalTraders).toBe(9000);
    expect(pm.marketCountWithOI).toBe(42);
    expect(pm.disputedCount).toBe(2);
    expect(pm.recentResolutions[0].outcome).toBe('YES'); // price 1e18 / 1e18 = 1.0
    // Title hydrated from the CLOB API.
    expect(pm.topMarketsByOI[0].title).toBe('Will X happen?');
    expect(pm.topMarketsByOI[0].slug).toBe('will-x');
  });
});

describe('fetchProtocolSummary', () => {
  it('returns just the summary on success', async () => {
    mockFetch.mockResolvedValue(
      graphOk({
        dexAmmProtocols: [{ totalValueLockedUSD: '1', cumulativeVolumeUSD: '2', cumulativeTotalRevenueUSD: '3' }],
        financialsDailySnapshots: [],
      }),
    );
    const s = await fetchProtocolSummary(cfg('messari-dex'));
    expect(s).not.toBeNull();
    expect(s!.tvlUSD).toBe(1);
  });

  it('returns null when fetchProtocolDetail throws', async () => {
    mockFetch.mockResolvedValue(new Response('err', { status: 500 }));
    const s = await fetchProtocolSummary(cfg('messari-dex'));
    expect(s).toBeNull();
  });
});
