/**
 * `api/indexer-status` with the indexer's URL and allocations from the nest (nightswatchhq/nuthatch#1160).
 * Pinned here: the flag off changes nothing; the nest path never consults the gateway key and reads two
 * views; the allocations carry the deployment's CID so the indexer's own /status endpoint is asked the
 * same question as before; and with no URL on record every deployment reads unreachable, as before.
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
// No live indexer is probed: the fetch to the /status endpoint is stubbed to fail, which the route
// reports as unreachable rather than throwing.
vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));

import { GET } from '../route';

const ADDR = '0x6f9bb7e454f5b3eb2310343f0e99269dc2bb8a1d';
const DEP = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
const ok = (rows: unknown[]) => ({ ok: true, data: { count: rows.length, rows, truncated: false } });
const req = () => GET(new NextRequest(`http://localhost/api/indexer-status/${ADDR}`), { params: Promise.resolve({ address: ADDR }) });

describe('api/indexer-status from the nest', () => {
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
    subgraphQuery.mockResolvedValue({ indexer: { url: null }, allocations: [] });
    const res = await req();
    expect(res.status).toBe(200);
    expect(subgraphQuery).toHaveBeenCalledTimes(1);
    expect(nuthatchSqlReady).not.toHaveBeenCalled();
  });

  it('the URL and allocations come from two views, the key is not consulted, deployments carry CIDs', async () => {
    nuthatchSqlReady.mockImplementation((sql: string) =>
      sql.includes('FROM lodestar_indexers WHERE id')
        ? Promise.resolve(ok([{ id: ADDR, url: null }]))
        : Promise.resolve(ok([{ id: '0xa1', allocated_tokens: '500', created_at_epoch: 1300, subgraph_deployment: DEP, signalled_tokens: '7', deployment_staked_tokens: '900' }])));
    const res = await req();
    expect(res.status).toBe(200);
    expect(hasSubgraphAccess).not.toHaveBeenCalled();
    expect(subgraphQuery).not.toHaveBeenCalled();
    expect(nuthatchSqlReady).toHaveBeenCalledTimes(2);
    const body = await res.json();
    const d = body.data ?? body;
    expect(d.indexerAddress).toBe(ADDR);
    expect(d.totalAllocations).toBe(1);
    expect(d.unreachableCount).toBe(1);
    expect(d.deployments[0].ipfsHash ?? d.deployments[0].deployment?.ipfsHash ?? JSON.stringify(d.deployments[0])).toMatch(/Qm/);
  });

  it('a failing view is a 503-class error, with no fallback to the gateway', async () => {
    nuthatchSqlReady.mockResolvedValue({ ok: false, status: 503, error: 'nest is not ready: stalled' });
    const res = await req();
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(subgraphQuery).not.toHaveBeenCalled();
  });
});
