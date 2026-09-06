/**
 * The enrichment half of `refreshIndexers`, driven by nest-shaped inputs (nuthatch#1160). The
 * gateway gatherer left with the key and took the twenty-seven cases that exercised these branches
 * through it; the branches are production logic and are pinned here against `gatherFromNest`
 * instead: what is written where, the oracle's three answers, the locked-stake subtraction, the
 * delegation-activity fold, ENS, and the two APY paths with their fallbacks.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockNuthatchSql = vi.fn();
vi.mock('../nuthatch', () => ({ nuthatchSql: (...a: unknown[]) => mockNuthatchSql(...a) }));
const resolveEnsNames = vi.fn<(addrs: string[]) => Promise<Record<string, string>>>(async () => ({}));
vi.mock('../ens', () => ({ resolveEnsNames: (addrs: string[]) => resolveEnsNames(addrs) }));
const mockCacheSet = vi.fn(async () => undefined);
vi.mock('../cache', () => ({ cacheSet: (...a: unknown[]) => mockCacheSet(...(a as [])) }));
const mockBatchCheckEligibility = vi.fn();
vi.mock('../reo-contract', () => ({ batchCheckEligibility: (...a: unknown[]) => mockBatchCheckEligibility(...a) }));
const mockWriteIndexers = vi.fn();
vi.mock('../ingest/indexers', () => ({ writeIndexers: (...a: unknown[]) => mockWriteIndexers(...a) }));
const mockCalculateDelegatorAPR = vi.fn();
const mockCalculateDelegationCapacity = vi.fn();
const mockCalculateRollingAPY = vi.fn();
const mockCalculatePoolExchangeRate = vi.fn();
const mockCalculateExchangeRateAPY = vi.fn();
vi.mock('../rewards', () => ({
  calculateDelegatorAPR: (...a: unknown[]) => mockCalculateDelegatorAPR(...a),
  calculateDelegationCapacity: (...a: unknown[]) => mockCalculateDelegationCapacity(...a),
  calculateRollingAPY: (...a: unknown[]) => mockCalculateRollingAPY(...a),
  calculatePoolExchangeRate: (...a: unknown[]) => mockCalculatePoolExchangeRate(...a),
  calculateExchangeRateAPY: (...a: unknown[]) => mockCalculateExchangeRateAPY(...a),
}));
const mockCalculateIndexerScore = vi.fn();
vi.mock('../risk-score', () => ({ calculateIndexerScore: (...a: unknown[]) => mockCalculateIndexerScore(...a) }));
vi.mock('../logger', () => ({ log: { refresh: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } } }));

import { refreshIndexers, gatherFromNest } from '../refresh';

const IX = '0x6f9bb7e454f5b3eb2310343f0e99269dc2bb8a1d';
const GRT = (n: number) => (BigInt(n) * 10n ** 18n).toString();
const indexerRow = (over: Record<string, unknown> = {}) => ({
  id: IX, staked_tokens: GRT(1000), locked_tokens: '0', locked_until: null, delegated_tokens: GRT(500), delegated_thawing_tokens: GRT(10),
  allocated_tokens: GRT(1200), allocation_count: 3, indexing_reward_cut: 300000, query_fee_cut: 300000, last_delegation_parameter_update: 1700000000,
  rewards_earned: GRT(50), query_fees_collected: GRT(2), delegator_shares: GRT(400), provisioned_tokens: GRT(1000), url: 'https://x/', geohash: 'u14', created_at: 1600000000,
  ...over,
});

interface Nest {
  network?: Record<string, unknown> | null;
  params?: Record<string, unknown> | null;
  indexers?: Record<string, unknown>[];
  events?: Record<string, unknown>[];
  closed?: Record<string, unknown>[];
  ledger30?: Record<string, unknown>[];
  ledger90?: Record<string, unknown>[];
}
/** Answer each of `gatherFromNest`'s nine queries from a small description of the nest. */
function nest(n: Nest = {}) {
  const network = n.network === undefined
    ? { total_tokens_signalled: GRT(20_000_000), issuance_per_block: '120730000000000000000', current_epoch: 1372 }
    : n.network;
  const params = n.params === undefined ? { delegation_ratio: 16 } : n.params;
  const t30 = String(Math.floor(Date.now() / 1000) - 30 * 86400).slice(0, 6);
  mockNuthatchSql.mockImplementation((sql: string) => {
    if (sql.includes('FROM lodestar_network_params')) return Promise.resolve(params ? [params] : []);
    if (sql.includes('FROM lodestar_network')) return Promise.resolve(network ? [network] : []);
    if (sql.includes('FROM lodestar_indexers')) return Promise.resolve(n.indexers ?? [indexerRow()]);
    if (sql.includes("a.status = 'Active'")) return Promise.resolve([]);
    if (sql.includes('FROM lodestar_delegations')) return Promise.resolve(n.events ?? []);
    if (sql.includes("status = 'Closed'")) return Promise.resolve(n.closed ?? []);
    if (sql.includes('FROM lodestar_indexer_ledger')) return Promise.resolve(sql.includes(t30) ? (n.ledger30 ?? []) : (n.ledger90 ?? []));
    if (sql.includes('FROM lodestar_provisions')) return Promise.resolve([]);
    return Promise.resolve([]);
  });
}
const scoreInput = () => mockCalculateIndexerScore.mock.calls[0][0] as Record<string, unknown>;

describe('refreshIndexers enrichment on nest inputs', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resolveEnsNames.mockResolvedValue({});
    mockBatchCheckEligibility.mockResolvedValue(new Map());
    mockCalculateDelegatorAPR.mockReturnValue(5);
    mockCalculateDelegationCapacity.mockReturnValue({ utilizationPercent: 50, remainingCapacity: 100, maxCapacity: 200 });
    mockCalculatePoolExchangeRate.mockReturnValue(1.05);
    mockCalculateExchangeRateAPY.mockReturnValue(2.5);
    mockCalculateRollingAPY.mockReturnValue(3);
    mockCalculateIndexerScore.mockReturnValue({ composite: 75, grade: 'B', breakdown: {} });
    mockWriteIndexers.mockResolvedValue({ upserted: 1, snapshots: 1, paramChanges: 0 });
  });

  it('returns the count and a duration on the happy path', async () => {
    nest();
    const r = await refreshIndexers({ writeToRedis: false });
    expect(r.count).toBe(1);
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('writes Redis by default and not when asked not to', async () => {
    nest();
    await refreshIndexers({ writeToRedis: false });
    expect(mockCacheSet).not.toHaveBeenCalled();
    await refreshIndexers({});
    expect(mockCacheSet).toHaveBeenCalledWith('lodestar:indexers-enriched', expect.any(Array), 600);
  });

  it('writes Postgres only when given a client, with the current epoch, and survives that write failing', async () => {
    nest();
    await refreshIndexers({ writeToRedis: false });
    expect(mockWriteIndexers).not.toHaveBeenCalled();
    const sql = vi.fn();
    await refreshIndexers({ sql: sql as never, writeToRedis: false });
    expect(mockWriteIndexers).toHaveBeenCalledWith(sql, expect.any(Array), 1372);
    mockWriteIndexers.mockRejectedValueOnce(new Error('db error'));
    await expect(refreshIndexers({ sql: sql as never, writeToRedis: false })).resolves.toMatchObject({ count: 1 });
  });

  it('a nest with no issuance figure enriches with zero issuance, and no indexers is a count of zero', async () => {
    nest({ network: { total_tokens_signalled: GRT(1), issuance_per_block: null, current_epoch: 1 }, indexers: [] });
    const inputs = await gatherFromNest();
    expect(inputs.network.networkGRTIssuancePerBlock).toBeUndefined();
    const r = await refreshIndexers({ writeToRedis: false });
    expect(r.count).toBe(0);
  });

  it('a nest with no delegation ratio falls back to sixteen', async () => {
    nest({ params: { delegation_ratio: null } });
    const inputs = await gatherFromNest();
    expect(inputs.network.delegationRatio).toBe(16);
  });

  it('the oracle decides eligibility: eligible, ineligible, and unknown when it has no entry or the batch throws', async () => {
    nest();
    mockBatchCheckEligibility.mockResolvedValueOnce(new Map([[IX, { isEligible: true, renewalTimestamp: 1, expiresAt: 2, daysRemaining: 30 }]]));
    await refreshIndexers({ writeToRedis: false });
    expect(scoreInput().reoStatus).toBe('eligible');
    expect(scoreInput().reoDaysRemaining).toBe(30);

    vi.clearAllMocks(); nest();
    mockBatchCheckEligibility.mockResolvedValueOnce(new Map([[IX, { isEligible: false, renewalTimestamp: null, expiresAt: null, daysRemaining: null }]]));
    await refreshIndexers({ writeToRedis: false });
    expect(scoreInput().reoStatus).toBe('ineligible');

    vi.clearAllMocks(); nest();
    mockBatchCheckEligibility.mockResolvedValueOnce(new Map());
    await refreshIndexers({ writeToRedis: false });
    expect(scoreInput().reoStatus).toBe('unknown');

    vi.clearAllMocks(); nest();
    mockBatchCheckEligibility.mockRejectedValueOnce(new Error('contract error'));
    const r = await refreshIndexers({ writeToRedis: false });
    expect(r.count).toBe(1);
    expect(scoreInput().reoStatus).toBe('unknown');
  });

  it('subtracts locked tokens from self-stake (lodestar#54)', async () => {
    nest({ indexers: [indexerRow({ staked_tokens: GRT(200_000), locked_tokens: GRT(10_000) })] });
    await refreshIndexers({ writeToRedis: false });
    expect(scoreInput().selfStakeGRT).toBeCloseTo(190_000, 6);
  });

  it('folds delegation events into activity by type and ignores a type it does not know', async () => {
    nest({ events: [
      { event_type: 'delegation', indexer: IX.toUpperCase(), tokens: GRT(1000) },
      { event_type: 'undelegation', indexer: IX, tokens: GRT(400) },
      { event_type: 'withdrawal', indexer: IX, tokens: GRT(100) },
    ] });
    const inputs = await gatherFromNest();
    expect(inputs.delegationActivity[IX]).toEqual({ delegations: 1, undelegations: 1, netFlowGRT: 600 });
  });

  it('an ENS name becomes the display name and the score input; a failed lookup costs only the names', async () => {
    nest();
    resolveEnsNames.mockResolvedValueOnce({ [IX]: 'myindexer.eth' });
    await refreshIndexers({ writeToRedis: false });
    expect(scoreInput().ensName).toBe('myindexer.eth');
    expect(scoreInput().name).toBe('myindexer.eth');

    vi.clearAllMocks(); nest();
    resolveEnsNames.mockRejectedValueOnce(new Error('ens down'));
    const r = await refreshIndexers({ writeToRedis: false });
    expect(r.count).toBe(1);
    expect(scoreInput().ensName).toBeNull();
  });

  it('closed allocations with delegator rewards feed the rolling APY when the exchange-rate APY is absent; zero rewards and open ones do not', async () => {
    const now = Math.floor(Date.now() / 1000);
    nest({ closed: [
      { indexer: IX, indexing_delegator_rewards: GRT(10), closed_at: now - 86400 },
      { indexer: IX, indexing_delegator_rewards: '0', closed_at: now - 86400 },
      { indexer: IX, indexing_delegator_rewards: GRT(5), closed_at: null },
    ] });
    const inputs = await gatherFromNest();
    expect(inputs.closedAllocsByIndexer.get(IX)).toHaveLength(1);
    mockCalculateExchangeRateAPY.mockReturnValue(null);
    await refreshIndexers({ writeToRedis: false });
    // No ledger history, so the exchange-rate APY is null and the closed allocations decide it.
    expect(mockCalculateRollingAPY).toHaveBeenCalledWith(expect.any(Array), expect.any(Number), 30);
    expect(mockCalculateRollingAPY).toHaveBeenCalledWith(expect.any(Array), expect.any(Number), 90);
  });

  it('ledger rows become the 30- and 90-day exchange-rate history, and a 90-day row alone still lands', async () => {
    nest({
      ledger30: [{ indexer: IX, pool_tokens: GRT(500), pool_shares: GRT(400) }],
      ledger90: [{ indexer: IX, pool_tokens: GRT(440), pool_shares: GRT(400) }],
    });
    mockCalculatePoolExchangeRate.mockImplementation((tokens: string) => Number(BigInt(tokens) / 10n ** 18n) / 400);
    let inputs = await gatherFromNest();
    expect(inputs.exchangeRateHistory.get(IX)).toEqual({ rate30d: 1.25, rate90d: 1.1 });
    await refreshIndexers({ writeToRedis: false });
    expect(mockCalculateExchangeRateAPY).toHaveBeenCalledWith(expect.any(Number), 1.25, 30);
    expect(mockCalculateExchangeRateAPY).toHaveBeenCalledWith(expect.any(Number), 1.1, 90);

    vi.clearAllMocks();
    nest({ ledger90: [{ indexer: IX, pool_tokens: GRT(440), pool_shares: GRT(400) }] });
    mockCalculatePoolExchangeRate.mockImplementation((tokens: string) => Number(BigInt(tokens) / 10n ** 18n) / 400);
    inputs = await gatherFromNest();
    expect(inputs.exchangeRateHistory.get(IX)).toEqual({ rate30d: null, rate90d: 1.1 });
  });
});
