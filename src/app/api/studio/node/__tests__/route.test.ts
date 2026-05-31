/**
 * Tests for /api/studio/node — the graph-node JSON-RPC stub. Covers DB guard,
 * deploy-key Bearer auth (key hash → owner), JSON-RPC validation, method
 * allow-listing, subgraph ownership checks, and the subgraph_create /
 * subgraph_deploy happy paths. All DB + auth boundaries mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const hasDbAccess = vi.fn(() => true);
vi.mock('@/lib/db', () => ({ hasDbAccess: () => hasDbAccess() }));

vi.mock('@/lib/studio/auth', () => ({ hashKey: (k: string) => `hash:${k}` }));

const findOwnerByKeyHash = vi.fn();
const getSubgraphBySlug = vi.fn();
const updateSubgraphDeployment = vi.fn();
vi.mock('@/lib/studio/db', () => ({
  findOwnerByKeyHash: (...a: unknown[]) => findOwnerByKeyHash(...a),
  getSubgraphBySlug: (...a: unknown[]) => getSubgraphBySlug(...a),
  updateSubgraphDeployment: (...a: unknown[]) => updateSubgraphDeployment(...a),
}));

const OWNER = '0xowner';

async function load() {
  const mod = await import('@/app/api/studio/node/route');
  return mod.POST as (req: NextRequest) => Promise<Response>;
}

function post(body: unknown, auth?: string) {
  return new NextRequest('http://localhost/api/studio/node', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(auth ? { authorization: auth } : {}),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  hasDbAccess.mockReturnValue(true);
  findOwnerByKeyHash.mockResolvedValue(OWNER);
  getSubgraphBySlug.mockResolvedValue({ owner_address: OWNER });
  updateSubgraphDeployment.mockResolvedValue(undefined);
});

describe('node route guards & auth', () => {
  it('503s when DB unavailable', async () => {
    hasDbAccess.mockReturnValue(false);
    const POST = await load();
    const res = await POST(post({ jsonrpc: '2.0', method: 'subgraph_create' }, 'Bearer k'));
    expect(res.status).toBe(503);
  });

  it('rejects a missing deploy key (no Bearer)', async () => {
    const POST = await load();
    const res = await POST(post({ jsonrpc: '2.0', method: 'subgraph_create' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatchObject({ code: -32600, message: 'Missing deploy key' });
  });

  it('rejects an invalid deploy key (no matching owner)', async () => {
    findOwnerByKeyHash.mockResolvedValue(null);
    const POST = await load();
    const res = await POST(post({ jsonrpc: '2.0', method: 'subgraph_create', params: { name: 's' } }, 'Bearer bad'));
    expect((await res.json()).error).toMatchObject({ code: -32600, message: 'Invalid deploy key' });
    expect(findOwnerByKeyHash).toHaveBeenCalledWith('hash:bad');
  });

  it('rejects non JSON-RPC bodies', async () => {
    const POST = await load();
    const res = await POST(post({ method: 'subgraph_create' }, 'Bearer k')); // missing jsonrpc
    expect((await res.json()).error).toMatchObject({ code: -32600, message: 'Invalid JSON-RPC request' });
  });

  it('rejects malformed JSON body', async () => {
    const POST = await load();
    const res = await POST(post('{not json', 'Bearer k'));
    expect((await res.json()).error.code).toBe(-32600);
  });

  it('rejects a method not in the allow-list', async () => {
    const POST = await load();
    const res = await POST(post({ jsonrpc: '2.0', method: 'subgraph_remove', params: { name: 's' } }, 'Bearer k'));
    expect((await res.json()).error).toMatchObject({ code: -32601 });
  });

  it('rejects a missing subgraph name', async () => {
    const POST = await load();
    const res = await POST(post({ jsonrpc: '2.0', method: 'subgraph_create', params: {} }, 'Bearer k'));
    expect((await res.json()).error).toMatchObject({ code: -32602, message: 'Missing subgraph name' });
  });

  it('rejects an unregistered subgraph', async () => {
    getSubgraphBySlug.mockResolvedValue(null);
    const POST = await load();
    const res = await POST(post({ jsonrpc: '2.0', method: 'subgraph_create', params: { name: 'ghost' } }, 'Bearer k'));
    expect((await res.json()).error.message).toContain('not registered');
  });

  it("rejects a subgraph owned by someone else", async () => {
    getSubgraphBySlug.mockResolvedValue({ owner_address: '0xsomeoneelse' });
    const POST = await load();
    const res = await POST(post({ jsonrpc: '2.0', method: 'subgraph_create', params: { name: 's' } }, 'Bearer k'));
    expect((await res.json()).error).toMatchObject({ code: -32602, message: 'Not your subgraph' });
  });
});

describe('node route methods', () => {
  it('subgraph_create just acknowledges with null result', async () => {
    const POST = await load();
    const res = await POST(post({ jsonrpc: '2.0', id: 7, method: 'subgraph_create', params: { name: 'mine' } }, 'Bearer k'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ jsonrpc: '2.0', result: null, id: 7 });
    expect(updateSubgraphDeployment).not.toHaveBeenCalled();
  });

  it('subgraph_deploy records the IPFS hash and returns explorer links', async () => {
    const POST = await load();
    const res = await POST(post({
      jsonrpc: '2.0', id: 1, method: 'subgraph_deploy',
      params: { name: 'mine', ipfs_hash: 'QmHash', network: 'mainnet' },
    }, 'Bearer k'));
    const body = await res.json();
    expect(updateSubgraphDeployment).toHaveBeenCalledWith('mine', 'QmHash', 'mainnet');
    expect(body.result.playground).toContain('/mine');
    expect(body.result.errors).toEqual([]);
    expect(body.id).toBe(1);
  });

  it('subgraph_deploy without an ipfs_hash does not write to the DB', async () => {
    const POST = await load();
    const res = await POST(post({
      jsonrpc: '2.0', method: 'subgraph_deploy', params: { name: 'mine' },
    }, 'Bearer k'));
    expect(res.status).toBe(200);
    expect(updateSubgraphDeployment).not.toHaveBeenCalled();
    expect((await res.json()).id).toBe(null);
  });
});
