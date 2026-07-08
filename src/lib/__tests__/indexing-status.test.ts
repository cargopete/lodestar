import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  queryIndexerStatus,
  buildIndexerStatus,
  reconcileToNetworkHead,
  type IndexerStatusResult,
} from '@/lib/indexing-status';

// StatusAPIResponse is not exported from the module, so we model the shape the
// public helpers consume. The `buildIndexerStatus` signature accepts this.
type StatusAPIResponse = Parameters<typeof buildIndexerStatus>[4] & object;

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  vi.clearAllMocks();
});

// A complete raw indexingStatuses response builder
function rawStatus(overrides: Record<string, unknown> = {}): NonNullable<StatusAPIResponse> {
  return {
    data: {
      indexingStatuses: [
        {
          subgraph: 'Qm123',
          synced: true,
          health: 'healthy',
          fatalError: null,
          nonFatalErrors: [],
          chains: [
            {
              network: 'mainnet',
              chainHeadBlock: { number: '1000' },
              latestBlock: { number: '1000' },
            },
          ],
          entityCount: '42',
          ...overrides,
        },
      ],
    },
  };
}

describe('queryIndexerStatus', () => {
  it('strips trailing slashes and POSTs to <url>/status', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(rawStatus()), { status: 200 }));
    const res = await queryIndexerStatus('https://idx.example.com///', 'Qm123');
    expect(res?.data?.indexingStatuses?.length).toBe(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://idx.example.com/status');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body).query).toContain('Qm123');
  });

  it('returns null on a non-ok response', async () => {
    mockFetch.mockResolvedValueOnce(new Response('nope', { status: 500 }));
    const res = await queryIndexerStatus('https://idx.example.com', 'Qm123');
    expect(res).toBeNull();
  });

  it('returns null when fetch throws (network error / abort)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('aborted'));
    const res = await queryIndexerStatus('https://idx.example.com', 'Qm123');
    expect(res).toBeNull();
  });

  it('returns null when the body is not valid JSON', async () => {
    mockFetch.mockResolvedValueOnce(new Response('<<not json>>', { status: 200 }));
    const res = await queryIndexerStatus('https://idx.example.com', 'Qm123');
    expect(res).toBeNull();
  });
});

describe('buildIndexerStatus', () => {
  const base = ['0xidx', 'Test Indexer', 'https://idx.example.com', '1000'] as const;

  it('marks an indexer unreachable when raw is null', () => {
    const r = buildIndexerStatus(...base, null);
    expect(r.status).toBe('unreachable');
    expect(r.indexerId).toBe('0xidx');
    expect(r.indexerName).toBe('Test Indexer');
  });

  it('marks unreachable when indexingStatuses is empty', () => {
    const r = buildIndexerStatus(...base, { data: { indexingStatuses: [] } });
    expect(r.status).toBe('unreachable');
  });

  it('reports synced when caught up to chain head', () => {
    const r = buildIndexerStatus(...base, rawStatus());
    expect(r.status).toBe('synced');
    expect(r.blocksBehind).toBe(0);
    expect(r.syncProgress).toBe(100);
    expect(r.chainHeadBlock).toBe(1000);
    expect(r.latestBlock).toBe(1000);
    expect(r.network).toBe('mainnet');
    expect(r.entityCount).toBe('42');
  });

  it('treats <=50 blocks behind as effectively synced', () => {
    const raw = rawStatus({
      chains: [{ network: 'mainnet', chainHeadBlock: { number: 1000 }, latestBlock: { number: 960 } }],
    });
    const r = buildIndexerStatus(...base, raw);
    expect(r.blocksBehind).toBe(40);
    expect(r.status).toBe('synced');
  });

  it('reports syncing when more than 50 blocks behind', () => {
    const raw = rawStatus({
      synced: false,
      chains: [{ network: 'mainnet', chainHeadBlock: { number: 1000 }, latestBlock: { number: 500 } }],
    });
    const r = buildIndexerStatus(...base, raw);
    expect(r.blocksBehind).toBe(500);
    expect(r.status).toBe('syncing');
    expect(r.syncProgress).toBeCloseTo(50, 5);
  });

  it('marks failed when health is failed', () => {
    const raw = rawStatus({ health: 'failed' });
    const r = buildIndexerStatus(...base, raw);
    expect(r.status).toBe('failed');
  });

  it('marks failed and maps fatalError when a fatalError is present', () => {
    const raw = rawStatus({
      health: 'unhealthy',
      fatalError: {
        message: 'handler panic',
        handler: 'handleTransfer',
        block: { number: '777', hash: '0xabc' },
        deterministic: true,
      },
    });
    const r = buildIndexerStatus(...base, raw);
    expect(r.status).toBe('failed');
    expect(r.fatalError?.message).toBe('handler panic');
    expect(r.fatalError?.handler).toBe('handleTransfer');
    expect(r.fatalError?.block).toEqual({ number: 777, hash: '0xabc' });
    expect(r.fatalError?.deterministic).toBe(true);
  });

  it('handles a fatalError without block info', () => {
    const raw = rawStatus({
      fatalError: { message: 'oom', handler: null, block: null, deterministic: false },
    });
    const r = buildIndexerStatus(...base, raw);
    expect(r.fatalError?.block).toBeNull();
  });

  it('caps non-fatal errors to the last 5 and counts them', () => {
    const raw = rawStatus({
      nonFatalErrors: Array.from({ length: 8 }, (_, i) => ({ message: `err${i}` })),
    });
    const r = buildIndexerStatus(...base, raw);
    expect(r.nonFatalErrorCount).toBe(8);
    expect(r.nonFatalErrors).toHaveLength(5);
    expect(r.nonFatalErrors?.[0]).toBe('err3');
    expect(r.nonFatalErrors?.[4]).toBe('err7');
  });

  it('falls back to the synced flag when chain blocks are unavailable', () => {
    const raw = rawStatus({ synced: true, chains: [] });
    const r = buildIndexerStatus(...base, raw);
    expect(r.blocksBehind).toBeUndefined();
    expect(r.syncProgress).toBeUndefined();
    expect(r.status).toBe('synced');
  });

  it('reports syncing when no chain data and synced flag is false', () => {
    const raw = rawStatus({ synced: false, chains: [] });
    const r = buildIndexerStatus(...base, raw);
    expect(r.status).toBe('syncing');
  });
});

// ---------------------------------------------------------------------------
// SSRF guard (isSafeIndexerUrl) — private to the indexer-status route, so we
// exercise it behaviourally: a private/loopback indexer URL must NOT trigger a
// status fetch (deployments fall back to "unreachable"), whereas a public URL
// must trigger the batch /status fetch.
// ---------------------------------------------------------------------------

vi.mock('@/lib/cache', () => ({
  cached: vi.fn((_k: string, _t: number, f: () => Promise<unknown>) => f()),
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn(),
  hasRedis: vi.fn(() => false),
}));

const mockSubgraphQuery = vi.fn();
vi.mock('@/lib/subgraph', () => ({
  subgraphQuery: (...a: unknown[]) => (mockSubgraphQuery as (...x: unknown[]) => unknown)(...a),
  hasSubgraphAccess: vi.fn(() => true),
}));

vi.mock('@/lib/logger', () => ({
  log: { api: { error: vi.fn(), info: vi.fn() } },
}));

const ADDR = '0x' + 'a'.repeat(40);

function allocResult(url: string | null) {
  return {
    indexer: { url },
    allocations: [
      {
        id: 'alloc-1',
        allocatedTokens: '1000',
        createdAtEpoch: 10,
        subgraphDeployment: {
          id: 'dep-1',
          ipfsHash: 'QmDeploy1',
          signalledTokens: '500',
          stakedTokens: '2000',
          versions: [{ subgraph: { metadata: { displayName: 'My Subgraph' } } }],
        },
      },
    ],
  };
}

async function callRoute() {
  const mod = await import('@/app/api/indexer-status/[address]/route');
  const req = {} as unknown as import('next/server').NextRequest;
  const res = await mod.GET(req, { params: Promise.resolve({ address: ADDR }) });
  return res;
}

describe('indexer-status route SSRF guard (isSafeIndexerUrl)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('does not fetch /status for a loopback (127.0.0.1) indexer URL', async () => {
    mockSubgraphQuery.mockResolvedValueOnce(allocResult('http://127.0.0.1:8030'));
    const res = await callRoute();
    const body = await res.json();
    // No status fetch should have fired
    expect(mockFetch).not.toHaveBeenCalled();
    expect(body.data.deployments[0].status).toBe('unreachable');
    expect(body.data.unreachableCount).toBe(1);
  });

  it('does not fetch /status for a private 10.x indexer URL', async () => {
    mockSubgraphQuery.mockResolvedValueOnce(allocResult('http://10.0.0.5:8030'));
    await callRoute();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not fetch /status for localhost or a non-http scheme', async () => {
    mockSubgraphQuery.mockResolvedValueOnce(allocResult('http://localhost:8030'));
    await callRoute();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does fetch /status for a public indexer URL', async () => {
    mockSubgraphQuery.mockResolvedValueOnce(allocResult('https://indexer.public.example.com'));
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            indexingStatuses: [
              {
                subgraph: 'QmDeploy1',
                synced: true,
                health: 'healthy',
                chains: [
                  { network: 'mainnet', chainHeadBlock: { number: '100' }, latestBlock: { number: '100' } },
                ],
                entityCount: '5',
              },
            ],
          },
        }),
        { status: 200 },
      ),
    );
    const res = await callRoute();
    const body = await res.json();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe('https://indexer.public.example.com/status');
    expect(body.data.deployments[0].status).toBe('synced');
    expect(body.data.syncedCount).toBe(1);
  });

  it('returns 400 for an invalid address format', async () => {
    const mod = await import('@/app/api/indexer-status/[address]/route');
    const req = {} as unknown as import('next/server').NextRequest;
    const res = await mod.GET(req, { params: Promise.resolve({ address: 'not-an-address' }) });
    expect(res.status).toBe(400);
  });
});

describe('reconcileToNetworkHead', () => {
  const base = (o: Partial<IndexerStatusResult>): IndexerStatusResult => ({
    indexerId: o.indexerId ?? '0xidx',
    indexerName: null,
    url: 'https://x',
    allocatedTokens: '0',
    status: 'synced',
    ...o,
  });

  it('flags a stalled-firehose indexer that looks self-caught-up as behind', () => {
    // The real exchangev3-wd shape: P2P fresh, InfraDAO firehose stalled at an
    // older head so its self-diff is ~0 and it wrongly reads as caught up.
    const p2p = base({ indexerId: '0xp2p', chainHeadBlock: 108798899, latestBlock: 108798211, blocksBehind: 688, status: 'syncing' });
    const infra = base({ indexerId: '0xinfra', chainHeadBlock: 108668349, latestBlock: 108668349, blocksBehind: 0, status: 'synced' });

    const [rp, ri] = reconcileToNetworkHead([p2p, infra]);

    // P2P defines the head, so it keeps its own self-diff.
    expect(rp.blocksBehind).toBe(688);
    expect(rp.networkChainHead).toBe(108798899);
    // InfraDAO is now measured against P2P's head — the real ~130k gap surfaces.
    expect(ri.blocksBehind).toBe(108798899 - 108668349);
    expect(ri.blocksBehind).toBeGreaterThan(100_000);
    expect(ri.status).toBe('syncing'); // was 'synced' — corrected
  });

  it('the head-defining indexer is never made to look worse than its self-diff', () => {
    const fresh = base({ indexerId: '0xa', chainHeadBlock: 500, latestBlock: 495, blocksBehind: 5, status: 'synced' });
    const [r] = reconcileToNetworkHead([fresh]);
    expect(r.blocksBehind).toBe(5);
    expect(r.status).toBe('synced');
  });

  it('recomputes sync progress against the network head', () => {
    const behind = base({ indexerId: '0xb', chainHeadBlock: 900, latestBlock: 900 });
    const ahead = base({ indexerId: '0xa', chainHeadBlock: 1000, latestBlock: 1000 });
    const [rb] = reconcileToNetworkHead([behind, ahead]);
    expect(rb.syncProgress).toBeCloseTo(90, 5);
  });

  it('preserves failed and unreachable statuses', () => {
    const failed = base({ indexerId: '0xf', chainHeadBlock: 1000, latestBlock: 100, status: 'failed' });
    const unreach = base({ indexerId: '0xu', status: 'unreachable' }); // no chain data
    const [rf, ru] = reconcileToNetworkHead([failed, unreach]);
    expect(rf.status).toBe('failed');
    expect(rf.blocksBehind).toBe(900);
    expect(ru.status).toBe('unreachable');
    expect(ru.blocksBehind).toBeUndefined(); // untouched
  });

  it('is a no-op when no indexer reports any chain data', () => {
    const a = base({ indexerId: '0xa', status: 'unreachable' });
    const out = reconcileToNetworkHead([a]);
    expect(out[0].blocksBehind).toBeUndefined();
    expect(out[0].networkChainHead).toBeUndefined();
  });
});
