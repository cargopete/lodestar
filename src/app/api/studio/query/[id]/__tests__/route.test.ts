/**
 * Tests for /api/studio/query/[id] — session-auth + subgraph-ownership gate,
 * then a gateway proxy using the server GRAPH_API_KEY. Covers unauth 401,
 * not-owner 403, not-found 404, no-deployment 422, bad-id 400, invalid JSON,
 * and the happy gateway-proxy path. Auth, DB and getSubgraphById are mocked at
 * the boundary; fetch is stubbed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const requireAuth = vi.fn();
vi.mock('@/lib/studio/auth', () => ({ requireAuth: (...a: unknown[]) => requireAuth(...a) }));

const hasDbAccess = vi.fn(() => true);
vi.mock('@/lib/db', () => ({ hasDbAccess: () => hasDbAccess() }));

const getSubgraphById = vi.fn();
vi.mock('@/lib/studio/db', () => ({ getSubgraphById: (...a: unknown[]) => getSubgraphById(...a) }));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const ADDR = '0xOwner';

async function load() {
  const mod = await import('@/app/api/studio/query/[id]/route');
  return mod.POST as (r: NextRequest, c: { params: Promise<{ id: string }> }) => Promise<Response>;
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}
function post(body: unknown) {
  return new NextRequest('http://localhost/api/studio/query/1', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  process.env.GRAPH_API_KEY = 'test-gateway-key';
  requireAuth.mockReturnValue({ address: ADDR });
  hasDbAccess.mockReturnValue(true);
  // ownership compares against auth.address.toLowerCase()
  getSubgraphById.mockResolvedValue({ owner_address: ADDR.toLowerCase(), deployment_id: 'QmDep' });
  mockFetch.mockImplementation(() =>
    Promise.resolve(new Response(JSON.stringify({ data: { ok: true } }), { status: 200 })),
  );
});

describe('POST /api/studio/query/[id]', () => {
  it('returns the auth NextResponse (401) when unauthenticated', async () => {
    requireAuth.mockReturnValue(NextResponse.json({ error: 'Unauthorised' }, { status: 401 }));
    const POST = await load();
    const res = await POST(post({ query: '{x}' }), ctx('1'));
    expect(res.status).toBe(401);
    expect(getSubgraphById).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('503s when DB unavailable', async () => {
    hasDbAccess.mockReturnValue(false);
    const POST = await load();
    expect((await POST(post({ query: '{x}' }), ctx('1'))).status).toBe(503);
  });

  it('503s when gateway key not configured', async () => {
    delete process.env.GRAPH_API_KEY;
    const POST = await load();
    const res = await POST(post({ query: '{x}' }), ctx('1'));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain('Gateway');
  });

  it('400s on a non-numeric id', async () => {
    const POST = await load();
    const res = await POST(post({ query: '{x}' }), ctx('abc'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid id');
  });

  it('404s when the subgraph does not exist', async () => {
    getSubgraphById.mockResolvedValue(null);
    const POST = await load();
    const res = await POST(post({ query: '{x}' }), ctx('1'));
    expect(res.status).toBe(404);
  });

  it('403s when the caller is not the owner', async () => {
    getSubgraphById.mockResolvedValue({ owner_address: '0xsomeoneelse', deployment_id: 'QmDep' });
    const POST = await load();
    const res = await POST(post({ query: '{x}' }), ctx('1'));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain('Not your');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('422s when the subgraph has no deployment yet', async () => {
    getSubgraphById.mockResolvedValue({ owner_address: ADDR.toLowerCase(), deployment_id: null });
    const POST = await load();
    const res = await POST(post({ query: '{x}' }), ctx('1'));
    expect(res.status).toBe(422);
  });

  it('400s on invalid JSON body', async () => {
    const POST = await load();
    const res = await POST(post('{bad'), ctx('1'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid JSON body');
  });

  it('proxies to the gateway deployment URL and returns upstream data (happy path)', async () => {
    const POST = await load();
    const res = await POST(post({ query: '{x}', variables: { a: 1 } }), ctx('42'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { ok: true } });
    expect(getSubgraphById).toHaveBeenCalledWith(42);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain('/deployments/id/QmDep');
    expect(url).toContain('test-gateway-key');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ query: '{x}', variables: { a: 1 } });
  });

  it('forwards a non-ok upstream status', async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ errors: [] }), { status: 500 })),
    );
    const POST = await load();
    const res = await POST(post({ query: '{x}' }), ctx('1'));
    expect(res.status).toBe(500);
  });

  it('502s when the gateway fetch throws', async () => {
    mockFetch.mockImplementation(() => Promise.reject(new Error('boom')));
    const POST = await load();
    const res = await POST(post({ query: '{x}' }), ctx('1'));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain('boom');
  });
});
