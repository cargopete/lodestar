import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { EnrichedIndexer } from '@/lib/enriched';

const mockCacheGet = vi.fn<(...a: unknown[]) => Promise<unknown>>(() => Promise.resolve(null));
vi.mock('@/lib/cache', () => ({
  cacheGet: (...args: unknown[]) => mockCacheGet(...args),
  cached: vi.fn((_k: string, _t: number, f: () => Promise<unknown>) => f()),
  cacheSet: vi.fn(),
}));

function makeRequest(qs = ''): NextRequest {
  return new NextRequest(new URL(`/api/delegate/recommend${qs}`, 'http://localhost:3000'));
}

// Builds an EnrichedIndexer with a controllable scoreBreakdown.
function makeIndexer(overrides: Partial<EnrichedIndexer> = {}): EnrichedIndexer {
  const breakdown = {
    reo: 80,
    selfStake: 70,
    queryVolume: 60,
    cutStability: 50,
    allocationEfficiency: 90,
    overDelegation: 75,
    transparency: 40,
    delegationTrend: 30,
    delegatorAPY: 65,
    dataServiceDiversity: 20,
    delegatorCut: 55,
  };
  return {
    id: '0xindexer',
    name: 'Test Indexer',
    stakedTokens: '0',
    lockedTokens: '0',
    delegatedTokens: '0',
    allocatedTokens: '0',
    allocationCount: 5,
    indexingRewardCut: 100_000,
    queryFeeCut: 100_000,
    delegatorParameterCooldown: 0,
    lastDelegationParameterUpdate: Math.floor(Date.now() / 1000) - 200 * 86400,
    rewardsEarned: '0',
    delegatorShares: '0',
    url: 'https://idx.example',
    geoHash: null,
    createdAt: 0,
    ensName: 'idx.eth',
    selfStakeGRT: 1_500_000,
    delegatedGRT: 0,
    delegatorAPR: 8.4,
    delegationCapacity: { maxCapacity: 100, usedCapacity: 50, availableCapacity: 50, utilizationPercent: 50 },
    reoStatus: 'eligible',
    reoSource: 'oracle',
    reoRenewalTimestamp: null,
    reoExpiresAt: null,
    reoDaysRemaining: 30,
    recentActivity: { delegationsIn7d: 1, undelegationsIn7d: 0, netFlowGRT: 1000 },
    effectiveCut: 10,
    overDelegationDilution: null,
    ownStakeRatio: null,
    indexerRewardsOwnGenerationRatio: null,
    provisionedGRT: null,
    queryFeesCollectedGRT: 5000,
    delegationExchangeRate: null,
    rollingAPY30d: 9.1,
    rollingAPY90d: null,
    distinctDataServices: 1,
    score: 80,
    scoreGrade: 'A',
    scoreBreakdown: breakdown as EnrichedIndexer['scoreBreakdown'],
    computedAt: 0,
    ...overrides,
  };
}

let GET: (req: NextRequest) => Promise<Response>;

describe('/api/delegate/recommend', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockCacheGet.mockResolvedValue(null);
    const mod = await import('@/app/api/delegate/recommend/route');
    GET = mod.GET as typeof GET;
  });

  it('returns 503 when enriched indexer cache is empty', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toMatch(/not yet available/i);
  });

  it('returns 503 when cache returns an empty array', async () => {
    mockCacheGet.mockResolvedValueOnce([]);
    const res = await GET(makeRequest());
    expect(res.status).toBe(503);
  });

  it('returns 404 when no indexer passes the hard eligibility filters', async () => {
    mockCacheGet.mockResolvedValueOnce([
      makeIndexer({ id: '0xa', reoStatus: 'ineligible' }), // fails REO
      makeIndexer({
        id: '0xb',
        delegationCapacity: { maxCapacity: 100, usedCapacity: 95, availableCapacity: 5, utilizationPercent: 95 },
      }), // fails capacity >= 90
      makeIndexer({ id: '0xc', indexingRewardCut: 950_000 }), // fails cut >= 900_000
    ]);
    const res = await GET(makeRequest());
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toMatch(/no eligible/i);
  });

  it('returns a single ranked recommendation by default (count=1)', async () => {
    const winner = makeIndexer({ id: '0xwinner', score: 99 });
    winner.scoreBreakdown = { ...winner.scoreBreakdown, reo: 100, allocationEfficiency: 100 };
    const loser = makeIndexer({ id: '0xloser' });
    loser.scoreBreakdown = { ...loser.scoreBreakdown, reo: 1, allocationEfficiency: 1, selfStake: 1 };
    (loser as EnrichedIndexer & { scoreBreakdown: Record<string, number> }).scoreBreakdown.delegatorCut = 1;

    mockCacheGet.mockResolvedValueOnce([loser, winner]);
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty('indexer');
    expect(json).toHaveProperty('score');
    expect(json).toHaveProperty('reasons');
    expect(json.indexer.id).toBe('0xwinner');
    expect(typeof json.score).toBe('number');
    expect(Array.isArray(json.reasons)).toBe(true);
    expect(json.reasons.length).toBeGreaterThan(0);
    expect(json.reasons.length).toBeLessThanOrEqual(3);
    expect(res.headers.get('Cache-Control')).toContain('s-maxage=60');
  });

  it('returns a candidates array when count > 1, sorted by score desc', async () => {
    const high = makeIndexer({ id: '0xhigh' });
    high.scoreBreakdown = { ...high.scoreBreakdown, reo: 100, allocationEfficiency: 100, selfStake: 100 };
    const mid = makeIndexer({ id: '0xmid' });
    mid.scoreBreakdown = { ...mid.scoreBreakdown, reo: 50, allocationEfficiency: 50, selfStake: 50 };
    const low = makeIndexer({ id: '0xlow' });
    low.scoreBreakdown = { ...low.scoreBreakdown, reo: 5, allocationEfficiency: 5, selfStake: 5 };

    mockCacheGet.mockResolvedValueOnce([mid, low, high]);
    const res = await GET(makeRequest('?count=3'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.candidates)).toBe(true);
    expect(json.candidates).toHaveLength(3);
    expect(json.candidates[0].indexer.id).toBe('0xhigh');
    expect(json.candidates[2].indexer.id).toBe('0xlow');
    expect(json.candidates[0].score).toBeGreaterThanOrEqual(json.candidates[1].score);
    expect(json.candidates[1].score).toBeGreaterThanOrEqual(json.candidates[2].score);
  });

  it('caps count at 10 and floors at 1', async () => {
    const list = Array.from({ length: 15 }, (_, i) => makeIndexer({ id: `0x${i}` }));
    mockCacheGet.mockResolvedValueOnce(list);
    const res = await GET(makeRequest('?count=999'));
    const json = await res.json();
    expect(json.candidates).toHaveLength(10);
  });

  it('reflects preference sliders in the ranking (returns-heavy promotes high-APY indexer)', async () => {
    // apyKing wins on APY/cut dims; allKing wins on network dims.
    const apyKing = makeIndexer({ id: '0xapy', delegatorAPR: 20, rollingAPY30d: 20 });
    apyKing.scoreBreakdown = {
      reo: 50, selfStake: 50, queryVolume: 10, cutStability: 50, allocationEfficiency: 10,
      overDelegation: 50, transparency: 50, delegationTrend: 50, delegatorAPY: 100,
      dataServiceDiversity: 10,
    } as EnrichedIndexer['scoreBreakdown'];
    (apyKing as unknown as { scoreBreakdown: Record<string, number> }).scoreBreakdown.delegatorCut = 100;

    const netKing = makeIndexer({ id: '0xnet' });
    netKing.scoreBreakdown = {
      reo: 100, selfStake: 50, queryVolume: 100, cutStability: 50, allocationEfficiency: 100,
      overDelegation: 50, transparency: 50, delegationTrend: 50, delegatorAPY: 10,
      dataServiceDiversity: 10,
    } as EnrichedIndexer['scoreBreakdown'];
    (netKing as unknown as { scoreBreakdown: Record<string, number> }).scoreBreakdown.delegatorCut = 10;

    mockCacheGet.mockResolvedValue([apyKing, netKing]);

    const returnsRes = await GET(makeRequest('?returns=10&network=0'));
    const returnsJson = await returnsRes.json();
    expect(returnsJson.indexer.id).toBe('0xapy');

    const networkRes = await GET(makeRequest('?returns=0&network=10'));
    const networkJson = await networkRes.json();
    expect(networkJson.indexer.id).toBe('0xnet');
  });

  it('produces human-readable reasons mapped from top dimensions', async () => {
    const ix = makeIndexer({ id: '0xreason', reoStatus: 'eligible' });
    // Make reo + selfStake + delegatorAPY the dominant dims.
    ix.scoreBreakdown = {
      reo: 100, selfStake: 100, queryVolume: 0, cutStability: 0, allocationEfficiency: 0,
      overDelegation: 0, transparency: 0, delegationTrend: 0, delegatorAPY: 100,
      dataServiceDiversity: 0,
    } as EnrichedIndexer['scoreBreakdown'];
    mockCacheGet.mockResolvedValueOnce([ix]);
    const res = await GET(makeRequest());
    const json = await res.json();
    const joined = json.reasons.join(' | ');
    // Should include the APR reason and self-stake reason (M/K formatting) and REO.
    expect(joined).toMatch(/APR/);
    expect(joined).toMatch(/self-staked/);
  });
});
