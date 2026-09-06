/**
 * `api/network-stats` from `graph-allocations-nest` (nightswatchhq/nuthatch#1160): `lodestar_network`
 * for the aggregates and `lodestar_network_params` for the parameters beside them. Pinned here: the
 * flag off changes nothing; the nest path never consults the gateway key; the two rows arrive in the
 * `GraphNetwork` shape with the three legacy parameters stated (0, null, null) rather than guessed;
 * the block comes from the aggregates' provenance; and either view failing is a 503, not a half page.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/cache', () => ({
  cached: vi.fn((_k: string, _t: number, f: () => Promise<unknown>) => f()),
}));
const hasSubgraphAccess = vi.fn(() => false);
const subgraphQuery = vi.fn();
vi.mock('@/lib/subgraph', () => ({
  hasSubgraphAccess: () => hasSubgraphAccess(),
  subgraphQuery: (...a: unknown[]) => subgraphQuery(...a),
}));
vi.mock('@/lib/grt-supply', () => ({ fetchGrtSupplyBreakdown: vi.fn(async () => null) }));
const nuthatchSqlReady = vi.fn();
let nuthatchConfigured = true;
vi.mock('@/lib/nuthatch', () => ({
  hasNuthatch: () => nuthatchConfigured,
  nuthatchEnabled: (flag: string) => nuthatchConfigured && process.env[flag] === 'true',
  nuthatchSqlReady: (...a: unknown[]) => nuthatchSqlReady(...a),
}));
vi.mock('@/lib/logger', () => ({ log: { api: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } } }));

import { GET, graphNetworkFromNest } from '../route';

const ok = (rows: unknown[], asOf = 501966429) => ({ ok: true, data: { count: rows.length, rows, truncated: false, provenance: { as_of: asOf } } });
const network = {
  total_tokens_staked: '3000000000000000000000000000', total_delegated_tokens: '2000000000000000000000000000',
  total_tokens_signalled: '20000000000000000000000000', total_tokens_allocated: '2500000000000000000000000000',
  total_indexing_rewards: '900000000000000000000000000', total_query_fees: '3000000000000000000000000',
  total_supply: '3480000000000000000000000000', issuance_per_block: '120730000000000000000',
  bridge_minted: '3600000000000000000000000000', bridge_burned: '100000000000000000000000000',
  indexer_count: 184, staked_indexers_count: 184, delegator_count: 12000, active_delegator_count: 9000,
  curator_count: 1819, active_curator_count: 900, subgraph_count: 1200, active_subgraph_count: 700, current_epoch: 1372,
};
const params = {
  delegation_ratio: 16, curation_tax_percentage: 10000, protocol_payment_cut: 10000, max_thawing_period_seconds: 2419200,
  epoch_length: 7200, last_length_update_epoch: 1300, last_length_update_block: 480000000,
  total_curation_tax: '200000000000000000000000', total_protocol_tax: '30000000000000000000000',
};
// The two queries are dispatched by SQL text, so the order of Promise.all does not matter.
const answer = (sql: string) => Promise.resolve(sql.includes('lodestar_network_params') ? ok([params]) : ok([network]));

describe('api/network-stats from the nest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nuthatchConfigured = true;
    process.env.NUTHATCH_NETWORK = 'true';
  });
  afterEach(() => {
    delete process.env.NUTHATCH_NETWORK;
  });

  it('two rows become the GraphNetwork shape; the key is not consulted; the block is the provenance', async () => {
    nuthatchSqlReady.mockImplementation(answer);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(hasSubgraphAccess).not.toHaveBeenCalled();
    expect(subgraphQuery).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.source).toBe('nuthatch');
    const g = body.data.graphNetwork;
    expect(g).toMatchObject({
      totalTokensStaked: network.total_tokens_staked,
      totalDelegatedTokens: network.total_delegated_tokens,
      totalTokensSignalled: network.total_tokens_signalled,
      totalTokensAllocated: network.total_tokens_allocated,
      totalIndexingRewards: network.total_indexing_rewards,
      totalQueryFees: network.total_query_fees,
      currentEpoch: 1372,
      epochLength: 7200,
      lastLengthUpdateEpoch: 1300,
      lastLengthUpdateBlock: 480000000,
      indexerCount: 184, stakedIndexersCount: 184, delegatorCount: 12000, activeDelegatorCount: 9000,
      curatorCount: 1819, activeCuratorCount: 900, subgraphCount: 1200, activeSubgraphCount: 700,
      delegationRatio: 16,
      protocolFeePercentage: 10000,
      totalSupply: network.total_supply,
      networkGRTIssuancePerBlock: network.issuance_per_block,
    });
    expect(body.data._meta.block.number).toBe(501966429);
    expect(nuthatchSqlReady).toHaveBeenCalledTimes(2);
    expect(nuthatchSqlReady.mock.calls.every((c) => c[1] === '/alloc')).toBe(true);
  });

  it('the three legacy parameters are stated, not guessed: 0, null, null', () => {
    const g = graphNetworkFromNest(network as never, params as never);
    expect(g.delegationTaxPercentage).toBe(0);
    expect(g.maxAllocationEpochs).toBeNull();
    expect(g.thawingPeriod).toBeNull();
  });

  it('either view failing is a 503 with no fallback to the gateway', async () => {
    nuthatchSqlReady.mockImplementation((sql: string) =>
      Promise.resolve(sql.includes('lodestar_network_params')
        ? { ok: false, status: 503, error: 'nest is not ready: stalled' }
        : ok([network])),
    );
    const res = await GET();
    expect(res.status).toBe(503);
    expect(subgraphQuery).not.toHaveBeenCalled();
  });
});
