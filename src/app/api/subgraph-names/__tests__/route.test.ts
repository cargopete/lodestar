/**
 * Tests for POST /api/subgraph-names — the access guard must 503, not
 * 200 { data: {} }, because empty-and-successful is indistinguishable from
 * "these subgraphs genuinely have no names" (#1097).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const subgraphQuery = vi.fn();
const hasSubgraphAccess = vi.fn(() => true);
vi.mock('@/lib/subgraph', () => ({
  subgraphQuery: (...a: unknown[]) => subgraphQuery(...a),
  hasSubgraphAccess: () => hasSubgraphAccess(),
}));
vi.mock('@/lib/logger', () => ({ log: { api: { error: vi.fn() } } }));

async function load() {
  const mod = await import('@/app/api/subgraph-names/route');
  return mod.POST as (req: NextRequest) => Promise<Response>;
}

function call(POST: Awaited<ReturnType<typeof load>>, hashes: unknown) {
  return POST(
    new NextRequest('http://localhost/api/subgraph-names', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hashes }),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  hasSubgraphAccess.mockReturnValue(true);
});

describe('/api/subgraph-names guards', () => {
  it('503 when no subgraph access', async () => {
    hasSubgraphAccess.mockReturnValue(false);
    const POST = await load();
    const res = await call(POST, ['QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG']);
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toMatch(/No API key/i);
    expect(json.data).toBeUndefined();
    expect(subgraphQuery).not.toHaveBeenCalled();
  });
});

describe('/api/subgraph-names lookup', () => {
  it('maps ipfs hashes to display names', async () => {
    subgraphQuery.mockResolvedValueOnce({
      subgraphDeployments: [
        {
          ipfsHash: 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG',
          versions: [{ subgraph: { metadata: { displayName: 'Demo' } } }],
        },
      ],
    });
    const POST = await load();
    const res = await call(POST, ['QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG']);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual({
      QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG: 'Demo',
    });
  });

  it('200 empty map when no usable hashes', async () => {
    const POST = await load();
    const res = await call(POST, ['not-a-cid']);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: {} });
    expect(subgraphQuery).not.toHaveBeenCalled();
  });
});
