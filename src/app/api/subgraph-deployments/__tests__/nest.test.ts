/**
 * The deployment lists, 30-day fees and search from the nests behind NUTHATCH_SUBGRAPHS
 * (nightswatchhq/nuthatch#1160, group B). Pinned here: the flag off changes nothing; the nest paths
 * never consult the gateway key; rows come back in the shapes the pages read (`indexerAllocations`
 * and `curatorSignals` as arrays of the counted length, wei as strings, CIDv0 from the bytes32 id);
 * ordering and paging reach the SQL; the hash lookup converts to the on-chain id; fees-30d drops dust
 * signal; search dispatches address, hash prefix and name to the three finders; a failing nest is 503.
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
const subgraphMetadataForDeployments = vi.fn();
const byName = vi.fn(); const byHash = vi.fn(); const byAddress = vi.fn();
vi.mock('@/lib/subgraph-metadata', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/subgraph-metadata')>();
  return {
    ...real,
    subgraphMetadataForDeployments: (...a: unknown[]) => subgraphMetadataForDeployments(...a),
    searchSubgraphsByName: (...a: unknown[]) => byName(...a),
    searchDeploymentsByHashPrefix: (...a: unknown[]) => byHash(...a),
    searchDeploymentsByManifestAddress: (...a: unknown[]) => byAddress(...a),
  };
});
vi.mock('@/lib/logger', () => ({ log: { api: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } } }));

import { GET as deployments } from '../route';
import { GET as fees30d } from '../../subgraph-fees-30d/route';
import { GET as search } from '../../subgraph-search/route';

const CID = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';
const ID = '0x9c3d4f6ea4b1a3cbb9e8b5e7d8c3a1f6e2b4d9a8c7f1e3b5d7a9c2e4f6b8d0a2'.toLowerCase();
const ok = (rows: unknown[]) => ({ ok: true, data: { count: rows.length, rows, truncated: false } });
const dep = (id: string, signalled = '5000000000000000000000') => ({ id, signalled_tokens: signalled, staked_tokens: '80000000000000000000000', query_fees_amount: '12000000000000000000', created_at: 1700000000, active_allocation_count: 3, curator_count: 7 });

describe('group B lists and search from the nests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nuthatchConfigured = true;
    process.env.NUTHATCH_SUBGRAPHS = 'true';
    subgraphMetadataForDeployments.mockImplementation(async (ids: string[]) => new Map(ids.map((i) => [i.toLowerCase(), { subgraphId: '42', metadata: { displayName: 'Demo', categories: ['DeFi'], description: 'd' }, version: null }])));
  });
  afterEach(() => {
    delete process.env.NUTHATCH_SUBGRAPHS;
  });

  it('with the flag off, the gateway paths are untouched', async () => {
    delete process.env.NUTHATCH_SUBGRAPHS;
    hasSubgraphAccess.mockReturnValue(true);
    subgraphQuery.mockResolvedValue({ subgraphDeployments: [], allocations: [], subgraphs: [] });
    expect((await deployments(new NextRequest('http://localhost/api/subgraph-deployments'))).status).toBe(200);
    expect((await fees30d()).status).toBe(200);
    expect((await search(new NextRequest('http://localhost/api/subgraph-search?q=demo'))).status).toBe(200);
    expect(subgraphQuery).toHaveBeenCalled();
    expect(nuthatchSqlReady).not.toHaveBeenCalled();
    expect(byName).not.toHaveBeenCalled();
  });

  it('deployments list: ordering and paging reach the SQL; rows come back in the page shape; no key', async () => {
    nuthatchSqlReady.mockResolvedValue(ok([dep(ID)]));
    const res = await deployments(new NextRequest('http://localhost/api/subgraph-deployments?first=50&skip=100&orderBy=queryFeesAmount&orderDirection=asc'));
    expect(res.status).toBe(200);
    expect(hasSubgraphAccess).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.source).toBe('nuthatch');
    expect(body.data).toHaveLength(1);
    const d = body.data[0];
    expect(d).toMatchObject({ id: ID, signalledTokens: '5000000000000000000000', stakedTokens: '80000000000000000000000', queryFeesAmount: '12000000000000000000', createdAt: 1700000000, displayName: 'Demo', categories: ['DeFi'] });
    expect(d.ipfsHash).toMatch(/^Qm/);
    expect(d.indexerAllocations).toHaveLength(3);
    expect(d.curatorSignals).toHaveLength(7);
    const sql = nuthatchSqlReady.mock.calls[0][0] as string;
    expect(sql).toContain('FROM lodestar_deployments');
    expect(sql).toContain('ORDER BY query_fees_amount ASC');
    expect(sql).toContain('LIMIT 50 OFFSET 100');
    expect(sql).toContain('signalled_tokens > 1000000000000000000');
    expect(nuthatchSqlReady.mock.calls[0][1]).toBe('/alloc');
  });

  it('deployments hash lookup: the CID becomes the on-chain id in the SQL', async () => {
    nuthatchSqlReady.mockResolvedValue(ok([]));
    const res = await deployments(new NextRequest(`http://localhost/api/subgraph-deployments?hash=${CID}`));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual([]);
    const sql = nuthatchSqlReady.mock.calls[0][0] as string;
    expect(sql).toMatch(/WHERE id IN \('0x[0-9a-f]{64}'\)/);
    expect(sql).not.toContain('LIMIT');
  });

  it('fees-30d: one GROUP BY over closed allocations, details by id, dust signal dropped, fees attached', async () => {
    const rich = ID; const dust = ID.replace(/.$/, '1');
    nuthatchSqlReady.mockImplementation((sql: string) => {
      if (sql.includes('GROUP BY 1')) return Promise.resolve(ok([{ id: rich, query_fees: '777' }, { id: dust, query_fees: '999' }]));
      return Promise.resolve(ok([dep(rich), dep(dust, '1000000000000000000')]));
    });
    const res = await fees30d();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ id: rich, queryFees30d: '777', displayName: 'Demo' });
    const first = nuthatchSqlReady.mock.calls[0][0] as string;
    expect(first).toContain("status = 'Closed'");
    expect(first).toContain('FROM lodestar_allocations');
    expect(first).toMatch(/closed_at >= \d{10}/);
    expect(first).toContain('LIMIT 200');
    expect(nuthatchSqlReady.mock.calls[1][0]).toContain(`'${rich}', '${dust}'`);
  });

  it('search: address, hash prefix and name each reach their finder and nothing else', async () => {
    const hit = { id: '42', metadata: { displayName: 'Demo', description: null }, currentVersion: { subgraphDeployment: { ipfsHash: CID, signalledTokens: '1', stakedTokens: '2' } } };
    byAddress.mockResolvedValue([hit]); byHash.mockResolvedValue([hit]); byName.mockResolvedValue([hit]);
    const addr = '0x6f9bb7e454f5b3eb2310343f0e99269dc2bb8a1d';
    let res = await search(new NextRequest(`http://localhost/api/subgraph-search?q=${addr}`));
    expect((await res.json())).toEqual({ data: [hit], source: 'nuthatch' });
    expect(byAddress).toHaveBeenCalledWith(addr, 20);
    res = await search(new NextRequest(`http://localhost/api/subgraph-search?q=${CID.slice(0, 12)}`));
    expect(res.status).toBe(200);
    expect(byHash).toHaveBeenCalledWith(CID.slice(0, 12), 10);
    res = await search(new NextRequest('http://localhost/api/subgraph-search?q=uniswap'));
    expect(res.status).toBe(200);
    expect(byName).toHaveBeenCalledWith('uniswap', 10);
    expect(byAddress).toHaveBeenCalledTimes(1); expect(byHash).toHaveBeenCalledTimes(1); expect(byName).toHaveBeenCalledTimes(1);
    expect(hasSubgraphAccess).not.toHaveBeenCalled();
  });

  it('search: a short or disallowed query is an empty list before any finder runs', async () => {
    expect((await (await search(new NextRequest('http://localhost/api/subgraph-search?q=a'))).json()).data).toEqual([]);
    expect((await (await search(new NextRequest('http://localhost/api/subgraph-search?q=%27%3Bdrop'))).json()).data).toEqual([]);
    expect(byName).not.toHaveBeenCalled();
  });

  it('a failing nest is a 503 on every route with no fallback to the gateway', async () => {
    nuthatchSqlReady.mockResolvedValue({ ok: false, status: 503, error: 'nest is not ready: stalled' });
    byName.mockRejectedValue(new Error('nest is not ready: stalled'));
    expect((await deployments(new NextRequest('http://localhost/api/subgraph-deployments'))).status).toBe(503);
    expect((await fees30d()).status).toBe(503);
    expect((await search(new NextRequest('http://localhost/api/subgraph-search?q=demo'))).status).toBe(503);
    expect(subgraphQuery).not.toHaveBeenCalled();
  });
});
