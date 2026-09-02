/**
 * POST /api/disassembly/verify — build a subgraph from source and compare it to what is deployed.
 *
 * This route runs untrusted code and spends real money doing it, so most of what it does before
 * the sandbox starts is refusal. The tests below are mostly about the refusals holding:
 *
 *  - `repoUrl` is an SSRF surface. It is fetched by a builder with network access, so an
 *    `http://` scheme, an internal hostname, or a host that merely *ends* in `github.com` must be
 *    rejected before anything is cloned.
 *  - `manifestPath` is passed to that builder as a path. `..` in it is a traversal.
 *  - the rate limit is what stands between one caller and an unbounded build bill, so it must be
 *    consulted before the build and must stop it.
 *  - the 422/500 split. A manifest that is not a manifest is the caller's input; reporting it as a
 *    server fault sends the next person to read the wrong logs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const runDisassembly = vi.fn();
const ipfsCatBytes = vi.fn();
const buildSubgraphInSandbox = vi.fn();
const compareBuild = vi.fn();
const verifyRateLimit = vi.fn();

vi.mock('@/lib/cache', () => ({
  cached: (_k: string, _t: number, f: () => Promise<unknown>) => f(),
}));
vi.mock('@/lib/disassembly', () => ({ runDisassembly: (...a: unknown[]) => runDisassembly(...a) }));
vi.mock('@/lib/disassembly/ipfs', () => ({
  ipfsCatBytes: (...a: unknown[]) => ipfsCatBytes(...a),
  IPFS_HASH_RE: /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/,
}));
vi.mock('@/lib/disassembly/build-sandbox', () => ({
  buildSubgraphInSandbox: (...a: unknown[]) => buildSubgraphInSandbox(...a),
}));
vi.mock('@/lib/disassembly/verify', () => ({ compareBuild: (...a: unknown[]) => compareBuild(...a) }));
vi.mock('@/lib/disassembly/verify-limit', () => ({
  verifyRateLimit: (...a: unknown[]) => verifyRateLimit(...a),
}));
vi.mock('@/lib/scuttlebutt-ip', () => ({
  clientIp: () => '203.0.113.7',
  hashIp: (ip: string) => `h:${ip}`,
}));
vi.mock('@/lib/logger', () => ({ log: { api: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } } }));

import { POST } from '../route';

const QM = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';
const REPO = 'https://github.com/graphprotocol/example-subgraph';

function post(body: unknown) {
  return new NextRequest('http://localhost/api/disassembly/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const call = (body: unknown) => POST(post(body));

beforeEach(() => {
  vi.clearAllMocks();
  verifyRateLimit.mockResolvedValue({ allowed: true });
  runDisassembly.mockResolvedValue({ dataSources: [] });
  buildSubgraphInSandbox.mockResolvedValue({ ok: true, modules: [], log: 'built', durationMs: 1000 });
  compareBuild.mockReturnValue({ verdict: 'match', modules: [] });
});

describe('deployment id validation', () => {
  it('rejects a missing id', async () => {
    const res = await call({ repoUrl: REPO });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/CIDv0/);
  });

  it('rejects something that is not a CIDv0', async () => {
    expect((await call({ deploymentId: 'not-a-hash', repoUrl: REPO })).status).toBe(400);
  });

  it('rejects a body that is not JSON at all, without throwing', async () => {
    const res = await POST(post('{ not json'));
    expect(res.status).toBe(400);
  });

  it('does not start a build for a bad id', async () => {
    await call({ deploymentId: 'nope', repoUrl: REPO });
    expect(buildSubgraphInSandbox).not.toHaveBeenCalled();
    expect(verifyRateLimit).not.toHaveBeenCalled();
  });
});

describe('the repoUrl allowlist', () => {
  const rejected: [string, unknown][] = [
    ['a missing url', undefined],
    ['a non-string', 42],
    ['something that is not a URL', 'github.com/foo/bar'],
    ['http rather than https', 'http://github.com/foo/bar'],
    ['a host outside the allowlist', 'https://evil.example/foo/bar'],
    // The classic near-miss: a suffix match would let this through.
    ['a lookalike host', 'https://github.com.evil.example/foo/bar'],
    ['an internal host', 'https://169.254.169.254/latest/meta-data/'],
    ['a file url', 'file:///etc/passwd'],
    ['an over-long url', `https://github.com/${'a'.repeat(400)}`],
  ];

  for (const [name, repoUrl] of rejected) {
    it(`rejects ${name}`, async () => {
      const res = await call({ deploymentId: QM, repoUrl });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/github\.com/);
      expect(buildSubgraphInSandbox).not.toHaveBeenCalled();
    });
  }

  for (const host of ['github.com', 'gitlab.com', 'bitbucket.org']) {
    it(`accepts ${host}`, async () => {
      const res = await call({ deploymentId: QM, repoUrl: `https://${host}/o/r` });
      expect(res.status).toBe(200);
    });
  }
});

describe('the optional build inputs', () => {
  it('passes ref, manifestPath and prepareCommand through', async () => {
    await call({
      deploymentId: QM,
      repoUrl: REPO,
      ref: 'v1.2.3',
      manifestPath: 'packages/subgraph/subgraph.yaml',
      prepareCommand: 'pnpm codegen',
    });

    expect(buildSubgraphInSandbox).toHaveBeenCalledWith({
      repoUrl: `${REPO}`,
      ref: 'v1.2.3',
      manifestPath: 'packages/subgraph/subgraph.yaml',
      prepareCommand: 'pnpm codegen',
    });
  });

  it('drops a traversing manifestPath rather than refusing the request', async () => {
    // Undefined means "the default manifest", which is safe. Passing `..` on would not be.
    await call({ deploymentId: QM, repoUrl: REPO, manifestPath: '../../etc/passwd' });
    expect(buildSubgraphInSandbox).toHaveBeenCalledWith(
      expect.objectContaining({ manifestPath: undefined }),
    );
  });

  it('drops over-long and non-string inputs', async () => {
    await call({
      deploymentId: QM,
      repoUrl: REPO,
      ref: 'r'.repeat(201),
      manifestPath: 'm'.repeat(201),
      prepareCommand: { evil: true },
    });

    expect(buildSubgraphInSandbox).toHaveBeenCalledWith({
      repoUrl: expect.any(String),
      ref: undefined,
      manifestPath: undefined,
      prepareCommand: undefined,
    });
  });
});

describe('the rate limit', () => {
  it('is consulted with the hashed client IP before any build starts', async () => {
    await call({ deploymentId: QM, repoUrl: REPO });
    expect(verifyRateLimit).toHaveBeenCalledWith('h:203.0.113.7', expect.any(Number));
  });

  it('429s with the limiter\'s own reason, and does not build', async () => {
    verifyRateLimit.mockResolvedValue({ allowed: false, reason: 'Rate limit: max 8 builds per hour per IP.' });

    const res = await call({ deploymentId: QM, repoUrl: REPO });
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/max 8 builds/);
    expect(buildSubgraphInSandbox).not.toHaveBeenCalled();
    expect(runDisassembly).not.toHaveBeenCalled();
  });
});

describe('the comparison', () => {
  it('reports "unbuildable" with the build log rather than an error status', async () => {
    // A source tree that will not build is a fact about the subgraph, not a fault here.
    buildSubgraphInSandbox.mockResolvedValue({
      ok: false,
      error: 'graph build exited 1',
      log: 'ERROR: …',
      durationMs: 4200,
    });

    const res = await call({ deploymentId: QM, repoUrl: REPO });
    const { data } = await res.json();

    expect(res.status).toBe(200);
    expect(data.verdict).toBe('unbuildable');
    expect(data.comparison).toBeNull();
    expect(data.build).toEqual({ error: 'graph build exited 1', log: 'ERROR: …', durationMs: 4200 });
    expect(compareBuild).not.toHaveBeenCalled();
  });

  it('fetches each distinct wasm hash exactly once', async () => {
    // Two data sources sharing a mapping is normal; fetching it twice is paid-for waste.
    runDisassembly.mockResolvedValue({
      dataSources: [
        { name: 'A', wasmHash: 'QmWasm1' },
        { name: 'B', wasmHash: 'QmWasm1' },
        { name: 'C', wasmHash: 'QmWasm2' },
        { name: 'D', wasmHash: null },
      ],
    });
    ipfsCatBytes.mockResolvedValue(new Uint8Array([0, 97, 115, 109]));

    await call({ deploymentId: QM, repoUrl: REPO });

    expect(ipfsCatBytes).toHaveBeenCalledTimes(2);
    const named = compareBuild.mock.calls[0][1] as { name: string }[];
    expect(named.map((m) => m.name)).toEqual(['A', 'B', 'C']);
  });

  it('drops a data source whose wasm could not be fetched instead of failing the request', async () => {
    runDisassembly.mockResolvedValue({
      dataSources: [
        { name: 'A', wasmHash: 'QmWasm1' },
        { name: 'B', wasmHash: 'QmGone' },
      ],
    });
    ipfsCatBytes.mockImplementation(async (hash: string) => {
      if (hash === 'QmGone') throw new Error('gateway 404');
      return new Uint8Array([1]);
    });

    const res = await call({ deploymentId: QM, repoUrl: REPO });
    expect(res.status).toBe(200);
    const named = compareBuild.mock.calls[0][1] as { name: string }[];
    expect(named.map((m) => m.name)).toEqual(['A']);
  });

  it('returns the comparator\'s verdict and the build metadata', async () => {
    buildSubgraphInSandbox.mockResolvedValue({
      ok: true,
      modules: [{ name: 'A', bytes: new Uint8Array([1]) }],
      log: 'ok',
      durationMs: 9000,
    });
    compareBuild.mockReturnValue({ verdict: 'mismatch', modules: [{ name: 'A', same: false }] });

    const { data } = await (await call({ deploymentId: QM, repoUrl: REPO })).json();
    expect(data.verdict).toBe('mismatch');
    expect(data.comparison.modules).toHaveLength(1);
    expect(data.build).toEqual({ log: 'ok', durationMs: 9000, moduleCount: 1 });
  });
});

describe('error mapping', () => {
  const caller = [
    'manifest is not a subgraph manifest',
    'bad deployment ID',
    'IPFS gateway returned 500',
    'WebAssembly module truncated',
  ];

  for (const message of caller) {
    it(`422s on "${message}"`, async () => {
      runDisassembly.mockRejectedValue(new Error(message));
      const res = await call({ deploymentId: QM, repoUrl: REPO });
      expect(res.status).toBe(422);
      expect((await res.json()).error).toBe(message);
    });
  }

  it('500s on anything else', async () => {
    runDisassembly.mockRejectedValue(new Error('sandbox provisioning failed'));
    expect((await call({ deploymentId: QM, repoUrl: REPO })).status).toBe(500);
  });

  it('500s with a generic message when a non-Error is thrown', async () => {
    runDisassembly.mockRejectedValue('a string, for some reason');
    const res = await call({ deploymentId: QM, repoUrl: REPO });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Verification failed');
  });
});
