/**
 * Tests for /api/indexer-status/[address] - address validation, allocation fetch (from the nest,
 * nuthatch#1160) + status merge, and SSRF-gated status query. Mocks isolated to file.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const nuthatchSql = vi.fn();
const hasNuthatch = vi.fn(() => true);
vi.mock('@/lib/nuthatch', () => ({
  hasNuthatch: () => hasNuthatch(),
  nuthatchSqlReady: async (...a: unknown[]) => {
    const rows = await nuthatchSql(...a);
    return { ok: true, data: { rows, count: rows.length } };
  },
}));
/**
 * Feed the route's two nest queries from a gateway-shaped fixture: the indexer's URL from
 * `lodestar_indexers`, the active allocations from `lodestar_allocations`. A deployment's
 * `subgraph_deployment` is handed over as the Qm hash so the route's bytes32 decode falls back to it,
 * which is how the fixture's hash reaches the indexer's /status matching unchanged.
 */
function indexerStatusNest(gw: {
  indexer: { url: string | null } | null;
  allocations: Array<{ id: string; allocatedTokens: string; createdAtEpoch: number; subgraphDeployment: { id: string; ipfsHash: string; signalledTokens: string; stakedTokens: string; versions?: unknown } }>;
}) {
  nuthatchSql.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM lodestar_indexers WHERE id')) return gw.indexer ? [{ url: gw.indexer.url }] : [];
    if (sql.includes('FROM lodestar_allocations')) {
      return gw.allocations.map((a) => ({
        id: a.id, allocated_tokens: a.allocatedTokens, created_at_epoch: a.createdAtEpoch,
        subgraph_deployment: a.subgraphDeployment.ipfsHash, signalled_tokens: a.subgraphDeployment.signalledTokens,
        deployment_staked_tokens: a.subgraphDeployment.stakedTokens,
      }));
    }
    return [];
  });
}

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
  hasNuthatch.mockReturnValue(true);
});

describe('/api/indexer-status/[address] guards', () => {
  it('503 when no nest is configured', async () => {
    hasNuthatch.mockReturnValue(false);
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
    indexerStatusNest({ indexer: { url: null }, allocations: [] });
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
    indexerStatusNest({ indexer: { url: 'https://idx.example.com' }, allocations: [] });
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
    indexerStatusNest({
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
    // The nest path carries no display name on this route (IPFS metadata is group B work).
    expect(json.data.deployments[0].displayName).toBeNull();
  });

  it('merges status: synced/syncing/failed classification', async () => {
    indexerStatusNest({
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
    indexerStatusNest({
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

  it('500s when the nest query throws', async () => {
    nuthatchSql.mockRejectedValueOnce(new Error('nest down'));
    const GET = await load();
    const res = await call(GET, VALID);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/Failed/);
  });
});
