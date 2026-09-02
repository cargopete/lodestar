/**
 * IPFS access, the source-repo hint, and the verify rate limiter.
 *
 * Three small modules that guard real spend or real trust. The IPFS cap exists so a hostile
 * manifest cannot exhaust the function; the rate limiter exists because each verification boots a
 * microVM and runs a full subgraph build, so a missing cap is a bill rather than a bug; and the
 * source hint must degrade to null rather than throw, because a share surface that throws takes a
 * page down over a nicety.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const cacheGet = vi.fn();
const cacheSet = vi.fn();
vi.mock('@/lib/cache', () => ({
  cacheGet: (...a: unknown[]) => cacheGet(...a),
  cacheSet: (...a: unknown[]) => cacheSet(...a),
}));

const subgraphQuery = vi.fn();
const hasSubgraphAccess = vi.fn(() => true);
vi.mock('@/lib/subgraph', () => ({
  subgraphQuery: (...a: unknown[]) => subgraphQuery(...a),
  hasSubgraphAccess: () => hasSubgraphAccess(),
}));

import { IPFS_HASH_RE, ipfsCatText, ipfsCatBytes } from '../ipfs';
import { fetchSourceHint } from '../source-hint';
import { verifyRateLimit } from '../verify-limit';

const HASH = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';
const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  hasSubgraphAccess.mockReturnValue(true);
  cacheGet.mockResolvedValue(null);
  cacheSet.mockResolvedValue(undefined);
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  delete process.env.REDIS_URL;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.REDIS_URL;
});

describe('IPFS_HASH_RE', () => {
  it('accepts a CIDv0 and rejects everything else', () => {
    expect(IPFS_HASH_RE.test(HASH)).toBe(true);
    expect(IPFS_HASH_RE.test('Qmtooshort')).toBe(false);
    expect(IPFS_HASH_RE.test(`${HASH}extra`)).toBe(false);
    expect(IPFS_HASH_RE.test('bafybeigdyrztktx5')).toBe(false); // CIDv1
    expect(IPFS_HASH_RE.test('')).toBe(false);
    // Anchored at both ends: a hash embedded in a path is not a deployment id.
    expect(IPFS_HASH_RE.test(`/ipfs/${HASH}`)).toBe(false);
  });
});

describe('ipfsCatText', () => {
  it('fetches from the gateway with the hash as an encoded argument', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => 'specVersion: 0.0.5' });

    await expect(ipfsCatText(HASH)).resolves.toBe('specVersion: 0.0.5');
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      `https://ipfs.network.thegraph.com/api/v0/cat?arg=${HASH}`,
    );
  });

  it('throws with the status and hash when the gateway refuses', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 504, text: async () => '' });
    await expect(ipfsCatText(HASH)).rejects.toThrow(`IPFS gateway returned 504 for ${HASH}`);
  });

  it('passes an abort signal, so a hung gateway cannot wedge the request', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '' });
    await ipfsCatText(HASH);
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});

describe('ipfsCatBytes', () => {
  it('returns the artifact as bytes', async () => {
    const buf = new Uint8Array([0x00, 0x61, 0x73, 0x6d]).buffer;
    fetchMock.mockResolvedValue({ ok: true, status: 200, arrayBuffer: async () => buf });

    const out = await ipfsCatBytes(HASH);
    expect(out).toBeInstanceOf(Uint8Array);
    expect([...out]).toEqual([0x00, 0x61, 0x73, 0x6d]);
  });

  it('refuses an artifact over the size cap', async () => {
    // The cap is the whole point: a hostile manifest must not be able to exhaust the function.
    const huge = { byteLength: 33 * 1024 * 1024 } as ArrayBuffer;
    fetchMock.mockResolvedValue({ ok: true, status: 200, arrayBuffer: async () => huge });

    await expect(ipfsCatBytes(HASH)).rejects.toThrow(/bytes \(>33554432 cap\)/);
  });
});

describe('fetchSourceHint', () => {
  it('returns null without querying when there is no gateway key', async () => {
    hasSubgraphAccess.mockReturnValue(false);
    await expect(fetchSourceHint(HASH)).resolves.toBeNull();
    expect(subgraphQuery).not.toHaveBeenCalled();
  });

  it('returns the repository and website when metadata carries them', async () => {
    subgraphQuery.mockResolvedValue({
      subgraphDeployments: [
        {
          versions: [
            {
              subgraph: {
                metadata: { codeRepository: 'https://github.com/x/y', website: 'https://y.io' },
              },
            },
          ],
        },
      ],
    });

    await expect(fetchSourceHint(HASH)).resolves.toEqual({
      codeRepository: 'https://github.com/x/y',
      website: 'https://y.io',
    });
  });

  it('normalises absent fields to null rather than undefined', async () => {
    subgraphQuery.mockResolvedValue({
      subgraphDeployments: [{ versions: [{ subgraph: { metadata: {} } }] }],
    });
    await expect(fetchSourceHint(HASH)).resolves.toEqual({
      codeRepository: null,
      website: null,
    });
  });

  it.each([
    ['no deployments', { subgraphDeployments: [] }],
    ['no versions', { subgraphDeployments: [{ versions: [] }] }],
    ['no subgraph', { subgraphDeployments: [{ versions: [{ subgraph: null }] }] }],
    ['no metadata', { subgraphDeployments: [{ versions: [{ subgraph: { metadata: null } }] }] }],
    ['nothing at all', {}],
  ])('returns null when the response has %s', async (_label, response) => {
    subgraphQuery.mockResolvedValue(response);
    await expect(fetchSourceHint(HASH)).resolves.toBeNull();
  });

  it('swallows a gateway failure, because this is a nicety on a share surface', async () => {
    subgraphQuery.mockRejectedValue(new Error('gateway down'));
    await expect(fetchSourceHint(HASH)).resolves.toBeNull();
  });
});

describe('verifyRateLimit', () => {
  const NOW = 1_756_000_000_000;

  it('allows the first build and consumes a slot in both counters', async () => {
    process.env.REDIS_URL = 'redis://x';
    const d = await verifyRateLimit('ip-a', NOW);

    expect(d.allowed).toBe(true);
    expect(cacheSet).toHaveBeenCalledTimes(2); // per-IP and global
  });

  it('denies a single IP past its hourly cap', async () => {
    process.env.REDIS_URL = 'redis://x';
    cacheGet.mockImplementation(async (k: string) => (k.includes(':ip:') ? 8 : 0));

    const d = await verifyRateLimit('ip-b', NOW);
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/max 8 source builds per hour per IP/);
    // Denied means denied: no slot is consumed.
    expect(cacheSet).not.toHaveBeenCalled();
  });

  it('denies everyone past the global cap, which is the cost ceiling', async () => {
    process.env.REDIS_URL = 'redis://x';
    cacheGet.mockImplementation(async (k: string) => (k.includes(':global:') ? 60 : 0));

    const d = await verifyRateLimit('ip-c', NOW);
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/global hourly build limit/);
  });

  it('keys the counters by time bucket, so the window rolls', async () => {
    process.env.REDIS_URL = 'redis://x';
    await verifyRateLimit('ip-d', NOW);
    const firstKeys = cacheSet.mock.calls.map((c) => c[0]);

    cacheSet.mockClear();
    await verifyRateLimit('ip-d', NOW + 3600_000);
    const laterKeys = cacheSet.mock.calls.map((c) => c[0]);

    expect(laterKeys[0]).not.toBe(firstKeys[0]);
  });

  it('sets a TTL that outlives the window, so buckets expire on their own', async () => {
    process.env.REDIS_URL = 'redis://x';
    await verifyRateLimit('ip-e', NOW);
    for (const call of cacheSet.mock.calls) expect(call[2]).toBe(3660);
  });

  it('falls back to the per-instance counter when Redis throws', async () => {
    // A missing cache must weaken the cap, never take the endpoint down.
    process.env.REDIS_URL = 'redis://x';
    cacheGet.mockRejectedValue(new Error('redis unreachable'));

    await expect(verifyRateLimit('ip-f', NOW)).resolves.toEqual({ allowed: true });
  });

  it('enforces the per-IP cap in the in-memory fallback too', async () => {
    // No REDIS_URL at all, which is local dev and tests.
    const ip = `ip-mem-${Math.random()}`;
    for (let i = 0; i < 8; i++) {
      expect((await verifyRateLimit(ip, NOW)).allowed).toBe(true);
    }
    const ninth = await verifyRateLimit(ip, NOW);
    expect(ninth.allowed).toBe(false);
    expect(ninth.reason).toMatch(/per IP/);
  });

  it('does not let one IP exhaust another IP\'s allowance', async () => {
    const a = `ip-x-${Math.random()}`;
    const b = `ip-y-${Math.random()}`;
    for (let i = 0; i < 8; i++) await verifyRateLimit(a, NOW);

    expect((await verifyRateLimit(a, NOW)).allowed).toBe(false);
    expect((await verifyRateLimit(b, NOW)).allowed).toBe(true);
  });
});
