/**
 * `refreshIndexers` gathering from the nest behind NUTHATCH_REFRESH (nightswatchhq/nuthatch#1160).
 * Pinned here: the flag off runs the gateway gatherer and never asks the nest; the flag on asks the
 * nest nine questions and no subgraph at all; each of the eight inputs is shaped as the enrichment
 * expects, in particular the exchange-rate history from the ledger, the delegation activity from the
 * events, and the derived ratios computed from the subgraph's formulas; and the enrichment then runs
 * to completion on those inputs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockSubgraphQuery = vi.fn();
const mockEnsQuery = vi.fn();
const mockDelegationEventsQuery = vi.fn();
const hasSubgraphAccess = vi.fn(() => true);
vi.mock('../subgraph', () => ({
  subgraphQuery: (...a: unknown[]) => mockSubgraphQuery(...a),
  ensQuery: (...a: unknown[]) => mockEnsQuery(...a),
  delegationEventsQuery: (...a: unknown[]) => mockDelegationEventsQuery(...a),
  hasSubgraphAccess: () => hasSubgraphAccess(),
}));
const mockNuthatchSql = vi.fn();
let nuthatchConfigured = true;
vi.mock('../nuthatch', () => ({
  hasNuthatch: () => nuthatchConfigured,
  nuthatchEnabled: (flag: string) => nuthatchConfigured && process.env[flag] === 'true',
  nuthatchSql: (...a: unknown[]) => mockNuthatchSql(...a),
}));
const resolveEnsNames = vi.fn<(addrs: string[]) => Promise<Record<string, string>>>(async () => ({}));
vi.mock('../ens', () => ({ resolveEnsNames: (addrs: string[]) => resolveEnsNames(addrs) }));
vi.mock('../cache', () => ({ cacheSet: vi.fn(async () => undefined), cached: vi.fn((_k: string, _t: number, f: () => Promise<unknown>) => f()) }));
vi.mock('../reo-contract', () => ({ batchCheckEligibility: vi.fn(async () => new Map()) }));
vi.mock('../ingest/indexers', () => ({ writeIndexers: vi.fn(async () => ({ upserted: 0, snapshots: 0, paramChanges: 0 })) }));
vi.mock('../logger', () => ({ log: { refresh: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } } }));

import { refreshIndexers, gatherFromNest } from '../refresh';

const IX = '0x6f9bb7e454f5b3eb2310343f0e99269dc2bb8a1d';
const GRT = (n: number) => (BigInt(n) * 10n ** 18n).toString();
const indexerRow = {
  id: IX, staked_tokens: GRT(1000), locked_tokens: '0', locked_until: null, delegated_tokens: GRT(500), delegated_thawing_tokens: GRT(10),
  allocated_tokens: GRT(1200), allocation_count: 3, indexing_reward_cut: 300000, query_fee_cut: 300000, last_delegation_parameter_update: 1700000000,
  rewards_earned: GRT(50), query_fees_collected: GRT(2), delegator_shares: GRT(400), provisioned_tokens: GRT(1000), url: 'https://x/', geohash: 'u14', created_at: 1600000000,
};
const answer = (sql: string) => {
  if (sql.includes('FROM lodestar_network_params')) return Promise.resolve([{ delegation_ratio: 16, epoch_length: 7200, total_curation_tax: '0', total_protocol_tax: '0' }]);
  if (sql.includes('FROM lodestar_network')) return Promise.resolve([{ total_tokens_signalled: GRT(20_000_000), issuance_per_block: '120730000000000000000', current_epoch: 1372 }]);
  if (sql.includes('FROM lodestar_indexers')) return Promise.resolve([indexerRow]);
  if (sql.includes("a.status = 'Active'")) return Promise.resolve([{ id: '0xa1', indexer: IX, allocated_tokens: GRT(1200), signalled_tokens: GRT(100), deployment_staked_tokens: GRT(5000) }]);
  if (sql.includes('FROM lodestar_delegations')) return Promise.resolve([{ event_type: 'delegation', indexer: IX, tokens: GRT(30) }, { event_type: 'undelegation', indexer: IX, tokens: GRT(10) }]);
  if (sql.includes("status = 'Closed'")) return Promise.resolve([{ indexer: IX, indexing_delegator_rewards: GRT(7), closed_at: 1788000000 }]);
  if (sql.includes('FROM lodestar_indexer_ledger')) {
    // 30d: 1.25 GRT/share; 90d: 1.10 GRT/share, so the rate has been rising
    return Promise.resolve([{ indexer: IX, pool_tokens: sql.includes(String(Math.floor(Date.now() / 1000) - 30 * 86400).slice(0, 6)) ? GRT(500) : GRT(440), pool_shares: GRT(400) }]);
  }
  if (sql.includes('FROM lodestar_provisions')) return Promise.resolve([{ indexer: IX, n: 2 }]);
  return Promise.resolve([]);
};

describe('refreshIndexers gathering from the nest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nuthatchConfigured = true;
    process.env.NUTHATCH_REFRESH = 'true';
  });
  afterEach(() => {
    delete process.env.NUTHATCH_REFRESH;
  });

  it('with the flag off, the gateway gatherer runs and the nest is never asked', async () => {
    delete process.env.NUTHATCH_REFRESH;
    mockSubgraphQuery.mockImplementation(async (q: string) => {
      if (q.includes('graphNetwork')) return { graphNetwork: { totalTokensSignalled: '0', delegationRatio: 16, currentEpoch: 1 } };
      if (q.includes('_meta')) return { _meta: { block: { number: 1000000 } } };
      return { indexers: [], allocations: [], provisions: [] };
    });
    mockDelegationEventsQuery.mockResolvedValue({ delegationEvents: [] });
    mockEnsQuery.mockResolvedValue({ domains: [] });
    const r = await refreshIndexers({ sql: null, writeToRedis: false });
    expect(r.count).toBe(0);
    expect(mockSubgraphQuery).toHaveBeenCalled();
    expect(mockNuthatchSql).not.toHaveBeenCalled();
  });

  it('gathers the eight inputs from nine nest queries and no subgraph', async () => {
    mockNuthatchSql.mockImplementation(answer);
    const inputs = await gatherFromNest();
    expect(mockNuthatchSql).toHaveBeenCalledTimes(9);
    expect(mockNuthatchSql.mock.calls.every((c) => c[1] === '/alloc')).toBe(true);
    expect(mockSubgraphQuery).not.toHaveBeenCalled();
    expect(mockEnsQuery).not.toHaveBeenCalled();
    expect(mockDelegationEventsQuery).not.toHaveBeenCalled();

    expect(inputs.network).toEqual({ totalTokensSignalled: GRT(20_000_000), networkGRTIssuancePerBlock: '120730000000000000000', delegationRatio: 16, currentEpoch: 1372 });
    expect(inputs.indexers).toHaveLength(1);
    const ix = inputs.indexers[0];
    expect(ix).toMatchObject({ id: IX, stakedTokens: GRT(1000), delegatedTokens: GRT(500), delegatedThawingTokens: GRT(10), indexingRewardCut: 300000, provisionedTokens: GRT(1000), account: { defaultDisplayName: null } });
    // own ratio = 1000 / min(1000 + 16000, 1500) = 2/3, per the subgraph's calculateOwnStakeRatio
    expect(Number(ix.ownStakeRatio)).toBeCloseTo(2 / 3, 9);
    expect(inputs.allocationMap.get(IX)).toEqual([{ id: '0xa1', allocatedTokens: GRT(1200), indexer: { id: IX }, subgraphDeployment: { signalledTokens: GRT(100), stakedTokens: GRT(5000) } }]);
    expect(inputs.delegationActivity[IX]).toEqual({ delegations: 1, undelegations: 1, netFlowGRT: 20 });
    expect(inputs.closedAllocsByIndexer.get(IX)).toEqual([{ delegator_rewards_grt: 7, closed_at: 1788000000 }]);
    const er = inputs.exchangeRateHistory.get(IX)!;
    expect(er.rate30d).toBeCloseTo(1.25, 9);
    expect(er.rate90d).toBeCloseTo(1.1, 9);
    expect(inputs.dataServiceCountMap.get(IX)).toBe(2);
    expect(inputs.ensNames).toEqual({});
  });

  it('the enrichment runs to completion on nest inputs', async () => {
    mockNuthatchSql.mockImplementation(answer);
    const r = await refreshIndexers({ sql: null, writeToRedis: false });
    expect(r.count).toBe(1);
    expect(mockSubgraphQuery).not.toHaveBeenCalled();
  });

  it('a nest that returns no network row fails loudly rather than enriching nothing quietly', async () => {
    mockNuthatchSql.mockImplementation((sql: string) => sql.endsWith('FROM lodestar_network') ? Promise.resolve([]) : answer(sql));
    await expect(gatherFromNest()).rejects.toThrow(/returned no row/);
  });
});
