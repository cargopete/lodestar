/**
 * `api/grt-flow` from the nest (nightswatchhq/nuthatch#1160), same views and flag as network-stats.
 * Pinned here: the flag off changes nothing; the nest path never consults the gateway key; `minted`
 * and `burned` are assembled from the bridge halves and the protocol's own mints and burns, in wei
 * before conversion; `curationTaxPct` is the curation tax (1%), not the query-fee curation cut the
 * gateway path mislabelled; and a failing view is a 503.
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

import { GET } from '../route';

const ok = (rows: unknown[], asOf = 501966429) => ({ ok: true, data: { count: rows.length, rows, truncated: false, provenance: { as_of: asOf } } });
const GRT = (n: number) => (BigInt(n) * 10n ** 18n).toString();
const network = {
  total_tokens_staked: GRT(3_000_000_000), total_delegated_tokens: GRT(2_000_000_000),
  total_tokens_signalled: GRT(20_000_000), total_tokens_allocated: GRT(2_500_000_000),
  total_indexing_rewards: GRT(900_000_000), total_query_fees: GRT(3_000_000),
  total_supply: GRT(3_480_000_000), issuance_per_block: '120730000000000000000',
  bridge_minted: GRT(3_600_000_000), bridge_burned: GRT(100_000_000),
  indexer_count: 184, staked_indexers_count: 184, delegator_count: 12000, active_delegator_count: 9000,
  curator_count: 1819, active_curator_count: 900, subgraph_count: 1200, active_subgraph_count: 700, current_epoch: 1372,
};
const params = {
  delegation_ratio: 16, curation_tax_percentage: 10000, protocol_payment_cut: 10000, max_thawing_period_seconds: 2419200,
  epoch_length: 7200, last_length_update_epoch: 1300, last_length_update_block: 480000000,
  total_curation_tax: GRT(200_000), total_protocol_tax: GRT(30_000),
};
const answer = (sql: string) => Promise.resolve(sql.includes('lodestar_network_params') ? ok([params]) : ok([network]));

describe('api/grt-flow from the nest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nuthatchConfigured = true;
    process.env.NUTHATCH_NETWORK = 'true';
  });
  afterEach(() => {
    delete process.env.NUTHATCH_NETWORK;
  });

  it('with the flag off, the gateway path is untouched', async () => {
    delete process.env.NUTHATCH_NETWORK;
    hasSubgraphAccess.mockReturnValue(true);
    subgraphQuery.mockResolvedValue({ graphNetwork: { totalSupply: '0' }, _meta: { block: { number: 1 } } });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(subgraphQuery).toHaveBeenCalledTimes(1);
    expect(nuthatchSqlReady).not.toHaveBeenCalled();
  });

  it('minted and burned are assembled from the bridge and protocol halves; the key is not consulted', async () => {
    nuthatchSqlReady.mockImplementation(answer);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(hasSubgraphAccess).not.toHaveBeenCalled();
    const d = (await res.json()).data;
    expect(d.source).toBe('nuthatch');
    expect(d.blockNumber).toBe(501966429);
    // bridge mints + indexing rewards minted
    expect(d.minted).toBeCloseTo(3_600_000_000 + 900_000_000, 3);
    // bridge burns + curation tax + protocol cut
    expect(d.burned).toBeCloseTo(100_000_000 + 200_000 + 30_000, 3);
    expect(d.staked).toBeCloseTo(3_000_000_000, 3);
    expect(d.issuancePerBlock).toBeCloseTo(120.73, 6);
    expect(d.counts).toEqual({ indexers: 184, stakedIndexers: 184, delegators: 12000, curators: 1819, currentEpoch: 1372 });
    expect(d.params).toEqual({ protocolFeePct: 1, curationTaxPct: 1, delegationTaxPct: 0, delegationRatio: 16 });
  });

  it('a failing view is a 503 with no fallback to the gateway', async () => {
    nuthatchSqlReady.mockResolvedValue({ ok: false, status: 503, error: 'nest is not ready: stalled' });
    const res = await GET();
    expect(res.status).toBe(503);
    expect(subgraphQuery).not.toHaveBeenCalled();
  });
});
