import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockHasSubgraphAccess = vi.fn();
const mockSubgraphQuery = vi.fn();
const mockDelegationEventsQuery = vi.fn();
const mockEnsQuery = vi.fn();
const mockCacheSet = vi.fn();
const mockBatchCheckEligibility = vi.fn();
const mockWriteIndexers = vi.fn();
const mockCalculateDelegatorAPR = vi.fn();
const mockCalculateDelegationCapacity = vi.fn();
const mockCalculateRollingAPY = vi.fn();
const mockCalculatePoolExchangeRate = vi.fn();
const mockCalculateExchangeRateAPY = vi.fn();
const mockCalculateIndexerScore = vi.fn();

vi.mock('../subgraph', () => ({
  hasSubgraphAccess: () => mockHasSubgraphAccess(),
  subgraphQuery: (...args: unknown[]) => mockSubgraphQuery(...args),
  delegationEventsQuery: (...args: unknown[]) => mockDelegationEventsQuery(...args),
  ensQuery: (...args: unknown[]) => mockEnsQuery(...args),
}));

vi.mock('../cache', () => ({
  cacheSet: (...args: unknown[]) => mockCacheSet(...args),
}));

vi.mock('../reo-contract', () => ({
  batchCheckEligibility: (...args: unknown[]) => mockBatchCheckEligibility(...args),
}));

vi.mock('../rewards', () => ({
  calculateDelegatorAPR: (...args: unknown[]) => mockCalculateDelegatorAPR(...args),
  calculateDelegationCapacity: (...args: unknown[]) => mockCalculateDelegationCapacity(...args),
  calculateRollingAPY: (...args: unknown[]) => mockCalculateRollingAPY(...args),
  calculatePoolExchangeRate: (...args: unknown[]) => mockCalculatePoolExchangeRate(...args),
  calculateExchangeRateAPY: (...args: unknown[]) => mockCalculateExchangeRateAPY(...args),
}));

vi.mock('../risk-score', () => ({
  calculateIndexerScore: (...args: unknown[]) => mockCalculateIndexerScore(...args),
}));

vi.mock('../ingest/indexers', () => ({
  writeIndexers: (...args: unknown[]) => mockWriteIndexers(...args),
}));

vi.mock('../logger', () => ({
  log: {
    refresh: { info: vi.fn(), warn: vi.fn() },
    cron: { info: vi.fn(), warn: vi.fn() },
  },
  default: { info: vi.fn() },
}));

import { refreshIndexers } from '../refresh';

// ─── Helpers ────────────────────────────────────────────────────────────────

const GRT = (n: number) => BigInt(Math.round(n * 1e18)).toString();

const makeIndexer = (id = '0xabc', overrides: Record<string, unknown> = {}) => ({
  id,
  account: { id, defaultDisplayName: null, metadata: null },
  stakedTokens: GRT(200_000),
  delegatedTokens: GRT(500_000),
  allocatedTokens: GRT(100_000),
  allocationCount: 3,
  indexingRewardCut: 100_000,
  queryFeeCut: 100_000,
  delegatorParameterCooldown: 28,
  lastDelegationParameterUpdate: 1_700_000_000,
  rewardsEarned: GRT(1_000),
  queryFeesCollected: GRT(100),
  delegatorShares: GRT(500_000),
  url: 'https://example.com',
  geoHash: 'u33d',
  createdAt: 1_700_000_000,
  ...overrides,
});

const networkResult = {
  graphNetwork: {
    totalTokensSignalled: GRT(10_000_000),
    networkGRTIssuancePerBlock: GRT(0.114),
    delegationRatio: 16,
    currentEpoch: 100,
  },
};

/** Sets up the standard subgraphQuery mock sequence for a happy-path run with one indexer. */
function setupHappyPath(indexer = makeIndexer()) {
  mockSubgraphQuery
    .mockResolvedValueOnce(networkResult)                            // 1. network stats
    .mockResolvedValueOnce({ indexers: [indexer] })                  // 2. indexers page 1 (<1000 → stop)
    .mockResolvedValueOnce({ allocations: [] })                      // 3. allocations batch
    .mockResolvedValueOnce({ allocations: [] });                     // 4. closed allocs (empty → break)
  mockDelegationEventsQuery.mockResolvedValueOnce({ delegationEvents: [] });
  mockEnsQuery.mockResolvedValueOnce({ domains: [] });
  mockBatchCheckEligibility.mockResolvedValueOnce(new Map());
  mockCalculateDelegatorAPR.mockReturnValue(5.0);
  mockCalculateDelegationCapacity.mockReturnValue({
    utilizationPercent: 50,
    remainingCapacity: 100_000,
    maxCapacity: 200_000,
  });
  mockCalculatePoolExchangeRate.mockReturnValue(1.05);
  mockCalculateExchangeRateAPY.mockReturnValue(2.5);
  mockCalculateRollingAPY.mockReturnValue(3.0);
  mockCalculateIndexerScore.mockReturnValue({ composite: 75, grade: 'B', breakdown: {} });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('refreshIndexers', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockHasSubgraphAccess.mockReturnValue(true);
    mockWriteIndexers.mockResolvedValue({ upserted: 1, snapshots: 1, paramChanges: 0 });
    mockCacheSet.mockResolvedValue(undefined);
  });

  it('throws when no subgraph access configured', async () => {
    mockHasSubgraphAccess.mockReturnValue(false);
    await expect(refreshIndexers({ writeToRedis: false })).rejects.toThrow('No GRAPH_API_KEY configured');
  });

  it('returns count and durationMs for happy path', async () => {
    setupHappyPath();
    const result = await refreshIndexers({ writeToRedis: false });
    expect(result.count).toBe(1);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('skips redis write when writeToRedis is false', async () => {
    setupHappyPath();
    await refreshIndexers({ writeToRedis: false });
    expect(mockCacheSet).not.toHaveBeenCalled();
  });

  it('writes to redis when writeToRedis is true (default)', async () => {
    setupHappyPath();
    await refreshIndexers({});
    expect(mockCacheSet).toHaveBeenCalledWith('lodestar:indexers-enriched', expect.any(Array), 600);
  });

  it('skips postgres write when sql is not provided', async () => {
    setupHappyPath();
    await refreshIndexers({ writeToRedis: false });
    expect(mockWriteIndexers).not.toHaveBeenCalled();
  });

  it('calls writeIndexers when sql is provided', async () => {
    setupHappyPath();
    const sql = vi.fn().mockResolvedValue([]);
    // sql is called as tagged template literal for exchange rate queries
    await refreshIndexers({ sql: sql as never, writeToRedis: false });
    expect(mockWriteIndexers).toHaveBeenCalledWith(sql, expect.any(Array), 100);
  });

  it('swallows writeIndexers failure (non-fatal)', async () => {
    setupHappyPath();
    mockWriteIndexers.mockRejectedValueOnce(new Error('db error'));
    const sql = vi.fn().mockResolvedValue([]);
    await expect(refreshIndexers({ sql: sql as never, writeToRedis: false })).resolves.toBeDefined();
  });

  it('handles missing networkGRTIssuancePerBlock (uses 0 issuance)', async () => {
    const noIssuanceNetwork = {
      graphNetwork: {
        totalTokensSignalled: GRT(10_000_000),
        networkGRTIssuancePerBlock: undefined,
        delegationRatio: 16,
        currentEpoch: 100,
      },
    };
    mockSubgraphQuery
      .mockResolvedValueOnce(noIssuanceNetwork)
      .mockResolvedValueOnce({ indexers: [] })
      .mockResolvedValueOnce({ allocations: [] });
    mockDelegationEventsQuery.mockResolvedValueOnce({ delegationEvents: [] });
    mockEnsQuery.mockResolvedValueOnce({ domains: [] });
    mockBatchCheckEligibility.mockResolvedValueOnce(new Map());

    const result = await refreshIndexers({ writeToRedis: false });
    expect(result.count).toBe(0);
  });

  it('gracefully handles delegation events query failure', async () => {
    setupHappyPath();
    mockDelegationEventsQuery.mockRejectedValueOnce(new Error('timeout'));
    const result = await refreshIndexers({ writeToRedis: false });
    expect(result.count).toBe(1); // still completes
  });

  it('gracefully handles ENS query failure', async () => {
    setupHappyPath();
    mockEnsQuery.mockRejectedValueOnce(new Error('ens down'));
    const result = await refreshIndexers({ writeToRedis: false });
    expect(result.count).toBe(1);
  });

  it('falls back to heuristic when REO oracle throws', async () => {
    setupHappyPath();
    mockBatchCheckEligibility.mockRejectedValueOnce(new Error('contract error'));
    const result = await refreshIndexers({ writeToRedis: false });
    expect(result.count).toBe(1);
  });

  it('uses oracle data when oracle returns result for indexer (eligible)', async () => {
    const oracleMap = new Map([['0xabc', { isEligible: true, renewalTimestamp: 1700000000, expiresAt: 1800000000, daysRemaining: 30 }]]);
    setupHappyPath();
    mockBatchCheckEligibility.mockResolvedValueOnce(oracleMap);
    const result = await refreshIndexers({ writeToRedis: false });
    expect(result.count).toBe(1);
  });

  it('uses oracle data when oracle returns result for indexer (ineligible)', async () => {
    const oracleMap = new Map([['0xabc', { isEligible: false, renewalTimestamp: null, expiresAt: null, daysRemaining: null }]]);
    setupHappyPath();
    mockBatchCheckEligibility.mockResolvedValueOnce(oracleMap);
    const result = await refreshIndexers({ writeToRedis: false });
    expect(result.count).toBe(1);
  });

  it('heuristic: eligible when has allocations and sufficient stake', async () => {
    const indexer = makeIndexer('0xabc', { allocationCount: 3, stakedTokens: GRT(200_000) });
    setupHappyPath(indexer);
    mockBatchCheckEligibility.mockResolvedValueOnce(new Map()); // no oracle data
    const result = await refreshIndexers({ writeToRedis: false });
    expect(result.count).toBe(1);
  });

  it('heuristic: ineligible when no allocations', async () => {
    const indexer = makeIndexer('0xabc', { allocationCount: 0 });
    setupHappyPath(indexer);
    mockBatchCheckEligibility.mockResolvedValueOnce(new Map());
    const result = await refreshIndexers({ writeToRedis: false });
    expect(result.count).toBe(1);
  });

  it('heuristic: ineligible when stake below minimum', async () => {
    const indexer = makeIndexer('0xabc', { stakedTokens: GRT(50_000), allocationCount: 3 });
    setupHappyPath(indexer);
    mockBatchCheckEligibility.mockResolvedValueOnce(new Map());
    const result = await refreshIndexers({ writeToRedis: false });
    expect(result.count).toBe(1);
  });

  it('maps optional indexer fields when present', async () => {
    const indexer = makeIndexer('0xabc', {
      lockedTokens: GRT(10_000),
      delegatedThawingTokens: GRT(5_000),
      ownStakeRatio: '0.5',
      provisionedTokens: GRT(50_000),
      indexingRewardEffectiveCut: '0.15',
      overDelegationDilution: '0.02',
      indexerRewardsOwnGenerationRatio: '0.8',
    });
    setupHappyPath(indexer);
    const result = await refreshIndexers({ writeToRedis: false });
    expect(result.count).toBe(1);
  });

  it('handles delegation events: delegation and undelegation types', async () => {
    setupHappyPath();
    mockDelegationEventsQuery.mockResolvedValueOnce({
      delegationEvents: [
        { eventType: 'delegation', indexer: '0xABC', delegator: '0xDel1', tokens: GRT(1000).toString(), timestamp: '1700001000' },
        { eventType: 'undelegation', indexer: '0xABC', delegator: '0xDel2', tokens: GRT(500).toString(), timestamp: '1700000500' },
        { eventType: 'other', indexer: '0xABC', delegator: '0xDel3', tokens: GRT(100).toString(), timestamp: '1700000200' },
      ],
    });
    const result = await refreshIndexers({ writeToRedis: false });
    expect(result.count).toBe(1);
  });

  it('resolves ENS name when domain matches indexer address', async () => {
    setupHappyPath();
    mockEnsQuery.mockResolvedValueOnce({
      domains: [{ name: 'myindexer.eth', resolvedAddress: { id: '0xabc' } }],
    });
    const result = await refreshIndexers({ writeToRedis: false });
    expect(result.count).toBe(1);
  });

  it('picks shorter ENS name when multiple domains resolve to same address', async () => {
    setupHappyPath();
    mockEnsQuery.mockResolvedValueOnce({
      domains: [
        { name: 'longname.myindexer.eth', resolvedAddress: { id: '0xabc' } },
        { name: 'short.eth', resolvedAddress: { id: '0xabc' } },
      ],
    });
    const result = await refreshIndexers({ writeToRedis: false });
    expect(result.count).toBe(1);
  });

  it('paginates indexers when page returns exactly 1000', async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => makeIndexer(`0x${i.toString().padStart(40, '0')}`));
    const page2 = [makeIndexer('0xfinal')];
    mockSubgraphQuery
      .mockResolvedValueOnce(networkResult)
      .mockResolvedValueOnce({ indexers: page1 })
      .mockResolvedValueOnce({ indexers: page2 })
      .mockResolvedValueOnce({ allocations: [] }) // alloc batch for some indexers (simplified)
      .mockResolvedValue({ allocations: [] });    // all remaining alloc and closed-alloc calls
    mockDelegationEventsQuery.mockResolvedValueOnce({ delegationEvents: [] });
    mockEnsQuery.mockResolvedValue({ domains: [] });
    mockBatchCheckEligibility.mockResolvedValue(new Map());
    mockCalculateDelegatorAPR.mockReturnValue(0);
    mockCalculateDelegationCapacity.mockReturnValue({ utilizationPercent: 0, remainingCapacity: 0, maxCapacity: 0 });
    mockCalculatePoolExchangeRate.mockReturnValue(1);
    mockCalculateExchangeRateAPY.mockReturnValue(0);
    mockCalculateRollingAPY.mockReturnValue(0);
    mockCalculateIndexerScore.mockReturnValue({ composite: 50, grade: 'C', breakdown: {} });

    const result = await refreshIndexers({ writeToRedis: false });
    expect(result.count).toBe(1001);
  });

  it('loads closed allocations and uses rolling APY fallback when erAPY is null', async () => {
    const closedAlloc = {
      id: '0xalloc1',
      indexer: { id: '0xabc' },
      indexingDelegatorRewards: GRT(10),
      closedAt: Math.floor(Date.now() / 1000) - 86400,
    };
    mockSubgraphQuery
      .mockResolvedValueOnce(networkResult)
      .mockResolvedValueOnce({ indexers: [makeIndexer()] })
      .mockResolvedValueOnce({ allocations: [] })                                    // active allocs batch
      .mockResolvedValueOnce({ allocations: [closedAlloc] })                         // closed allocs page 1
      .mockResolvedValueOnce({ allocations: [] });                                   // closed allocs page 2 (end)
    mockDelegationEventsQuery.mockResolvedValueOnce({ delegationEvents: [] });
    mockEnsQuery.mockResolvedValueOnce({ domains: [] });
    mockBatchCheckEligibility.mockResolvedValue(new Map());
    mockCalculateDelegatorAPR.mockReturnValue(5);
    mockCalculateDelegationCapacity.mockReturnValue({ utilizationPercent: 50, remainingCapacity: 0, maxCapacity: 0 });
    mockCalculatePoolExchangeRate.mockReturnValue(1.05);
    mockCalculateExchangeRateAPY.mockReturnValue(null as never); // no history → erAPY is null
    mockCalculateRollingAPY.mockReturnValue(4.0);
    mockCalculateIndexerScore.mockReturnValue({ composite: 75, grade: 'B', breakdown: {} });

    const result = await refreshIndexers({ writeToRedis: false });
    expect(result.count).toBe(1);
  });

  it('skips closed allocation with zero delegator rewards', async () => {
    const zeroRewardAlloc = {
      id: '0xalloc-zero',
      indexer: { id: '0xabc' },
      indexingDelegatorRewards: '0',
      closedAt: Math.floor(Date.now() / 1000) - 86400,
    };
    mockSubgraphQuery
      .mockResolvedValueOnce(networkResult)
      .mockResolvedValueOnce({ indexers: [makeIndexer()] })
      .mockResolvedValueOnce({ allocations: [] })
      .mockResolvedValueOnce({ allocations: [zeroRewardAlloc] })
      .mockResolvedValueOnce({ allocations: [] });
    mockDelegationEventsQuery.mockResolvedValueOnce({ delegationEvents: [] });
    mockEnsQuery.mockResolvedValueOnce({ domains: [] });
    mockBatchCheckEligibility.mockResolvedValue(new Map());
    mockCalculateDelegatorAPR.mockReturnValue(0);
    mockCalculateDelegationCapacity.mockReturnValue({ utilizationPercent: 0, remainingCapacity: 0, maxCapacity: 0 });
    mockCalculatePoolExchangeRate.mockReturnValue(1);
    mockCalculateRollingAPY.mockReturnValue(0);
    mockCalculateIndexerScore.mockReturnValue({ composite: 50, grade: 'C', breakdown: {} });

    const result = await refreshIndexers({ writeToRedis: false });
    expect(result.count).toBe(1);
  });

  it('gracefully handles rolling APY subgraph query failure', async () => {
    mockSubgraphQuery
      .mockResolvedValueOnce(networkResult)
      .mockResolvedValueOnce({ indexers: [makeIndexer()] })
      .mockResolvedValueOnce({ allocations: [] })
      .mockRejectedValueOnce(new Error('subgraph down')); // closed allocs fails
    mockDelegationEventsQuery.mockResolvedValueOnce({ delegationEvents: [] });
    mockEnsQuery.mockResolvedValueOnce({ domains: [] });
    mockBatchCheckEligibility.mockResolvedValue(new Map());
    mockCalculateDelegatorAPR.mockReturnValue(0);
    mockCalculateDelegationCapacity.mockReturnValue({ utilizationPercent: 0, remainingCapacity: 0, maxCapacity: 0 });
    mockCalculatePoolExchangeRate.mockReturnValue(1);
    mockCalculateRollingAPY.mockReturnValue(0);
    mockCalculateIndexerScore.mockReturnValue({ composite: 50, grade: 'C', breakdown: {} });

    const result = await refreshIndexers({ writeToRedis: false });
    expect(result.count).toBe(1);
  });

  it('loads exchange rate history when sql is provided', async () => {
    setupHappyPath();
    const sql = vi.fn()
      .mockResolvedValueOnce([{ indexer_address: '0xabc', delegation_exchange_rate: '1.05' }]) // rates30d
      .mockResolvedValueOnce([{ indexer_address: '0xabc', delegation_exchange_rate: '1.02' }]); // rates90d
    mockWriteIndexers.mockResolvedValue({ upserted: 1, snapshots: 1, paramChanges: 0 });
    mockCalculateExchangeRateAPY.mockReturnValue(2.5);

    const result = await refreshIndexers({ sql: sql as never, writeToRedis: false });
    expect(result.count).toBe(1);
  });

  it('gracefully handles exchange rate query failure when sql provided', async () => {
    setupHappyPath();
    const sql = vi.fn().mockRejectedValue(new Error('db timeout'));
    mockWriteIndexers.mockResolvedValue({ upserted: 1, snapshots: 1, paramChanges: 0 });

    const result = await refreshIndexers({ sql: sql as never, writeToRedis: false });
    expect(result.count).toBe(1);
  });

  it('handles rate90d for an address with no rate30d in exchangeRateHistory', async () => {
    setupHappyPath();
    const sql = vi.fn()
      .mockResolvedValueOnce([])  // rates30d: empty
      .mockResolvedValueOnce([{ indexer_address: '0xabc', delegation_exchange_rate: '1.02' }]); // rates90d only
    mockWriteIndexers.mockResolvedValue({ upserted: 1, snapshots: 0, paramChanges: 0 });

    const result = await refreshIndexers({ sql: sql as never, writeToRedis: false });
    expect(result.count).toBe(1);
  });

  it('returns count 0 when no indexers returned', async () => {
    mockSubgraphQuery
      .mockResolvedValueOnce(networkResult)
      .mockResolvedValueOnce({ indexers: [] })
      .mockResolvedValueOnce({ allocations: [] });
    mockDelegationEventsQuery.mockResolvedValueOnce({ delegationEvents: [] });
    mockEnsQuery.mockResolvedValueOnce({ domains: [] });
    mockBatchCheckEligibility.mockResolvedValue(new Map());

    const result = await refreshIndexers({ writeToRedis: false });
    expect(result.count).toBe(0);
  });
});
