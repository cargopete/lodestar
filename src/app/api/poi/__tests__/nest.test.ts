/**
 * `api/poi` from the nest (nightswatchhq/nuthatch#1078). Pinned: the flag off changes nothing; the
 * nest path never consults the gateway key; a Qm hash resolves without a lookup; the rows reach the
 * consensus computation in the shape it reads, with the deployment hash rebuilt; an unready nest is
 * a 503, not a stale page.
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

import { GET } from '../route';
import { bytes32ToIpfsHash, ipfsHashToBytes32 } from '@/lib/studio/ipfs';

// A real deployment: the bytes32 id the chain uses and the CIDv0 the subgraph exposes as ipfsHash.
const DEP = '0x3baac22245b8f01e90775a94eb7a8ca71dbdc95ffd2d51b5ccee56fb98efe7cd';
const QM = 'QmSMZnP5ohf4T9i27gCPeKDuvfju4Eeo7F7m99satoLFJ4';
const POI = '0x1b9c02a610e59f8303d6671bb971354e70a3ea9daff7c3c690747901b53b7b54';

const ok = (rows: unknown[]) => ({ ok: true, data: { count: rows.length, rows, truncated: false } });
const row = (id: string, indexer: string, poi = POI, epoch = 1371) => ({
  id, poi, indexer, allocated_tokens: '100000000000000000000', closed_at_epoch: String(epoch), closed_at: 1788449434,
  subgraph_deployment: DEP, signalled_tokens: '48863687288479658652', staked_tokens: '0',
});
const req = (qs = '') => new NextRequest(`http://localhost/api/poi${qs}`);

describe('bytes32ToIpfsHash', () => {
  it('round-trips the real vector with ipfsHashToBytes32', () => {
    expect(bytes32ToIpfsHash(DEP)).toBe(QM);
    expect(ipfsHashToBytes32(QM)).toBe(DEP);
    expect(bytes32ToIpfsHash(DEP.toUpperCase().replace('0X', '0x'))).toBe(QM);
  });
  it('refuses anything that is not a bytes32', () => {
    expect(() => bytes32ToIpfsHash('0x1234')).toThrow(/bytes32/);
  });
});

describe('api/poi from the nest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NUTHATCH_POI', 'true');
    nuthatchConfigured = true;
  });
  afterEach(() => vi.unstubAllEnvs());

  it('is off by default, so the gateway path and its key gate are unchanged', async () => {
    vi.stubEnv('NUTHATCH_POI', 'false');
    const res = await GET(req());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'No API key configured' });
    expect(nuthatchSqlReady).not.toHaveBeenCalled();
  });

  it('never consults the gateway key on the nest path', async () => {
    nuthatchSqlReady.mockResolvedValueOnce(ok([]));
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(hasSubgraphAccess).not.toHaveBeenCalled();
    expect(subgraphQuery).not.toHaveBeenCalled();
  });

  it('builds the overview from closed allocations with a real POI, in the shape the consensus reads', async () => {
    nuthatchSqlReady.mockResolvedValueOnce(ok([
      row('0xa1', '0x1111111111111111111111111111111111111111'),
      row('0xa2', '0x2222222222222222222222222222222222222222'),
      row('0xa3', '0x3333333333333333333333333333333333333333', '0x' + 'ab'.repeat(32)),
    ]));
    const res = await GET(req());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.source).toBe('nuthatch');
    const sql = String(nuthatchSqlReady.mock.calls[0][0]);
    expect(sql).toMatch(/status = 'Closed'/);
    expect(sql).toMatch(/poi <> '0x0{64}'/);
    expect(sql).toMatch(/LIMIT 1000$/);
    expect(nuthatchSqlReady.mock.calls[0][1]).toBe('/alloc');
    expect(body.data.deployments).toHaveLength(1);
    expect(body.data.deployments[0]).toMatchObject({ deploymentId: DEP, ipfsHash: QM, uniqueIndexers: 3, allocationCount: 3, hasDivergence: true, signal: 48.863687288479658652, stake: 0 });
  });

  it('resolves a Qm deployment to its bytes32 id without any lookup', async () => {
    nuthatchSqlReady.mockResolvedValueOnce(ok([row('0xa1', '0x1111111111111111111111111111111111111111')]));
    const res = await GET(req(`?deployment=${QM}`));
    expect(res.status).toBe(200);
    expect(nuthatchSqlReady).toHaveBeenCalledTimes(1);
    expect(String(nuthatchSqlReady.mock.calls[0][0])).toContain(`a.subgraph_deployment = '${DEP}'`);
    const body = await res.json();
    expect(body.data).toMatchObject({ ipfsHash: QM });
  });

  it('is a 404 when a deployment has no POI history, and a 404 for a malformed id', async () => {
    nuthatchSqlReady.mockResolvedValueOnce(ok([]));
    expect((await GET(req(`?deployment=${DEP}`))).status).toBe(404);
    expect((await GET(req('?deployment=0xnope'))).status).toBe(404);
    expect(nuthatchSqlReady).toHaveBeenCalledTimes(1);
  });

  it('is a 503 when the nest is not ready, not a stale page', async () => {
    nuthatchSqlReady.mockResolvedValueOnce({ ok: false, error: 'nest not ready', reason: 'lag', status: 503 });
    const res = await GET(req());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'Failed to load POI data from Nuthatch' });
  });

  it('refuses when no nest origin is configured rather than falling back', async () => {
    nuthatchConfigured = false;
    const res = await GET(req());
    expect(res.status).toBe(503);
    expect(nuthatchSqlReady).not.toHaveBeenCalled();
  });
});
