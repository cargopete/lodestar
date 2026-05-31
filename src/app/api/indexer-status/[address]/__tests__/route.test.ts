/**
 * Tests for /api/indexer-status/[address] — address validation, allocation
 * fetch + status merge, and SSRF-gated status query. Mocks isolated to file.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const subgraphQuery = vi.fn();
const hasSubgraphAccess = vi.fn(() => true);
vi.mock('@/lib/subgraph', () => ({
  subgraphQuery: (...a: unknown[]) => subgraphQuery(...a),
  hasSubgraphAccess: () => hasSubgraphAccess(),
}));
vi.mock('@/lib/cache', () => ({
  cached: vi.fn((_k: string, _t: number, f: () => unknown) => f()),
}));
vi.mock('@/lib/logger', () => ({ log: { api: { error: vi.fn() } } }));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const VALID = '0x1234000000000000000000000000000000001234';

async function load() {
  const mod = await import('@/app/api/indexer-status/[address]/route');
  return mod.GET as (
    req: NextRequest,
    ctx: { params: Promise<{ address: string }> },
  ) => Promise<Response>;
}

function call(GET: Awaited<ReturnType<typeof load>>, address: string) {
  return GET(new NextRequest('http://localhost/api/indexer-status/x'), {
    params: Promise.resolve({ address }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  hasSubgraphAccess.mockReturnValue(true);
});

describe('/api/indexer-status/[address] guards', () => {
  it('503 when no subgraph access', async () => {
    hasSubgraphAccess.mockReturnValue(false);
    const GET = await load();
    const res = await call(GET, VALID);
    expect(res.status).toBe(503);
  });

  it('400 on malformed address', async () => {
    const GET = await load();
    const res = await call(GET, 'not-an-address');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Invalid address/);
  });

  it('400 on too-short hex address', async () => {
    const GET = await load();
    const res = await call(GET, '0x1234');
    expect(res.status).toBe(400);
  });

  it('accepts and lowercases an uppercase address', async () => {
    subgraphQuery.mockResolvedValueOnce({ indexer: { url: null }, allocations: [] });
    const GET = await load();
    const upper = '0xABCD000000000000000000000000000000001234';
    const res = await call(GET, upper);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.indexerAddress).toBe(upper.toLowerCase());
  });
});

describe('/api/indexer-status/[address] data path', () => {
  it('returns empty shape when indexer has no allocations', async () => {
    subgraphQuery.mockResolvedValueOnce({ indexer: { url: 'https://idx.example.com' }, allocations: [] });
    const GET = await load();
    const res = await call(GET, VALID);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.totalAllocations).toBe(0);
    expect(json.data.deployments).toEqual([]);
    // never queries the node when there are no allocations
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('marks deployment unreachable when status map has no entry', async () => {
    subgraphQuery.mockResolvedValueOnce({
      indexer: { url: 'https://idx.example.com' },
      allocations: [
        {
          id: 'a1',
          allocatedTokens: '100',
          createdAtEpoch: 5,
          subgraphDeployment: {
            id: 'dep1',
            ipfsHash: 'Qm111',
            signalledTokens: '10',
            stakedTokens: '20',
            versions: [{ subgraph: { metadata: { displayName: 'Foo' } } }],
          },
        },
      ],
    });
    // status endpoint returns no matching deployment
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ data: { indexingStatuses: [] } }), { status: 200 }),
    );
    const GET = await load();
    const res = await call(GET, VALID);
    const json = await res.json();
    expect(json.data.totalAllocations).toBe(1);
    expect(json.data.unreachableCount).toBe(1);
    expect(json.data.deployments[0].status).toBe('unreachable');
    expect(json.data.deployments[0].displayName).toBe('Foo');
  });

  it('merges status: synced/syncing/failed classification', async () => {
    subgraphQuery.mockResolvedValueOnce({
      indexer: { url: 'https://idx.example.com' },
      allocations: [
        { id: 'a1', allocatedTokens: '1', createdAtEpoch: 1, subgraphDeployment: { id: 'd1', ipfsHash: 'QmSynced', signalledTokens: '1', stakedTokens: '1', versions: [] } },
        { id: 'a2', allocatedTokens: '1', createdAtEpoch: 1, subgraphDeployment: { id: 'd2', ipfsHash: 'QmSyncing', signalledTokens: '1', stakedTokens: '1', versions: [] } },
        { id: 'a3', allocatedTokens: '1', createdAtEpoch: 1, subgraphDeployment: { id: 'd3', ipfsHash: 'QmFailed', signalledTokens: '1', stakedTokens: '1', versions: [] } },
      ],
    });
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            indexingStatuses: [
              // synced: blocksBehind <= 50
              { subgraph: 'QmSynced', synced: true, health: 'healthy', chains: [{ network: 'mainnet', chainHeadBlock: { number: '1000' }, latestBlock: { number: '1000' } }] },
              // syncing: blocksBehind > 50
              { subgraph: 'QmSyncing', synced: false, health: 'healthy', chains: [{ network: 'mainnet', chainHeadBlock: { number: '1000' }, latestBlock: { number: '500' } }] },
              // failed: fatalError present
              { subgraph: 'QmFailed', synced: false, health: 'failed', fatalError: { message: 'kaboom' }, chains: [] },
            ],
          },
        }),
        { status: 200 },
      ),
    );
    const GET = await load();
    const res = await call(GET, VALID);
    const json = await res.json();
    expect(json.data.totalAllocations).toBe(3);
    expect(json.data.syncedCount).toBe(1);
    expect(json.data.syncingCount).toBe(1);
    expect(json.data.failedCount).toBe(1);
    // sorted: failed first
    expect(json.data.deployments[0].status).toBe('failed');
    expect(json.data.deployments[0].fatalError).toBe('kaboom');
    const syncing = json.data.deployments.find((d: { ipfsHash: string }) => d.ipfsHash === 'QmSyncing');
    expect(syncing.blocksBehind).toBe(500);
    expect(syncing.syncProgress).toBeCloseTo(50);
  });

  it('skips node status query for an unsafe (private) indexer url', async () => {
    subgraphQuery.mockResolvedValueOnce({
      indexer: { url: 'http://127.0.0.1:8030' },
      allocations: [
        { id: 'a1', allocatedTokens: '1', createdAtEpoch: 1, subgraphDeployment: { id: 'd1', ipfsHash: 'Qm1', signalledTokens: '1', stakedTokens: '1', versions: [] } },
      ],
    });
    const GET = await load();
    const res = await call(GET, VALID);
    const json = await res.json();
    expect(mockFetch).not.toHaveBeenCalled();
    // no status data → unreachable
    expect(json.data.deployments[0].status).toBe('unreachable');
  });

  it('500s when the subgraph query throws', async () => {
    subgraphQuery.mockRejectedValueOnce(new Error('subgraph down'));
    const GET = await load();
    const res = await call(GET, VALID);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/Failed/);
  });
});
