/**
 * Contract tests for the Foghorn proxy.
 *
 * The one that matters: an unknown path must come back as the upstream's 404, not as a 502.
 * Foghorn answers unknown routes with a bodyless 404, the proxy parsed the body inside its try
 * block, and the parse error fell into the catch labelled "Foghorn API unreachable". An indexer
 * spent an evening on 2026-08-15 believing our pipeline was down because of it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const ORIGINAL_URL = process.env.FOGHORN_API_URL;

async function loadRoute() {
  vi.resetModules();
  return import('../[...path]/route');
}

function get(path: string[]) {
  return new NextRequest(`http://localhost/api/foghorn/${path.join('/')}`);
}

describe('foghorn proxy', () => {
  beforeEach(() => {
    process.env.FOGHORN_API_URL = 'http://foghorn.internal:8080';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (ORIGINAL_URL === undefined) delete process.env.FOGHORN_API_URL;
    else process.env.FOGHORN_API_URL = ORIGINAL_URL;
  });

  it('passes a bodyless upstream 404 through as a 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    const { GET } = await loadRoute();
    const res = await GET(get(['0xdeadbeef']), { params: Promise.resolve({ path: ['0xdeadbeef'] }) });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toContain('404');
  });

  it('passes a non-JSON upstream error through with its own status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>nginx</html>', { status: 503 })));
    const { GET } = await loadRoute();
    const res = await GET(get(['stats']), { params: Promise.resolve({ path: ['stats'] }) });
    expect(res.status).toBe(503);
  });

  it('still reports 502 when the service genuinely cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const { GET } = await loadRoute();
    const res = await GET(get(['stats']), { params: Promise.resolve({ path: ['stats'] }) });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('Foghorn API unreachable');
  });

  it('forwards a healthy JSON response unchanged', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ total_probes: 7 }), { status: 200, headers: { 'content-type': 'application/json' } }),
      ),
    );
    const { GET } = await loadRoute();
    const res = await GET(get(['stats']), { params: Promise.resolve({ path: ['stats'] }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ total_probes: 7 });
  });

  it('rejects a path segment that would escape the /v1/ prefix', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { GET } = await loadRoute();
    const res = await GET(get(['..', 'admin']), { params: Promise.resolve({ path: ['..', 'admin'] }) });
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns 503 rather than guessing when Foghorn is not configured', async () => {
    delete process.env.FOGHORN_API_URL;
    const { GET } = await loadRoute();
    const res = await GET(get(['stats']), { params: Promise.resolve({ path: ['stats'] }) });
    expect(res.status).toBe(503);
  });
});
