/**
 * Tests for /api/indexer-node-health — SSRF guard + node-health fetch/parse.
 * Mocks are isolated to this file.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// cached() just runs the producer fn so we exercise the real fetch path.
vi.mock('@/lib/cache', () => ({
  cached: vi.fn((_k: string, _t: number, f: () => unknown) => f()),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

async function load() {
  const mod = await import('@/app/api/indexer-node-health/route');
  return mod.GET as (req: NextRequest) => Promise<Response>;
}

function req(qs: string) {
  return new NextRequest(`http://localhost/api/indexer-node-health${qs}`);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('/api/indexer-node-health validation', () => {
  it('400s when url is missing', async () => {
    const GET = await load();
    const res = await GET(req('?addr=0xabc'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Missing/);
  });

  it('400s when addr is missing', async () => {
    const GET = await load();
    const res = await GET(req('?url=https://idx.example.com'));
    expect(res.status).toBe(400);
  });
});

describe('isSafeUrl SSRF guard (via route behaviour)', () => {
  // Unsafe URLs short-circuit to reachable:false WITHOUT calling fetch.
  const unsafe = [
    'http://localhost/status',
    'http://127.0.0.1:8030',
    'http://10.0.0.5',
    'http://172.16.0.1',
    'http://172.31.255.1',
    'http://192.168.1.10',
    'http://169.254.169.254', // cloud metadata endpoint
    'http://[::1]',
    'ftp://example.com', // non-http protocol
    'not-a-url',
  ];

  for (const u of unsafe) {
    it(`rejects unsafe url ${u} without fetching`, async () => {
      const GET = await load();
      const res = await GET(req(`?addr=0xabc&url=${encodeURIComponent(u)}`));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.reachable).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  }

  // NOTE: documents an actual gap in the guard — WHATWG URL.hostname keeps the
  // brackets on IPv6 literals ("[fc00::1]"), so the /^fc|^fd/ ULA check never
  // matches and these private addresses are treated as SAFE. Asserting current
  // behaviour so a future fix to the guard intentionally flips this test.
  it('FAILS to block bracketed IPv6 ULA literals (known guard gap)', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ data: { indexingStatuses: [] } }), { status: 200 }),
    );
    const GET = await load();
    const res = await GET(req('?addr=0xabc&url=http://[fc00::1]/'));
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalled();
  });

  it('does NOT reject 172.15.x (just outside the private 172.16-31 range)', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ data: { indexingStatuses: [] } }), { status: 200 }),
    );
    const GET = await load();
    const res = await GET(req('?addr=0xabc&url=http://172.15.0.1/'));
    expect(res.status).toBe(200);
    // safe → fetch attempted
    expect(mockFetch).toHaveBeenCalled();
  });
});

describe('fetchNodeHealth happy path', () => {
  it('forwards to <base>/status and parses synced counts', async () => {
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            indexingStatuses: [
              { synced: true, health: 'healthy', chains: [{}] },
              { synced: false, health: 'unhealthy', chains: [{ chainHeadBlock: { number: '1000' }, latestBlock: { number: '900' } }] },
            ],
          },
        }),
        { status: 200 },
      ),
    );
    const GET = await load();
    const res = await GET(req('?addr=0xabc&url=https://idx.example.com/'));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://idx.example.com/status',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(json.data.reachable).toBe(true);
    expect(json.data.totalDeployments).toBe(2);
    expect(json.data.syncedCount).toBe(1);
    expect(json.data.worstBlocksBehind).toBe(100);
  });

  it('caps worstBlocksBehind noise above 10,000 (left undefined)', async () => {
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            indexingStatuses: [
              { synced: false, health: 'unhealthy', chains: [{ chainHeadBlock: { number: '5000000' }, latestBlock: { number: '1' } }] },
            ],
          },
        }),
        { status: 200 },
      ),
    );
    const GET = await load();
    const res = await GET(req('?addr=0xabc&url=https://idx.example.com'));
    const json = await res.json();
    expect(json.data.worstBlocksBehind).toBeUndefined();
    expect(json.data.syncedCount).toBe(0);
  });

  it('returns reachable:false on non-ok HTTP', async () => {
    mockFetch.mockResolvedValue(new Response('nope', { status: 502 }));
    const GET = await load();
    const res = await GET(req('?addr=0xabc&url=https://idx.example.com'));
    const json = await res.json();
    expect(json.data.reachable).toBe(false);
  });

  it('returns reachable:false on network throw', async () => {
    mockFetch.mockRejectedValue(new Error('boom'));
    const GET = await load();
    const res = await GET(req('?addr=0xabc&url=https://idx.example.com'));
    const json = await res.json();
    expect(json.data.reachable).toBe(false);
  });

  it('reachable:true with zero deployments when statuses is empty', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ data: { indexingStatuses: [] } }), { status: 200 }),
    );
    const GET = await load();
    const res = await GET(req('?addr=0xabc&url=https://idx.example.com'));
    const json = await res.json();
    expect(json.data.reachable).toBe(true);
    expect(json.data.totalDeployments).toBe(0);
  });
});
