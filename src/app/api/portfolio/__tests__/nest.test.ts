/**
 * `api/portfolio` from the nest (nightswatchhq/nuthatch#1160): `lodestar_delegators` +
 * `lodestar_delegator_stakes` for a delegator, `lodestar_curators` + `lodestar_curator_signals` for a
 * curator. Pinned here: the flag off changes nothing; the nest path consults neither the gateway key
 * nor the ENS subgraph; rows arrive in the `Delegator`/`DelegatedStake` and `Curator`/`Signal` shapes
 * with wei as strings; an unknown address is `{ delegator: null }`; a failing query is a 503.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/cache', () => ({
  cached: vi.fn((_k: string, _t: number, f: () => Promise<unknown>) => f()),
}));
const hasSubgraphAccess = vi.fn(() => false);
const subgraphQuery = vi.fn();
const ensQuery = vi.fn();
vi.mock('@/lib/subgraph', () => ({
  hasSubgraphAccess: () => hasSubgraphAccess(),
  subgraphQuery: (...a: unknown[]) => subgraphQuery(...a),
  ensQuery: (...a: unknown[]) => ensQuery(...a),
}));
const nuthatchSqlReady = vi.fn();
let nuthatchConfigured = true;
vi.mock('@/lib/nuthatch', () => ({
  hasNuthatch: () => nuthatchConfigured,
  nuthatchEnabled: (flag: string) => nuthatchConfigured && process.env[flag] === 'true',
  nuthatchSqlReady: (...a: unknown[]) => nuthatchSqlReady(...a),
}));
vi.mock('@/lib/logger', () => ({ log: { api: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } } }));

import { GET } from '../route';

const D = '0x00000000000000000000000000000000000000dd';
const IX = '0x6f9bb7e454f5b3eb2310343f0e99269dc2bb8a1d';
const DEP = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
const ok = (rows: unknown[]) => ({ ok: true, data: { count: rows.length, rows, truncated: false } });
const totals = { id: D, total_staked_tokens: '130000000000000000000', total_unstaked_tokens: '150000000000000000000', total_realized_rewards: '20000000000000000000', stakes_count: 1, active_stakes_count: 0 };
const stake = {
  id: `${D}-${IX}`, indexer: IX, staked_tokens: '0', share_amount: '0', locked_tokens: '90000000000000000000', locked_until: 1234567890,
  realized_rewards: '20000000000000000000', unstaked_tokens: '150000000000000000000', created_at: 1001, last_undelegated_at: 1004, active: false,
  indexer_staked_tokens: '3611876178485616456931049', indexer_delegated_tokens: '1796777000000000000000000', indexer_delegated_thawing_tokens: '8769000000000000000000',
  indexer_delegator_shares: '1185233321927365773723622', indexing_reward_cut: 296824, query_fee_cut: 296824, allocation_count: 19, url: 'https://x/', geohash: 'u14',
};
const curator = { id: D, total_signalled_tokens: '2349605726515838646100000', total_unsignalled_tokens: '2574000000000000000000', realized_rewards: '0', signal_count: 669, active_signal_count: 665 };
const sig = { id: `${D}-${DEP}`, subgraph_deployment: DEP, signalled_tokens: '990', unsignalled_tokens: '0', signal: '31', last_signal_change: 1700000000, realized_rewards: '0', deployment_signalled_tokens: '5000', deployment_query_fees_amount: '12', deployment_staked_tokens: '80000' };
const answer = (sql: string) => {
  if (sql.includes('FROM lodestar_delegators')) return Promise.resolve(ok([totals]));
  if (sql.includes('FROM lodestar_delegator_stakes')) return Promise.resolve(ok([stake]));
  if (sql.includes('FROM lodestar_curators')) return Promise.resolve(ok([curator]));
  if (sql.includes('FROM lodestar_curator_signals')) return Promise.resolve(ok([sig]));
  return Promise.resolve(ok([]));
};
const req = (qs: string) => GET(new NextRequest(`http://localhost/api/portfolio${qs}`));

describe('api/portfolio from the nest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nuthatchConfigured = true;
    process.env.NUTHATCH_PORTFOLIO = 'true';
  });
  afterEach(() => {
    delete process.env.NUTHATCH_PORTFOLIO;
  });

  it('with the flag off, the gateway path is untouched', async () => {
    delete process.env.NUTHATCH_PORTFOLIO;
    hasSubgraphAccess.mockReturnValue(true);
    subgraphQuery.mockResolvedValue({ delegator: null });
    const res = await req(`?address=${D}&type=delegator`);
    expect(res.status).toBe(200);
    expect(subgraphQuery).toHaveBeenCalledTimes(1);
    expect(nuthatchSqlReady).not.toHaveBeenCalled();
  });

  it('delegator: totals and stakes in the subgraph shape; neither the key nor ENS is consulted', async () => {
    nuthatchSqlReady.mockImplementation(answer);
    const res = await req(`?address=${D}&type=delegator`);
    expect(res.status).toBe(200);
    expect(hasSubgraphAccess).not.toHaveBeenCalled();
    expect(ensQuery).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.source).toBe('nuthatch');
    expect(body.data.delegator).toMatchObject({
      id: D, totalStakedTokens: totals.total_staked_tokens, totalUnstakedTokens: totals.total_unstaked_tokens,
      totalRealizedRewards: totals.total_realized_rewards, stakesCount: 1, activeStakesCount: 0,
    });
    expect(body.data.delegator.stakes).toEqual([
      {
        id: stake.id, stakedTokens: '0', shareAmount: '0', lockedTokens: stake.locked_tokens, lockedUntil: 1234567890,
        realizedRewards: stake.realized_rewards, unstakedTokens: stake.unstaked_tokens, createdAt: 1001, lastUndelegatedAt: 1004,
        indexer: {
          id: IX, account: { id: IX, defaultDisplayName: null, metadata: null },
          stakedTokens: stake.indexer_staked_tokens, delegatedTokens: stake.indexer_delegated_tokens, delegatedThawingTokens: stake.indexer_delegated_thawing_tokens,
          delegatorShares: stake.indexer_delegator_shares, indexingRewardCut: 296824, queryFeeCut: 296824, delegatorParameterCooldown: 0, allocationCount: 19,
        },
      },
    ]);
    expect(nuthatchSqlReady.mock.calls.every((c) => c[1] === '/alloc')).toBe(true);
  });

  it('curator: totals and signal positions, deployment ids as CIDs, name-signal totals stated 0', async () => {
    nuthatchSqlReady.mockImplementation(answer);
    const res = await req(`?address=${D}&type=curator`);
    expect(res.status).toBe(200);
    const c = (await res.json()).data.curator;
    expect(c).toMatchObject({ id: D, totalSignalledTokens: curator.total_signalled_tokens, realizedRewards: '0', signalCount: 669, activeSignalCount: 665, totalNameSignalledTokens: '0' });
    expect(c.signals).toHaveLength(1);
    expect(c.signals[0]).toMatchObject({ id: sig.id, signalledTokens: '990', signal: '31', lastSignalChange: 1700000000, realizedRewards: '0' });
    expect(c.signals[0].subgraphDeployment).toMatchObject({ id: DEP, signalledTokens: '5000', queryFeesAmount: '12', stakedTokens: '80000' });
    expect(c.signals[0].subgraphDeployment.ipfsHash).toMatch(/^Qm/);
  });

  it('an unknown address is { delegator: null }', async () => {
    nuthatchSqlReady.mockResolvedValue(ok([]));
    const res = await req(`?address=0x00000000000000000000000000000000000000ff&type=delegator`);
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ delegator: null });
  });

  it('a failing query is a 503 with no fallback to the gateway', async () => {
    nuthatchSqlReady.mockResolvedValue({ ok: false, status: 503, error: 'nest is not ready: stalled' });
    const res = await req(`?address=${D}&type=delegator`);
    expect(res.status).toBe(503);
    expect(subgraphQuery).not.toHaveBeenCalled();
  });
});
