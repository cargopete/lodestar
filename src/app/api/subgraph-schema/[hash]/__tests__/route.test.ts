/**
 * Tests for /api/subgraph-schema/[hash] — hash validation, manifest+schema
 * IPFS fetch, schema-hash extraction (and fallback), 404 when absent, errors.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/cache', () => ({
  cached: vi.fn((_k: string, _t: number, f: () => unknown) => f()),
}));
vi.mock('@/lib/logger', () => ({ log: { api: { error: vi.fn() } } }));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const VALID_HASH = 'Qm123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijk';
const SCHEMA_HASH = 'QmABCDEFGHJKLMNPQRSTUVWXYZabcdefghijk123456789';

async function load() {
  const mod = await import('@/app/api/subgraph-schema/[hash]/route');
  return mod.GET as (
    req: NextRequest,
    ctx: { params: Promise<{ hash: string }> },
  ) => Promise<Response>;
}

function call(GET: Awaited<ReturnType<typeof load>>, hash: string) {
  return GET(new NextRequest('http://localhost/api/subgraph-schema/x'), {
    params: Promise.resolve({ hash }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('/api/subgraph-schema validation', () => {
  it('400 on invalid hash', async () => {
    const GET = await load();
    const res = await call(GET, 'bogus');
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/Invalid deployment hash/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('/api/subgraph-schema happy path', () => {
  it('extracts schema hash via /ipfs/ pattern and returns schema text', async () => {
    const manifest = `specVersion: 0.0.4
schema:
  file:
    /: /ipfs/${SCHEMA_HASH}
dataSources:
  - kind: ethereum`;
    mockFetch
      .mockImplementationOnce(() => Promise.resolve(new Response(manifest, { status: 200 })))
      .mockImplementationOnce(() =>
        Promise.resolve(new Response('type Entity @entity { id: ID! }', { status: 200 })),
      );
    const GET = await load();
    const res = await call(GET, VALID_HASH);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.schemaHash).toBe(SCHEMA_HASH);
    expect(json.data.schemaText).toContain('type Entity');
    expect(mockFetch).toHaveBeenCalledTimes(2);
    // second fetch targets the schema hash
    expect(mockFetch.mock.calls[1][0]).toContain(SCHEMA_HASH);
  });

  it('falls back to bare QmHASH before dataSources when no /ipfs/ marker', async () => {
    const manifest = `schema:
  file: ${SCHEMA_HASH}
dataSources:
  - kind: ethereum`;
    mockFetch
      .mockImplementationOnce(() => Promise.resolve(new Response(manifest, { status: 200 })))
      .mockImplementationOnce(() =>
        Promise.resolve(new Response('type Foo @entity { id: ID! }', { status: 200 })),
      );
    const GET = await load();
    const res = await call(GET, VALID_HASH);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.schemaHash).toBe(SCHEMA_HASH);
  });
});

describe('/api/subgraph-schema not-found and errors', () => {
  it('404 when manifest has no schema hash', async () => {
    const manifest = 'specVersion: 0.0.4\ndataSources:\n  - kind: ethereum';
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve(new Response(manifest, { status: 200 })),
    );
    const GET = await load();
    const res = await call(GET, VALID_HASH);
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toMatch(/Schema not found/i);
  });

  it('500 when IPFS gateway returns non-ok', async () => {
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve(new Response('nope', { status: 504 })),
    );
    const GET = await load();
    const res = await call(GET, VALID_HASH);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toMatch(/Failed to fetch schema/i);
  });

  it('500 when fetch rejects', async () => {
    mockFetch.mockImplementationOnce(() => Promise.reject(new Error('network')));
    const GET = await load();
    const res = await call(GET, VALID_HASH);
    expect(res.status).toBe(500);
  });
});
