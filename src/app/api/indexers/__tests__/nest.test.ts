/**
 * `api/indexers` from `graph-allocations-nest` (nightswatchhq/nuthatch#1160). Pinned here: the flag
 * off changes nothing; the nest path never consults the gateway key; the rows come back in the
 * subgraph's `Indexer` shape with wei as strings and counts as numbers; the ordering and paging the
 * caller asked for reach the SQL and nothing unvalidated does; and an unready nest is a 503 with its
 * reason, not a stale page.
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

import { GET, indexerFromNest } from '../route';

const ok = (rows: unknown[]) => ({ ok: true, data: { count: rows.length, rows, truncated: false } });

// A row as the nest returns it, from the 2026-09-05 measurement of 0x6f9b…8a1d against the contract:
// stake, pool and shares exact to the wei.
const row = {
  id: '0x6f9bb7e454f5b3eb2310343f0e99269dc2bb8a1d',
  staked_tokens: '3611876178485616456931049',
  locked_tokens: '0',
  delegated_tokens: '1796777000000000000000000',
  allocated_tokens: '5408653283000000000000000',
  allocation_count: 19,
  indexing_reward_cut: 296824,
  query_fee_cut: 296824,
  last_delegation_parameter_update: 1768606177,
  rewards_earned: '3597202486750771939113736',
  query_fees_collected: '33599064113719108856593',
  delegator_shares: '1185233321927365773723622',
  url: 'https://cp0x-arbitrum.ryabina.io/',
  geohash: 'u14227ug4',
  created_at: 1688170615,
};

const req = (qs = '') => new NextRequest(`http://localhost/api/indexers${qs}`);

describe('api/indexers from the nest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nuthatchConfigured = true;
    process.env.NUTHATCH_INDEXERS = 'true';
  });
  afterEach(() => {
    delete process.env.NUTHATCH_INDEXERS;
  });

  it('on the nest path the gateway key is not consulted and the rows arrive in the Indexer shape', async () => {
    nuthatchSqlReady.mockResolvedValue(ok([row]));
    const res = await GET(req('?first=50&skip=100&orderBy=delegatedTokens&orderDirection=asc'));
    expect(res.status).toBe(200);
    expect(hasSubgraphAccess).not.toHaveBeenCalled();
    expect(subgraphQuery).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.source).toBe('nuthatch');
    expect(body.data.indexers).toHaveLength(1);
    const ix = body.data.indexers[0];
    expect(ix).toMatchObject({
      id: row.id,
      account: { id: row.id, defaultDisplayName: null, metadata: null },
      stakedTokens: row.staked_tokens,
      delegatedTokens: row.delegated_tokens,
      allocatedTokens: row.allocated_tokens,
      allocationCount: 19,
      indexingRewardCut: 296824,
      queryFeeCut: 296824,
      delegatorParameterCooldown: 0,
      lastDelegationParameterUpdate: 1768606177,
      rewardsEarned: row.rewards_earned,
      delegatorShares: row.delegator_shares,
      url: row.url,
      geoHash: row.geohash,
      createdAt: 1688170615,
    });
    // Wei stays a decimal string end to end; nothing is coerced through a double on the way.
    expect(typeof ix.stakedTokens).toBe('string');
    expect(ix.stakedTokens).toBe('3611876178485616456931049');
  });

  it('paging and ordering reach the SQL, and only validated values do', async () => {
    nuthatchSqlReady.mockResolvedValue(ok([]));
    await GET(req('?first=50&skip=100&orderBy=delegatedTokens&orderDirection=asc'));
    const sql = nuthatchSqlReady.mock.calls[0][0] as string;
    expect(sql).toContain('FROM lodestar_indexers');
    expect(sql).toContain('ORDER BY i.delegated_tokens ASC');
    expect(sql).toContain('LIMIT 50 OFFSET 100');
    expect(sql).toContain("id <> '0xb43b2cccceada5292732a8c58ae134adefce09bb'");
    expect(nuthatchSqlReady.mock.calls[0][1]).toBe('/alloc');

    // An unknown orderBy falls back to stake, never into the SQL as text.
    nuthatchSqlReady.mockClear();
    await GET(req("?orderBy=id;DROP&orderDirection=up"));
    const sql2 = nuthatchSqlReady.mock.calls[0][0] as string;
    expect(sql2).toContain('ORDER BY i.staked_tokens DESC');
    expect(sql2).not.toContain('DROP');
  });

  it('a cut the contract never set reads as 0, the contract default, not as a guess', () => {
    const ix = indexerFromNest({ ...row, indexing_reward_cut: null, query_fee_cut: null, last_delegation_parameter_update: null });
    expect(ix.indexingRewardCut).toBe(0);
    expect(ix.queryFeeCut).toBe(0);
    expect(ix.lastDelegationParameterUpdate).toBe(row.created_at);
  });

  it('an unready nest is a 503 with its reason, and no fallback to the gateway', async () => {
    nuthatchSqlReady.mockResolvedValue({ ok: false, status: 503, error: 'nest is not ready: stalled', reason: 'stalled' });
    const res = await GET(req());
    expect(res.status).toBe(503);
    expect(subgraphQuery).not.toHaveBeenCalled();
  });

  it('without a configured nest the route is a 503, never a silent gateway read', async () => {
    nuthatchConfigured = false;
    const res = await GET(req());
    // There is no gateway path any more (nuthatch#1160): a dashboard with no nest configured says so.
    expect(res.status).toBe(503);
    expect(nuthatchSqlReady).not.toHaveBeenCalled();
  });
});
