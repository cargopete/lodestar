/**
 * Tests for /api/subgraph POST proxy — production block, mock-data routing
 * by query content, real-key fetch path, and error handling.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/logger', () => ({
  log: { api: { error: vi.fn(), info: vi.fn() } },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

async function load() {
  const mod = await import('@/app/api/subgraph/route');
  return mod.POST as (req: NextRequest) => Promise<Response>;
}

function call(POST: Awaited<ReturnType<typeof load>>, body: unknown) {
  return POST(
    new NextRequest('http://localhost/api/subgraph', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  );
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  (process.env as Record<string, string>).NODE_ENV = 'development';
  delete process.env.GRAPH_API_KEY;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('/api/subgraph production block', () => {
  it('403 in production', async () => {
    (process.env as Record<string, string>).NODE_ENV = 'production';
    const POST = await load();
    const res = await call(POST, { query: '{ graphNetwork { id } }' });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toMatch(/disabled/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('/api/subgraph mock-data routing (no API key)', () => {
  it('returns network mock for graphNetwork query', async () => {
    const POST = await load();
    const res = await call(POST, { query: '{ graphNetwork { totalSupply } }' });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.graphNetwork).toBeDefined();
    expect(json.data.graphNetwork.indexerCount).toBe(542);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns epoch mock for epoches query', async () => {
    const POST = await load();
    const res = await call(POST, { query: '{ epoches { id } }' });
    const json = await res.json();
    expect(Array.isArray(json.data.epoches)).toBe(true);
    expect(json.data.epoches.length).toBe(20);
  });

  it('returns indexers mock for indexers query', async () => {
    const POST = await load();
    const res = await call(POST, { query: '{ indexers { id } }' });
    const json = await res.json();
    expect(Array.isArray(json.data.indexers)).toBe(true);
    expect(json.data.indexers.length).toBe(50);
  });

  it('returns delegator portfolio mock', async () => {
    const POST = await load();
    const res = await call(POST, { query: '{ delegator(id: "0x0") { id } }' });
    const json = await res.json();
    expect(json.data.delegator).toBeDefined();
    expect(json.data.delegator.stakesCount).toBe(3);
  });

  it('returns curator portfolio mock', async () => {
    const POST = await load();
    const res = await call(POST, { query: '{ curator(id: "0x0") { id } }' });
    const json = await res.json();
    expect(json.data.curator).toBeDefined();
    expect(json.data.curator.signalCount).toBe(2);
  });

  it('returns dataServices mock', async () => {
    const POST = await load();
    const res = await call(POST, { query: '{ dataServices { id } }' });
    const json = await res.json();
    expect(Array.isArray(json.data.dataServices)).toBe(true);
  });

  it('returns single indexer detail mock for indexer(id:', async () => {
    const POST = await load();
    const res = await call(POST, { query: '{ indexer(id: "0x1") { id allocations { id } } }' });
    const json = await res.json();
    expect(json.data.indexer).toBeDefined();
    expect(json.data.indexer.allocations.length).toBe(3);
  });

  it('falls back to network mock for unrecognised query', async () => {
    const POST = await load();
    const res = await call(POST, { query: '{ somethingElse { id } }' });
    const json = await res.json();
    expect(json.data.graphNetwork).toBeDefined();
  });

  it('sets stale-while-revalidate cache header', async () => {
    const POST = await load();
    const res = await call(POST, { query: '{ graphNetwork { id } }' });
    expect(res.headers.get('Cache-Control')).toMatch(/stale-while-revalidate/);
  });
});

describe('/api/subgraph real-key fetch path', () => {
  it('proxies upstream data when GRAPH_API_KEY set and response ok', async () => {
    process.env.GRAPH_API_KEY = 'test-key';
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { graphNetwork: { real: true } } }), { status: 200 }),
    );
    const POST = await load();
    const res = await call(POST, { query: '{ graphNetwork { id } }' });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.graphNetwork.real).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    // api key interpolated into URL
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('test-key');
  });

  it('falls through to mock data when upstream returns GraphQL errors', async () => {
    process.env.GRAPH_API_KEY = 'test-key';
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ errors: [{ message: 'boom' }] }), { status: 200 }),
    );
    const POST = await load();
    const res = await call(POST, { query: '{ graphNetwork { id } }' });
    expect(res.status).toBe(200);
    const json = await res.json();
    // fell through to network mock
    expect(json.data.graphNetwork.indexerCount).toBe(542);
  });

  it('500 when upstream responds not-ok', async () => {
    process.env.GRAPH_API_KEY = 'test-key';
    mockFetch.mockResolvedValueOnce(new Response('upstream down', { status: 502 }));
    const POST = await load();
    const res = await call(POST, { query: '{ graphNetwork { id } }' });
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toMatch(/Failed to fetch/i);
  });
});

describe('/api/subgraph error handling', () => {
  it('500 on invalid JSON body', async () => {
    const POST = await load();
    const res = await POST(
      new NextRequest('http://localhost/api/subgraph', { method: 'POST', body: 'not-json' }),
    );
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toMatch(/Failed to fetch/i);
  });
});
