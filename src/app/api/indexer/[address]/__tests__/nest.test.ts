/**
 * `api/indexer/[address]` from `graph-allocations-nest` (nightswatchhq/nuthatch#1160). Pinned here:
 * the flag off changes nothing; the nest path never consults the gateway key; six queries assemble
 * the page's shape with operators, delegators, active and closed allocations; the derived metrics
 * follow the subgraph's own formulas; deployment ids become the CIDv0 hashes the page links with;
 * an unknown indexer is `{ indexer: null }` as on the gateway path; and any failing query is a 503.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/cache', () => ({
  cached: vi.fn((_k: string, _t: number, f: () => Promise<unknown>) => f()),
}));
const hasSubgraphAccess = vi.fn(() => false);
const subgraphQuery = vi.fn();
vi.mock('@/lib/subgraph', () => ({
  hasSubgraphAccess: () => hasSubgraphAccess(),
  subgraphQuery: (...a: unknown[]) => subgraphQuery(...a),
}));
const nuthatchSqlReady = vi.fn();
let nuthatchConfigured = true;
vi.mock('@/lib/nuthatch', () => ({
  hasNuthatch: () => nuthatchConfigured,
  nuthatchEnabled: (flag: string) => nuthatchConfigured && process.env[flag] === 'true',
  nuthatchSqlReady: (...a: unknown[]) => nuthatchSqlReady(...a),
}));
vi.mock('@/lib/logger', () => ({ log: { api: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } } }));

import { GET, derivedIndexerMetrics } from '../route';

const ADDR = '0x6f9bb7e454f5b3eb2310343f0e99269dc2bb8a1d';
const DEP = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
const ok = (rows: unknown[]) => ({ ok: true, data: { count: rows.length, rows, truncated: false } });
// 0x6f9b…8a1d on 8107, 2026-09-05, exact against the contract.
const me = {
  id: ADDR, staked_tokens: '3611876178485616456931049', locked_tokens: '0', locked_until: null,
  delegated_tokens: '1796777000000000000000000', delegated_thawing_tokens: '8769000000000000000000',
  allocated_tokens: '5408653283000000000000000', allocation_count: 19, indexing_reward_cut: 296824, query_fee_cut: 296824,
  last_delegation_parameter_update: 1768606177, rewards_earned: '3597202486750771939113736',
  query_fees_collected: '33599064113719108856593', delegator_shares: '1185233321927365773723622',
  provisioned_tokens: '3611876178000000000000000', url: 'https://cp0x-arbitrum.ryabina.io/', geohash: 'u14227ug4', created_at: 1688170615,
};
const answer = (sql: string) => {
  if (sql.includes('FROM lodestar_indexers WHERE id')) return Promise.resolve(ok([me]));
  if (sql.includes('staking__operator_set')) return Promise.resolve(ok([{ operator: '0x00000000000000000000000000000000000000aa' }]));
  if (sql.includes('FROM lodestar_delegator_stakes')) return Promise.resolve(ok([{ id: `0xd-${ADDR}`, delegator: '0xd', staked_tokens: '100', share_amount: '90' }]));
  if (sql.includes("status = 'Active'")) return Promise.resolve(ok([{ id: '0xa1', allocated_tokens: '500', created_at_epoch: 1300, subgraph_deployment: DEP, signalled_tokens: '7', deployment_staked_tokens: '900' }]));
  if (sql.includes("status = 'Closed'")) return Promise.resolve(ok([{ id: '0xa0', allocated_tokens: '400', created_at_epoch: 1200, closed_at_epoch: 1250, closed_at: 1700000000, indexing_rewards: '11', query_fees_collected: '2', poi: '0xp', force_closed: false, subgraph_deployment: DEP }]));
  if (sql.includes('lodestar_network_params')) return Promise.resolve(ok([{ delegation_ratio: 16 }]));
  return Promise.resolve(ok([]));
};
const req = (a = ADDR) => GET(new NextRequest(`http://localhost/api/indexer/${a}`), { params: Promise.resolve({ address: a }) });

describe('api/indexer/[address] from the nest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nuthatchConfigured = true;
    process.env.NUTHATCH_INDEXERS = 'true';
  });
  afterEach(() => {
    delete process.env.NUTHATCH_INDEXERS;
  });

  it('with the flag off, the gateway path is untouched', async () => {
    delete process.env.NUTHATCH_INDEXERS;
    hasSubgraphAccess.mockReturnValue(true);
    subgraphQuery.mockResolvedValue({ indexer: null });
    const res = await req();
    expect(res.status).toBe(200);
    expect(subgraphQuery).toHaveBeenCalledTimes(1);
    expect(nuthatchSqlReady).not.toHaveBeenCalled();
  });

  it('six queries assemble the page shape; the key is not consulted; deployment ids become CIDs', async () => {
    nuthatchSqlReady.mockImplementation(answer);
    const res = await req();
    expect(res.status).toBe(200);
    expect(hasSubgraphAccess).not.toHaveBeenCalled();
    expect(nuthatchSqlReady).toHaveBeenCalledTimes(6);
    expect(nuthatchSqlReady.mock.calls.every((c) => c[1] === '/alloc')).toBe(true);
    const body = await res.json();
    expect(body.source).toBe('nuthatch');
    const ix = body.data.indexer;
    expect(ix).toMatchObject({
      id: ADDR,
      account: { id: ADDR, defaultDisplayName: null, operators: [{ id: '0x00000000000000000000000000000000000000aa' }], metadata: null },
      stakedTokens: me.staked_tokens, delegatedTokens: me.delegated_tokens, delegatedThawingTokens: me.delegated_thawing_tokens,
      allocationCount: 19, indexingRewardCut: 296824, provisionedTokens: me.provisioned_tokens,
      delegators: [{ id: `0xd-${ADDR}`, stakedTokens: '100', shareAmount: '90', delegator: { id: '0xd' } }],
    });
    expect(ix.allocations).toHaveLength(1);
    expect(ix.allocations[0].subgraphDeployment.id).toBe(DEP);
    expect(ix.allocations[0].subgraphDeployment.ipfsHash).toMatch(/^Qm[1-9A-HJ-NP-Za-km-z]{44}$/);
    expect(ix.allocations[0].subgraphDeployment.stakedTokens).toBe('900');
    expect(ix.closedAllocations[0]).toMatchObject({ id: '0xa0', closedAtEpoch: 1250, closedAt: 1700000000, poi: '0xp', forceClosed: false });
    // tokenCapacity = staked + min(delegated, staked * 16): delegated is far below the cap here.
    expect(BigInt(ix.tokenCapacity)).toBe(BigInt(me.staked_tokens) + BigInt(me.delegated_tokens));
  });

  it('the derived metrics follow the subgraph formulas', () => {
    // 1,000 own, 0 locked, 500 delegated, cut 30%: usable total 1,500; own ratio 2/3.
    const m = derivedIndexerMetrics({ ...me, staked_tokens: (1000n * 10n ** 18n).toString(), locked_tokens: '0', delegated_tokens: (500n * 10n ** 18n).toString(), indexing_reward_cut: 300000 } as never, 16);
    expect(Number(m.ownStakeRatio)).toBeCloseTo(2 / 3, 9);
    expect(Number(m.delegatedStakeRatio)).toBeCloseTo(1 / 3, 9);
    // effective cut = 1 - (0.7 / (1/3)) = -1.1 : the subgraph's number, negative when delegators are over-paid
    expect(Number(m.indexingRewardEffectiveCut)).toBeCloseTo(1 - 0.7 / (1 / 3), 9);
    expect(Number(m.overDelegationDilution)).toBe(0);
    expect(Number(m.indexerRewardsOwnGenerationRatio)).toBeCloseTo(0.3 / (2 / 3), 9);
    expect(m.tokenCapacity).toBe((1500n * 10n ** 18n).toString());
  });

  it('an unknown indexer is { indexer: null }, as on the gateway path', async () => {
    nuthatchSqlReady.mockImplementation((sql: string) => sql.includes('lodestar_network_params') ? Promise.resolve(ok([{ delegation_ratio: 16 }])) : Promise.resolve(ok([])));
    const res = await req('0x00000000000000000000000000000000000000ff');
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ indexer: null });
  });

  it('any failing query is a 503 with no fallback to the gateway', async () => {
    nuthatchSqlReady.mockImplementation((sql: string) => sql.includes('lodestar_delegator_stakes')
      ? Promise.resolve({ ok: false, status: 503, error: 'nest is not ready: stalled' })
      : answer(sql));
    const res = await req();
    expect(res.status).toBe(503);
    expect(subgraphQuery).not.toHaveBeenCalled();
  });
});
