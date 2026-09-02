/**
 * The disassembly API surface: the single-report route and the two-deployment diff.
 *
 * Both take a deployment ID straight from a query string and hand it to a pipeline that fetches
 * from IPFS, so validation happens before anything is fetched rather than after. The other
 * behaviour worth pinning is the 422/500 split: a manifest that is not a manifest is the caller's
 * input, not a server fault, and reporting it as a 500 sends people looking in the wrong place.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const runDisassembly = vi.fn();
const fetchDeploymentSignal = vi.fn();
const fetchSourceHint = vi.fn();
const diffReports = vi.fn();

vi.mock('@/lib/cache', () => ({
  cached: (_k: string, _t: number, f: () => Promise<unknown>) => f(),
}));
vi.mock('@/lib/disassembly', () => ({ runDisassembly: (...a: unknown[]) => runDisassembly(...a) }));
vi.mock('@/lib/disassembly/signal', () => ({
  fetchDeploymentSignal: (...a: unknown[]) => fetchDeploymentSignal(...a),
}));
vi.mock('@/lib/disassembly/source-hint', () => ({
  fetchSourceHint: (...a: unknown[]) => fetchSourceHint(...a),
}));
vi.mock('@/lib/disassembly/diff', () => ({ diffReports: (...a: unknown[]) => diffReports(...a) }));
vi.mock('@/lib/logger', () => ({ log: { api: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } } }));

import { GET as reportGET } from '../route';
import { GET as diffGET } from '../diff/route';

const A = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';
const B = 'QmTgpMWFvVpNQwHCDdvNmQZTFMRPGDMLpFkTKPFqYRWCsQ';

const getReport = (qs: string) =>
  reportGET(new NextRequest(`http://localhost/api/disassembly${qs}`));
const getDiff = (qs: string) =>
  diffGET(new NextRequest(`http://localhost/api/disassembly/diff${qs}`));

beforeEach(() => {
  vi.clearAllMocks();
  runDisassembly.mockResolvedValue({ deploymentId: A, scorecard: { grade: 'A' } });
  fetchDeploymentSignal.mockResolvedValue({ signalledTokens: '0' });
  fetchSourceHint.mockResolvedValue({ codeRepository: 'https://github.com/x/y' });
  diffReports.mockReturnValue({ changed: true });
});

describe('GET /api/disassembly', () => {
  it.each([
    ['no id', ''],
    ['an empty id', '?id='],
    ['a non-CID', '?id=not-a-hash'],
    ['a CIDv1', '?id=bafybeigdyrztktx5'],
  ])('400s on %s without fetching anything', async (_label, qs) => {
    const res = await getReport(qs);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Invalid deployment ID/);
    expect(runDisassembly).not.toHaveBeenCalled();
  });

  it('returns the report with its signal and source hint attached', async () => {
    const res = await getReport(`?id=${A}`);
    const { data } = await res.json();

    expect(res.status).toBe(200);
    expect(data.deploymentId).toBe(A);
    expect(data.signal).toEqual({ signalledTokens: '0' });
    expect(data.sourceHint).toEqual({ codeRepository: 'https://github.com/x/y' });
    expect(res.headers.get('Cache-Control')).toMatch(/s-maxage=300/);
  });

  it.each([
    'Artifact at that hash is not a subgraph manifest',
    'Invalid deployment ID: expected a CIDv0 hash',
    'Not a WebAssembly module (bad magic)',
    'IPFS gateway returned 504 for Qm…',
  ])('reports "%s" as a 422, because it is the input not the server', async (message) => {
    runDisassembly.mockRejectedValue(new Error(message));
    const res = await getReport(`?id=${A}`);

    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe(message);
  });

  it('reports an unexpected failure as a 500', async () => {
    runDisassembly.mockRejectedValue(new Error('something else broke'));
    expect((await getReport(`?id=${A}`)).status).toBe(500);
  });

  it('handles a non-Error rejection', async () => {
    runDisassembly.mockRejectedValue('just a string');
    const res = await getReport(`?id=${A}`);

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Failed to disassemble subgraph');
  });
});

describe('GET /api/disassembly/diff', () => {
  it.each([
    ['neither id', ''],
    ['only one id', `?a=${A}`],
    ['a bad second id', `?a=${A}&b=nope`],
  ])('400s on %s', async (_label, qs) => {
    const res = await getDiff(qs);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/two deployment IDs/);
    expect(runDisassembly).not.toHaveBeenCalled();
  });

  it('refuses to compare a deployment with itself', async () => {
    // Not an error exactly, but a diff of nothing is a wasted pair of IPFS pipelines.
    const res = await getDiff(`?a=${A}&b=${A}`);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/identical/);
    expect(runDisassembly).not.toHaveBeenCalled();
  });

  it('diffs two reports, each carrying its own signal', async () => {
    fetchDeploymentSignal
      .mockResolvedValueOnce({ signalledTokens: '1' })
      .mockResolvedValueOnce({ signalledTokens: '2' });

    const res = await getDiff(`?a=${A}&b=${B}`);
    const { data } = await res.json();

    expect(res.status).toBe(200);
    expect(data.diff).toEqual({ changed: true });
    expect(runDisassembly).toHaveBeenCalledTimes(2);
    expect(diffReports).toHaveBeenCalledTimes(1);
    // The signals must not be crossed over between the two sides.
    expect(data.base.signal).toEqual({ signalledTokens: '1' });
    expect(data.target.signal).toEqual({ signalledTokens: '2' });
  });

  it('applies the same 422 rule to a bad artifact', async () => {
    runDisassembly.mockRejectedValue(new Error('Artifact at that hash is not a subgraph manifest'));
    expect((await getDiff(`?a=${A}&b=${B}`)).status).toBe(422);
  });

  it('reports an unexpected failure as a 500', async () => {
    runDisassembly.mockRejectedValue(new Error('kaboom'));
    expect((await getDiff(`?a=${A}&b=${B}`)).status).toBe(500);
  });

  it('handles a non-Error rejection', async () => {
    runDisassembly.mockRejectedValue(42);
    const res = await getDiff(`?a=${A}&b=${B}`);

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Failed to compare subgraphs');
  });
});
