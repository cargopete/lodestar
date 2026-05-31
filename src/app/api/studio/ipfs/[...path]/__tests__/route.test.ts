/**
 * Tests for /api/studio/ipfs/[...path] — deploy-key Bearer auth proxy to the
 * IPFS endpoint. Covers DB guard, missing/invalid Bearer key 401, owner lookup
 * via hashed key, path + query-string passthrough, and both GET and POST. Auth
 * (hashKey), DB, findOwnerByKeyHash and ipfsEndpoint are mocked; fetch stubbed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const hashKey = vi.fn((k: string) => `hashed:${k}`);
vi.mock('@/lib/studio/auth', () => ({ hashKey: (...a: unknown[]) => hashKey(...(a as [string])) }));

const hasDbAccess = vi.fn(() => true);
vi.mock('@/lib/db', () => ({ hasDbAccess: () => hasDbAccess() }));

const findOwnerByKeyHash = vi.fn();
vi.mock('@/lib/studio/db', () => ({
  findOwnerByKeyHash: (...a: unknown[]) => findOwnerByKeyHash(...a),
}));

const ipfsEndpoint = vi.fn(() => 'https://ipfs.example/ipfs');
vi.mock('@/lib/studio/ipfs', () => ({ ipfsEndpoint: () => ipfsEndpoint() }));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

async function load() {
  const mod = await import('@/app/api/studio/ipfs/[...path]/route');
  return {
    GET: mod.GET as (r: NextRequest, c: { params: Promise<{ path: string[] }> }) => Promise<Response>,
    POST: mod.POST as (r: NextRequest, c: { params: Promise<{ path: string[] }> }) => Promise<Response>,
  };
}

function ctx(path: string[]) {
  return { params: Promise.resolve({ path }) };
}
function req(opts: { method?: string; auth?: string; search?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.auth !== undefined) headers.authorization = opts.auth;
  return new NextRequest(`http://localhost/api/studio/ipfs/api/v0/add${opts.search ?? ''}`, {
    method: opts.method ?? 'POST',
    headers,
    ...(opts.method && opts.method !== 'GET' ? { body: 'payload' } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  hasDbAccess.mockReturnValue(true);
  findOwnerByKeyHash.mockResolvedValue('0xowner');
  mockFetch.mockImplementation(() =>
    Promise.resolve(new Response('upstream-body', { status: 200, headers: { 'x-up': '1' } })),
  );
});

describe('IPFS proxy auth', () => {
  it('503s when DB unavailable', async () => {
    hasDbAccess.mockReturnValue(false);
    const { POST } = await load();
    expect((await POST(req({ auth: 'Bearer key' }), ctx(['api', 'v0', 'add']))).status).toBe(503);
  });

  it('401s when the Authorization header is missing', async () => {
    const { POST } = await load();
    const res = await POST(req({}), ctx(['api', 'v0', 'add']));
    expect(res.status).toBe(401);
    expect(await res.text()).toContain('Missing');
    expect(findOwnerByKeyHash).not.toHaveBeenCalled();
  });

  it('401s when the header is not a Bearer token', async () => {
    const { POST } = await load();
    const res = await POST(req({ auth: 'Basic abc' }), ctx(['api', 'v0', 'add']));
    expect(res.status).toBe(401);
    expect(findOwnerByKeyHash).not.toHaveBeenCalled();
  });

  it('401s when the deploy key is unknown (no owner)', async () => {
    findOwnerByKeyHash.mockResolvedValue(null);
    const { POST } = await load();
    const res = await POST(req({ auth: 'Bearer badkey' }), ctx(['api', 'v0', 'add']));
    expect(res.status).toBe(401);
    expect(await res.text()).toContain('Invalid');
    expect(hashKey).toHaveBeenCalledWith('badkey');
    expect(findOwnerByKeyHash).toHaveBeenCalledWith('hashed:badkey');
  });
});

describe('IPFS proxy passthrough', () => {
  it('forwards a POST to the joined path and returns the upstream body/status', async () => {
    const { POST } = await load();
    const res = await POST(req({ auth: 'Bearer goodkey' }), ctx(['api', 'v0', 'add']));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('upstream-body');
    const [target, init] = mockFetch.mock.calls[0];
    expect(target).toBe('https://ipfs.example/ipfs/api/v0/add');
    expect(init.method).toBe('POST');
    // authorization header must be stripped before forwarding
    expect((init.headers as Headers).get('authorization')).toBeNull();
  });

  it('preserves the query string when building the target URL', async () => {
    const { POST } = await load();
    await POST(req({ auth: 'Bearer goodkey', search: '?pin=true' }), ctx(['api', 'v0', 'add']));
    expect(mockFetch.mock.calls[0][0]).toBe('https://ipfs.example/ipfs/api/v0/add?pin=true');
  });

  it('handles GET requests (no body forwarded)', async () => {
    const { GET } = await load();
    const res = await GET(req({ method: 'GET', auth: 'Bearer goodkey' }), ctx(['api', 'v0', 'cat']));
    expect(res.status).toBe(200);
    const [target, init] = mockFetch.mock.calls[0];
    expect(target).toBe('https://ipfs.example/ipfs/api/v0/cat');
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
  });

  it('502s when the upstream IPFS fetch throws', async () => {
    mockFetch.mockImplementation(() => Promise.reject(new Error('unreachable')));
    const { POST } = await load();
    const res = await POST(req({ auth: 'Bearer goodkey' }), ctx(['api', 'v0', 'add']));
    expect(res.status).toBe(502);
    expect(await res.text()).toContain('Cannot reach IPFS');
  });
});
