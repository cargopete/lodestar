import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetBounty = vi.fn();
vi.mock('@/lib/studio/db', () => ({
  getBounty: (...a: unknown[]) => mockGetBounty(...a),
}));

const mockHasDbAccess = vi.fn(() => true);
vi.mock('@/lib/db', () => ({
  hasDbAccess: () => mockHasDbAccess(),
  db: {},
}));

const mockReadContract = vi.fn();
vi.mock('@/lib/reo-contract', () => ({
  arbitrumClient: { readContract: (...a: unknown[]) => mockReadContract(...a) },
}));

vi.mock('@/lib/bountyBoard', () => ({ BOUNTY_BOARD_ABI: [] }));

const mockSubgraphQuery = vi.fn();
vi.mock('@/lib/subgraph', () => ({
  subgraphQuery: (...a: unknown[]) => mockSubgraphQuery(...a),
}));

vi.mock('@/lib/cache', () => ({
  cached: vi.fn((_k: string, _t: number, f: () => Promise<unknown>) => f()),
}));

vi.mock('@/lib/studio/ipfs', () => ({
  ipfsHashToBytes32: vi.fn(() => '0xdeploymenthex'),
}));

const mockHasTapSigner = vi.fn(() => false);
const mockSignTapReceipt = vi.fn(async () => 'receipt-blob');
vi.mock('@/lib/tap', () => ({
  hasTapSigner: () => mockHasTapSigner(),
  signTapReceipt: (...a: unknown[]) => (mockSignTapReceipt as (...x: unknown[]) => unknown)(...a),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const BOARD = '0x1111111111111111111111111111111111111111';

function makeRequest(body: unknown = { query: '{ _meta { block { number } } }' }): NextRequest {
  return new NextRequest(new URL('/api/bounty-query/1', 'http://localhost:3000'), {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

// Loads a fresh route module with the given env (BountyBoard + optional gateway/free-query keys).
async function loadRoute(env: Record<string, string | undefined> = {}) {
  vi.resetModules();
  process.env.NEXT_PUBLIC_BOUNTY_BOARD_ADDRESS = env.NEXT_PUBLIC_BOUNTY_BOARD_ADDRESS ?? BOARD;
  if ('GRAPH_API_KEY' in env) {
    if (env.GRAPH_API_KEY === undefined) delete process.env.GRAPH_API_KEY;
    else process.env.GRAPH_API_KEY = env.GRAPH_API_KEY;
  } else {
    delete process.env.GRAPH_API_KEY;
  }
  if ('GRAPH_NODE_FREE_QUERY_KEY' in env) {
    if (env.GRAPH_NODE_FREE_QUERY_KEY === undefined) delete process.env.GRAPH_NODE_FREE_QUERY_KEY;
    else process.env.GRAPH_NODE_FREE_QUERY_KEY = env.GRAPH_NODE_FREE_QUERY_KEY;
  } else {
    delete process.env.GRAPH_NODE_FREE_QUERY_KEY;
  }
  const mod = await import('@/app/api/bounty-query/[id]/route');
  return mod.POST as (req: NextRequest, c: ReturnType<typeof ctx>) => Promise<Response>;
}

const CLAIMED_BOUNTY = {
  id: 1,
  status: 'claimed',
  chain_bounty_id: '42',
  deployment_id: 'QmDeploymentHash',
};

describe('/api/bounty-query/[id]', () => {
  const ORIG = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    mockHasDbAccess.mockReturnValue(true);
    mockHasTapSigner.mockReturnValue(false);
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 200 }));
  });

  afterEach(() => {
    process.env = { ...ORIG };
  });

  it('returns 400 for a non-numeric id', async () => {
    const POST = await loadRoute();
    const res = await POST(makeRequest(), ctx('abc'));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/invalid id/i);
    expect(mockGetBounty).not.toHaveBeenCalled();
  });

  it('returns 503 when DB is unavailable', async () => {
    mockHasDbAccess.mockReturnValue(false);
    const POST = await loadRoute();
    const res = await POST(makeRequest(), ctx('1'));
    expect(res.status).toBe(503);
  });

  it('returns 404 when the bounty does not exist', async () => {
    mockGetBounty.mockResolvedValueOnce(null);
    const POST = await loadRoute();
    const res = await POST(makeRequest(), ctx('99'));
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toMatch(/not found/i);
  });

  it('returns 422 when the bounty is not yet claimed', async () => {
    mockGetBounty.mockResolvedValueOnce({ ...CLAIMED_BOUNTY, status: 'open' });
    const POST = await loadRoute();
    const res = await POST(makeRequest(), ctx('1'));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toMatch(/not yet claimed/i);
  });

  it('returns 422 when a claimed bounty has no on-chain id', async () => {
    mockGetBounty.mockResolvedValueOnce({ ...CLAIMED_BOUNTY, chain_bounty_id: null });
    const POST = await loadRoute();
    const res = await POST(makeRequest(), ctx('1'));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toMatch(/on-chain/i);
  });

  it('returns 503 when the BountyBoard contract is the zero address', async () => {
    mockGetBounty.mockResolvedValueOnce(CLAIMED_BOUNTY);
    const POST = await loadRoute({ NEXT_PUBLIC_BOUNTY_BOARD_ADDRESS: '0x0000000000000000000000000000000000000000' });
    const res = await POST(makeRequest(), ctx('1'));
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toMatch(/not configured/i);
  });

  it('returns 400 for an invalid JSON body (after the claimed-state guards pass)', async () => {
    mockGetBounty.mockResolvedValueOnce(CLAIMED_BOUNTY);
    const POST = await loadRoute();
    const res = await POST(makeRequest('not-json{'), ctx('1'));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/invalid json/i);
  });

  it('proxies via the free graph-node when GRAPH_NODE_FREE_QUERY_KEY is set and node serves it', async () => {
    mockGetBounty.mockResolvedValueOnce(CLAIMED_BOUNTY);
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }));
    const POST = await loadRoute({ GRAPH_NODE_FREE_QUERY_KEY: 'user:pass' });
    const res = await POST(makeRequest(), ctx('1'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.ok).toBe(true);
    // Should have hit the free-query endpoint with Basic auth.
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toContain('/free-query/subgraphs/id/QmDeploymentHash');
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^Basic /);
    // Resolution chain (contract read) should not be needed.
    expect(mockReadContract).not.toHaveBeenCalled();
  });

  it('falls through to direct-indexer routing and proxies the winner URL', async () => {
    mockGetBounty.mockResolvedValueOnce(CLAIMED_BOUNTY);
    // No free-query key configured -> skip that branch.
    mockReadContract.mockResolvedValueOnce({ winner: '0xWINNER000000000000000000000000000000abcd' });
    mockSubgraphQuery.mockResolvedValueOnce({ indexer: { url: 'https://indexer.example' } });
    // upstream indexer responds ok
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: { fromIndexer: true } }), { status: 200 }));

    const POST = await loadRoute();
    const res = await POST(makeRequest(), ctx('1'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.fromIndexer).toBe(true);
    const [url] = mockFetch.mock.calls[0];
    expect(String(url)).toBe('https://indexer.example/subgraphs/id/QmDeploymentHash');
  });

  it('attaches a TAP receipt when a signer is available', async () => {
    mockGetBounty.mockResolvedValueOnce(CLAIMED_BOUNTY);
    mockReadContract.mockResolvedValueOnce({ winner: '0xWINNER000000000000000000000000000000abcd' });
    mockSubgraphQuery.mockResolvedValueOnce({ indexer: { url: 'https://indexer.example/' } });
    mockHasTapSigner.mockReturnValue(true);
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: {} }), { status: 200 }));

    const POST = await loadRoute();
    await POST(makeRequest(), ctx('1'));
    expect(mockSignTapReceipt).toHaveBeenCalledWith('0xwinner000000000000000000000000000000abcd');
    const [, init] = mockFetch.mock.calls[0];
    expect((init.headers as Record<string, string>)['TAP-Receipt']).toBe('receipt-blob');
  });

  it('falls back to the gateway when resolution yields no endpoint', async () => {
    mockGetBounty.mockResolvedValueOnce(CLAIMED_BOUNTY);
    // winner is the zero address => resolveEndpoint returns null.
    mockReadContract.mockResolvedValueOnce({ winner: '0x0000000000000000000000000000000000000000' });
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: { fromGateway: true } }), { status: 200 }));

    const POST = await loadRoute({ GRAPH_API_KEY: 'gw-key' });
    const res = await POST(makeRequest(), ctx('1'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.fromGateway).toBe(true);
    const [url] = mockFetch.mock.calls[0];
    expect(String(url)).toContain('/deployments/id/QmDeploymentHash');
  });

  it('returns 502 when nothing can resolve the endpoint and no gateway key', async () => {
    mockGetBounty.mockResolvedValueOnce(CLAIMED_BOUNTY);
    mockReadContract.mockResolvedValueOnce({ winner: '0x0000000000000000000000000000000000000000' });
    const POST = await loadRoute(); // no GRAPH_API_KEY, no free-query key
    const res = await POST(makeRequest(), ctx('1'));
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toMatch(/could not resolve/i);
  });
});
