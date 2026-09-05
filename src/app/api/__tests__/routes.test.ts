/**
 * API Route Contract Tests
 *
 * These tests verify the response shapes, status codes, and edge cases for
 * every API route. External dependencies (Redis, subgraph, fetch) are mocked
 * so we test our route logic in isolation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------- Mocks ----------

// Mock @/lib/cache — bypass Redis entirely
const mockCacheGet = vi.fn((): Promise<unknown> => Promise.resolve(null));
vi.mock('@/lib/cache', () => ({
  cached: vi.fn((_key: string, _ttl: number, fetcher: () => Promise<unknown>) => fetcher()),
  cacheGet: (...args: unknown[]) => (mockCacheGet as (...a: unknown[]) => unknown)(...args),
  cacheSet: vi.fn(),
  redis: { get: vi.fn(), set: vi.fn() },
}));

// Mock @/lib/subgraph
const mockSubgraphQuery = vi.fn();
const mockEnsQuery = vi.fn();
const mockNuthatchSql = vi.fn();
const mockHasNuthatch = vi.fn(() => false);
vi.mock('@/lib/nuthatch', () => ({
  hasNuthatch: () => mockHasNuthatch(),
  nuthatchEnabled: (flag: string) => mockHasNuthatch() && process.env[flag] === 'true',
  nuthatchSql: (...args: unknown[]) => mockNuthatchSql(...args),
  nuthatchSqlReady: async (...args: unknown[]) => {
    const rows = await mockNuthatchSql(...args);
    return { ok: true, data: { rows, count: Array.isArray(rows) ? rows.length : 0 } };
  },
}));

const mockHasSubgraphAccess = vi.fn(() => true);

const mockResolveEnsName = vi.fn<(a: string) => Promise<string | null>>();
vi.mock('@/lib/ens', () => ({
  resolveEnsName: (a: string) => mockResolveEnsName(a),
  resolveEnsNames: vi.fn(async () => ({})),
}));
vi.mock('@/lib/subgraph', () => ({
  subgraphQuery: (...args: unknown[]) => mockSubgraphQuery(...args),
  ensQuery: (...args: unknown[]) => mockEnsQuery(...args),
  hasSubgraphAccess: () => mockHasSubgraphAccess(),
  delegationEventsQuery: vi.fn(),
}));

// Mock @/lib/reo-contract
vi.mock('@/lib/reo-contract', () => ({
  checkOracleEligibility: vi.fn(() =>
    Promise.resolve({
      address: '0xtest',
      isEligible: true,
      renewalTimestamp: 1700000000,
      eligibilityPeriod: 2592000,
      expiresAt: 1702592000,
      daysRemaining: 30,
    }),
  ),
}));

// Mock @/lib/indexing-status
// A factory mock replaces the whole module, so every export the routes import
// has to appear here or it arrives as undefined and the route throws.
vi.mock('@/lib/indexing-status', () => ({
  queryIndexerStatus: vi.fn(() => Promise.resolve(null)),
  buildIndexerStatus: vi.fn(
    (id: string, name: string | null, url: string, allocated: string) => ({
      indexerId: id,
      indexerName: name,
      url,
      allocatedTokens: allocated,
      status: 'unreachable',
    }),
  ),
  // Reconciliation is peer-relative and has its own unit tests; here it just
  // has to preserve the list so the route's shape assertions stay meaningful.
  reconcileToNetworkHead: vi.fn((indexers: unknown[]) => indexers),
  // RFC-006 D1 serving probe. No network in tests, so report unreachable.
  probeServing: vi.fn(() => Promise.resolve('unreachable')),
  probeServingDetailed: vi.fn(() =>
    Promise.resolve({ probe: 'unreachable', cause: 'guard', error: null, status: null, contentType: null, paid: false, attempts: 0, elapsedMs: 0 }),
  ),
  withServeProbe: vi.fn((result: Record<string, unknown>, probe: string | { probe: string }) => {
    const verdict = typeof probe === 'string' ? probe : probe.probe;
    return {
      ...result,
      serveProbe: verdict,
      ...(typeof probe === 'string' ? {} : { serveProbeDetail: probe }),
      servable: verdict === 'serving' || verdict === 'alive_paid',
    };
  }),
}));

// Mock global fetch for routes that call external APIs directly
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  vi.clearAllMocks();
  mockHasSubgraphAccess.mockReturnValue(true);
  mockCacheGet.mockResolvedValue(null);
  mockFetch.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
});

// ---------- Helpers ----------

function makeRequest(url: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'), init);
}

async function getJson(response: Response) {
  return response.json();
}

// ============================================================
// /api/price
// ============================================================

describe('/api/price', () => {
  let GET: (req?: Request) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('@/app/api/price/route');
    GET = mod.GET;
  });

  it('returns { price, change24h } on success', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ 'the-graph': { usd: 0.15, usd_24h_change: 2.5 } }),
        { status: 200 },
      ),
    );

    const res = await GET();
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json).toHaveProperty('price');
    expect(json).toHaveProperty('change24h');
    expect(typeof json.price).toBe('number');
  });

  it('falls back to DefiLlama when CoinGecko fails', async () => {
    // CoinGecko fails
    mockFetch.mockResolvedValueOnce(new Response('', { status: 429 }));
    // DefiLlama succeeds
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ coins: { 'coingecko:the-graph': { price: 0.14 } } }),
        { status: 200 },
      ),
    );

    const res = await GET();
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json.price).toBe(0.14);
  });

  it('returns null price when both sources fail', async () => {
    mockFetch.mockResolvedValue(new Response('', { status: 500 }));

    const res = await GET();
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json.price).toBeNull();
  });
});

// ============================================================
// /api/tvl
// ============================================================

describe('/api/tvl', () => {
  let GET: () => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('@/app/api/tvl/route');
    GET = mod.GET;
  });

  it('returns { tvl } on success', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ currentChainTvls: { staking: 3_500_000_000 } }),
        { status: 200 },
      ),
    );

    const res = await GET();
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json).toHaveProperty('tvl');
    expect(typeof json.tvl).toBe('number');
  });

  it('returns 500 with error on fetch failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network error'));

    const res = await GET();
    expect(res.status).toBe(500);
    const json = await getJson(res);
    expect(json).toHaveProperty('error');
  });
});

// ============================================================
// /api/network-stats
// ============================================================

describe('/api/network-stats', () => {
  let GET: () => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('@/app/api/network-stats/route');
    GET = mod.GET;
  });

  it('returns { data } with network stats', async () => {
    mockSubgraphQuery.mockResolvedValueOnce({
      graphNetwork: {
        totalTokensStaked: '1000000000000000000000000',
        currentEpoch: 1247,
        delegationRatio: 16,
      },
      _meta: { block: { number: 46000000 } },
    });

    const res = await GET();
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json).toHaveProperty('data');
    expect(json.data).toHaveProperty('graphNetwork');
    expect(json.data).toHaveProperty('_meta');
  });

  it('returns 503 when no API key', async () => {
    mockHasSubgraphAccess.mockReturnValue(false);

    const res = await GET();
    expect(res.status).toBe(503);
  });

  it('returns 500 on subgraph error', async () => {
    mockSubgraphQuery.mockRejectedValueOnce(new Error('subgraph down'));

    const res = await GET();
    expect(res.status).toBe(500);
    const json = await getJson(res);
    expect(json).toHaveProperty('error');
  });
});

// ============================================================
// /api/indexers
// ============================================================

describe('/api/indexers', () => {
  let GET: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('@/app/api/indexers/route');
    GET = mod.GET as (req: NextRequest) => Promise<Response>;
  });

  it('returns { data } with indexers array', async () => {
    mockSubgraphQuery.mockResolvedValueOnce({
      indexers: [
        { id: '0x1', stakedTokens: '1000000000000000000000000', allocationCount: 5 },
      ],
    });

    const req = makeRequest('/api/indexers');
    const res = await GET(req);
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json).toHaveProperty('data');
    expect(json.data).toHaveProperty('indexers');
    expect(Array.isArray(json.data.indexers)).toBe(true);
  });

  it('respects pagination params', async () => {
    mockSubgraphQuery.mockResolvedValueOnce({ indexers: [] });

    const req = makeRequest('/api/indexers?first=10&skip=20');
    await GET(req);

    const query = mockSubgraphQuery.mock.calls[0][0] as string;
    expect(query).toContain('first: 10');
    expect(query).toContain('skip: 20');
  });

  it('caps first at 500', async () => {
    mockSubgraphQuery.mockResolvedValueOnce({ indexers: [] });

    const req = makeRequest('/api/indexers?first=9999');
    await GET(req);

    const query = mockSubgraphQuery.mock.calls[0][0] as string;
    expect(query).toContain('first: 500');
  });

  it('returns 503 when no API key', async () => {
    mockHasSubgraphAccess.mockReturnValue(false);
    const req = makeRequest('/api/indexers');
    const res = await GET(req);
    expect(res.status).toBe(503);
  });
});

// ============================================================
// /api/indexers-enriched
// ============================================================

describe('/api/indexers-enriched', () => {
  let GET: () => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('@/app/api/indexers-enriched/route');
    GET = mod.GET;
  });

  it('returns { indexers, computedAt } when cache has data', async () => {
    const mockData = [
      {
        id: '0x1',
        name: 'Test',
        selfStakeGRT: 1000000,
        delegatorAPR: 5.5,
        score: 85,
        scoreGrade: 'A',
        computedAt: 1700000000,
      },
    ];
    mockCacheGet.mockResolvedValueOnce(mockData);

    const res = await GET();
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json).toHaveProperty('indexers');
    expect(json).toHaveProperty('computedAt');
    expect(Array.isArray(json.indexers)).toBe(true);
  });

  it('returns 503 when cache is empty (cron not yet run)', async () => {
    // mockCacheGet defaults to null from beforeEach
    const res = await GET();
    expect(res.status).toBe(503);
    const json = await getJson(res);
    expect(json).toHaveProperty('error');
  });
});

// ============================================================
// /api/epochs
// ============================================================

describe('/api/epochs', () => {
  let GET: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('@/app/api/epochs/route');
    GET = mod.GET as (req: NextRequest) => Promise<Response>;
  });

  it('returns { data } with epochs array', async () => {
    mockSubgraphQuery.mockResolvedValueOnce({
      epoches: [{ id: '1247', startBlock: 45000000, endBlock: 45006646 }],
    });

    const req = makeRequest('/api/epochs');
    const res = await GET(req);
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json).toHaveProperty('data');
    expect(json.data).toHaveProperty('epoches');
  });

  it('caps count at 400', async () => {
    mockSubgraphQuery.mockResolvedValueOnce({ epoches: [] });
    const req = makeRequest('/api/epochs?count=999');
    await GET(req);

    const query = mockSubgraphQuery.mock.calls[0][0] as string;
    expect(query).toContain('first: 400');
  });

  it('returns 503 when no API key', async () => {
    mockHasSubgraphAccess.mockReturnValue(false);
    const req = makeRequest('/api/epochs');
    const res = await GET(req);
    expect(res.status).toBe(503);
  });
});

// ============================================================
// /api/ens
// ============================================================

describe('/api/ens', () => {
  let GET: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('@/app/api/ens/route');
    GET = mod.GET as (req: NextRequest) => Promise<Response>;
  });

  it('returns { ensName } on success', async () => {
    mockResolveEnsName.mockResolvedValueOnce('vitalik.eth');

    const req = makeRequest('/api/ens?address=0xd8da6bf26964af9d7eed9e03e53415d37aa96045');
    const res = await GET(req);
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json).toHaveProperty('ensName');
    expect(json.ensName).toBe('vitalik.eth');
  });

  it('returns 400 when address missing', async () => {
    const req = makeRequest('/api/ens');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('returns null ensName for invalid address format', async () => {
    const req = makeRequest('/api/ens?address=0x1234');
    const res = await GET(req);
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json.ensName).toBeNull();
  });

  it('returns null ensName when the address has no primary name', async () => {
    mockResolveEnsName.mockResolvedValueOnce(null);

    const req = makeRequest('/api/ens?address=0xd8da6bf26964af9d7eed9e03e53415d37aa96045');
    const res = await GET(req);
    const json = await getJson(res);

    expect(json.ensName).toBeNull();
  });

  it('503s when the ENS lookup errors, rather than reporting no name', async () => {
    // This previously asserted `200 { ensName: null }`, which made "the lookup failed" and
    // "this address has no ENS name" the same answer (#36).
    mockEnsQuery.mockRejectedValueOnce(new Error('subgraph down'));

    const req = makeRequest('/api/ens?address=0xd8da6bf26964af9d7eed9e03e53415d37aa96045');
    const res = await GET(req);
    const json = await getJson(res);

    expect(res.status).toBe(503);
    expect(json.ensName).toBeUndefined();
  });
});

// ============================================================
// /api/manifest
// ============================================================

describe('/api/manifest', () => {
  let GET: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('@/app/api/manifest/route');
    GET = mod.GET as (req: NextRequest) => Promise<Response>;
  });

  it('returns 400 for invalid IPFS hash', async () => {
    const req = makeRequest('/api/manifest?hash=invalid');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when hash missing', async () => {
    const req = makeRequest('/api/manifest');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('returns { data } with manifest analysis on success', async () => {
    const yaml = `specVersion: 0.0.5
dataSources:
  - name: Factory
    kind: ethereum/contract
    network: mainnet
    source:
      address: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f"
      startBlock: 20000000
    mapping:
      kind: ethereum/events
      apiVersion: 0.0.7
      eventHandlers:
        - event: PairCreated
          handler: handlePairCreated`;

    mockFetch.mockResolvedValueOnce(
      new Response(yaml, { status: 200 }),
    );

    const req = makeRequest('/api/manifest?hash=QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG');
    const res = await GET(req);
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json).toHaveProperty('data');
    expect(json.data).toHaveProperty('score');
    expect(json.data).toHaveProperty('category');
    expect(json.data).toHaveProperty('breakdown');
    expect(json.data).toHaveProperty('dataSources');
    expect(json.data).toHaveProperty('specVersion');
  });
});

// ============================================================
// /api/reo
// ============================================================

describe('/api/reo', () => {
  let GET: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('@/app/api/reo/route');
    GET = mod.GET as (req: NextRequest) => Promise<Response>;
  });

  it('returns 400 when address missing', async () => {
    const req = makeRequest('/api/reo');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('returns { status } with REO eligibility data', async () => {
    const req = makeRequest('/api/reo?address=0x1234');
    const res = await GET(req);
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json).toHaveProperty('status');
    expect(json.status).toHaveProperty('address');
    expect(json.status).toHaveProperty('status');
    expect(json.status).toHaveProperty('isEligible');
    expect(json.status).toHaveProperty('source');
  });
});

// ============================================================
// /api/poi
// ============================================================

describe('/api/poi', () => {
  let GET: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('@/app/api/poi/route');
    GET = mod.GET as (req: NextRequest) => Promise<Response>;
  });

  it('returns overview with { data.summary, data.deployments }', async () => {
    const poi = '0x' + 'a'.repeat(64);
    mockSubgraphQuery.mockResolvedValueOnce({
      allocations: [
        {
          id: 'a1',
          poi,
          indexer: { id: '0x1', account: { defaultDisplayName: 'Test', metadata: null } },
          allocatedTokens: '1000000000000000000000000',
          closedAtEpoch: 100,
          closedAt: 1700000000,
          subgraphDeployment: { id: 'd1', ipfsHash: 'Qm1', signalledTokens: '100000000000000000000000', stakedTokens: '100000000000000000000000' },
        },
      ],
    });

    const req = makeRequest('/api/poi');
    const res = await GET(req);
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json).toHaveProperty('data');
    expect(json.data).toHaveProperty('summary');
    expect(json.data).toHaveProperty('deployments');
    expect(json.data.summary).toHaveProperty('totalAllocations');
    expect(json.data.summary).toHaveProperty('deploymentsTracked');
    expect(json.data.summary).toHaveProperty('overallConsensusRate');
    expect(json.data.summary).toHaveProperty('divergentDeployments');
  });

  it('returns deployment detail when ?deployment= specified', async () => {
    const poi = '0x' + 'a'.repeat(64);
    mockSubgraphQuery.mockResolvedValueOnce({
      allocations: [
        {
          id: 'a1',
          poi,
          indexer: { id: '0x1', account: { defaultDisplayName: 'Test', metadata: null } },
          allocatedTokens: '1000000000000000000000000',
          closedAtEpoch: 100,
          closedAt: 1700000000,
          subgraphDeployment: { id: '0xdep1', ipfsHash: 'Qm1', signalledTokens: '100000000000000000000000', stakedTokens: '100000000000000000000000' },
        },
      ],
    });

    const req = makeRequest('/api/poi?deployment=0xdep1');
    const res = await GET(req);
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json).toHaveProperty('data');
    expect(json.data).toHaveProperty('deploymentId');
    expect(json.data).toHaveProperty('epochs');
  });

  it('resolves Qm hash to bytes32 ID', async () => {
    // First call: resolve hash
    mockSubgraphQuery.mockResolvedValueOnce({
      subgraphDeployments: [{ id: '0xbytes32id' }],
    });
    // Second call: get allocations
    const poi = '0x' + 'a'.repeat(64);
    mockSubgraphQuery.mockResolvedValueOnce({
      allocations: [
        {
          id: 'a1',
          poi,
          indexer: { id: '0x1', account: { defaultDisplayName: 'Test', metadata: null } },
          allocatedTokens: '1000000000000000000000000',
          closedAtEpoch: 100,
          closedAt: 1700000000,
          subgraphDeployment: { id: '0xbytes32id', ipfsHash: 'QmTest', signalledTokens: '100000000000000000000000', stakedTokens: '100000000000000000000000' },
        },
      ],
    });

    const req = makeRequest('/api/poi?deployment=QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG');
    const res = await GET(req);
    expect(res.status).toBe(200);
  });

  it('returns 503 when no API key', async () => {
    mockHasSubgraphAccess.mockReturnValue(false);
    const req = makeRequest('/api/poi');
    const res = await GET(req);
    expect(res.status).toBe(503);
  });
});

// ============================================================
// /api/subgraph-deployments
// ============================================================

describe('/api/subgraph-deployments', () => {
  let GET: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('@/app/api/subgraph-deployments/route');
    GET = mod.GET as (req: NextRequest) => Promise<Response>;
  });

  it('returns { data } with deployments array', async () => {
    mockSubgraphQuery.mockResolvedValueOnce({
      subgraphDeployments: [
        { id: 'd1', ipfsHash: 'Qm1', signalledTokens: '100', stakedTokens: '200', queryFeesAmount: '50', indexerAllocations: [], curatorSignals: [] },
      ],
    });

    const req = makeRequest('/api/subgraph-deployments');
    const res = await GET(req);
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json).toHaveProperty('data');
    expect(Array.isArray(json.data)).toBe(true);
  });

  it('validates orderBy against allowlist', async () => {
    mockSubgraphQuery.mockResolvedValueOnce({ subgraphDeployments: [] });

    const req = makeRequest('/api/subgraph-deployments?orderBy=malicious_field');
    await GET(req);

    const query = mockSubgraphQuery.mock.calls[0][0] as string;
    expect(query).toContain('orderBy: signalledTokens'); // Falls back to default
  });

  it('returns 503 when no API key', async () => {
    mockHasSubgraphAccess.mockReturnValue(false);
    const req = makeRequest('/api/subgraph-deployments');
    const res = await GET(req);
    expect(res.status).toBe(503);
  });
});

// ============================================================
// /api/subgraph-search
// ============================================================

describe('/api/subgraph-search', () => {
  let GET: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('@/app/api/subgraph-search/route');
    GET = mod.GET as (req: NextRequest) => Promise<Response>;
  });

  it('returns empty array for short query', async () => {
    const req = makeRequest('/api/subgraph-search?q=a');
    const res = await GET(req);
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json).toHaveProperty('data');
    expect(json.data).toEqual([]);
  });

  it('returns search results for name query', async () => {
    mockSubgraphQuery.mockResolvedValueOnce({
      subgraphs: [
        {
          id: 's1',
          metadata: { displayName: 'Uniswap V3', description: null },
          currentVersion: { subgraphDeployment: { ipfsHash: 'QmTest', signalledTokens: '100', stakedTokens: '200' } },
        },
      ],
    });

    const req = makeRequest('/api/subgraph-search?q=uniswap');
    const res = await GET(req);
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json.data).toHaveLength(1);
    expect(json.data[0]).toHaveProperty('metadata');
    expect(json.data[0]).toHaveProperty('currentVersion');
  });

  it('handles Qm hash search differently', async () => {
    mockSubgraphQuery.mockResolvedValueOnce({
      subgraphDeployments: [
        {
          id: 'd1',
          ipfsHash: 'QmTestHash123',
          signalledTokens: '100',
          stakedTokens: '200',
          versions: [{ subgraph: { id: 's1', metadata: { displayName: 'Test', description: null } } }],
        },
      ],
    });

    const req = makeRequest('/api/subgraph-search?q=QmTestHash');
    const res = await GET(req);
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(Array.isArray(json.data)).toBe(true);
  });

  it('searches by contract address via manifest substring', async () => {
    mockSubgraphQuery.mockResolvedValueOnce({
      subgraphDeploymentManifests: [
        {
          deployment: {
            ipfsHash: 'QmDeployA',
            signalledTokens: '100',
            stakedTokens: '200',
            versions: [{ subgraph: { id: 'sA', metadata: { displayName: 'Pool A', description: null } } }],
          },
        },
      ],
    });

    const req = makeRequest('/api/subgraph-search?q=0x1f98431c8ad98523631ae4a59f267346ea31f984');
    const res = await GET(req);
    const json = await getJson(res);

    // Uses the manifest substring filter, not the name/hash branches
    const query = mockSubgraphQuery.mock.calls[0][0] as string;
    expect(query).toContain('subgraphDeploymentManifests');
    expect(query).toContain('manifest_contains_nocase');

    expect(res.status).toBe(200);
    expect(json.data).toHaveLength(1);
    expect(json.data[0].id).toBe('sA');
    expect(json.data[0].currentVersion.subgraphDeployment.ipfsHash).toBe('QmDeployA');
  });

  it('sorts contract-address results by signal desc and dedupes by deployment', async () => {
    mockSubgraphQuery.mockResolvedValueOnce({
      subgraphDeploymentManifests: [
        { deployment: { ipfsHash: 'QmLow', signalledTokens: '10', stakedTokens: '0', versions: [] } },
        { deployment: { ipfsHash: 'QmHigh', signalledTokens: '9000', stakedTokens: '0', versions: [] } },
        // duplicate of QmLow — should be dropped
        { deployment: { ipfsHash: 'QmLow', signalledTokens: '10', stakedTokens: '0', versions: [] } },
      ],
    });

    const req = makeRequest('/api/subgraph-search?q=0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');
    const res = await GET(req);
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json.data).toHaveLength(2);
    expect(json.data[0].currentVersion.subgraphDeployment.ipfsHash).toBe('QmHigh');
    expect(json.data[1].currentVersion.subgraphDeployment.ipfsHash).toBe('QmLow');
  });

  it('skips manifests with no live deployment', async () => {
    mockSubgraphQuery.mockResolvedValueOnce({
      subgraphDeploymentManifests: [
        { deployment: null },
        { deployment: { ipfsHash: 'QmLive', signalledTokens: '5', stakedTokens: '0', versions: [] } },
      ],
    });

    const req = makeRequest('/api/subgraph-search?q=0x0000000000000000000000000000000000000001');
    const res = await GET(req);
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json.data).toHaveLength(1);
    expect(json.data[0].currentVersion.subgraphDeployment.ipfsHash).toBe('QmLive');
  });

  it('returns 503 when no API key', async () => {
    mockHasSubgraphAccess.mockReturnValue(false);
    const req = makeRequest('/api/subgraph-search?q=uniswap');
    const res = await GET(req);
    expect(res.status).toBe(503);
  });
});

// ============================================================
// /api/subgraph-versions/[hash]
// ============================================================

describe('/api/subgraph-versions/[hash]', () => {
  const VALID_HASH = 'QmNNqSFDNDhWPhscvpsyjAXTbHbpLpzyvhw51SxTx5mtwg';
  let GET: (req: NextRequest, ctx: { params: Promise<{ hash: string }> }) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('@/app/api/subgraph-versions/[hash]/route');
    GET = mod.GET as typeof GET;
  });

  it('rejects an invalid deployment hash with 400', async () => {
    const req = makeRequest('/api/subgraph-versions/not-a-hash');
    const res = await GET(req, { params: Promise.resolve({ hash: 'not-a-hash' }) });
    expect(res.status).toBe(400);
  });

  it('returns 503 when no API key', async () => {
    mockHasSubgraphAccess.mockReturnValue(false);
    const req = makeRequest(`/api/subgraph-versions/${VALID_HASH}`);
    const res = await GET(req, { params: Promise.resolve({ hash: VALID_HASH }) });
    expect(res.status).toBe(503);
  });

  it('maps versions and flags the current deployment', async () => {
    mockSubgraphQuery.mockResolvedValueOnce({
      subgraphDeployments: [
        {
          versions: [
            {
              subgraph: {
                id: 'sg-1',
                versions: [
                  {
                    version: 1,
                    createdAt: 1711047781,
                    metadata: { label: '0.0.3', description: 'd' },
                    subgraphDeployment: { ipfsHash: VALID_HASH, signalledTokens: '100', stakedTokens: '200' },
                  },
                  {
                    version: 0,
                    createdAt: 1701215330,
                    metadata: { label: '0.0.2', description: 'd' },
                    subgraphDeployment: { ipfsHash: 'QmOldDeploymentHashAAAAAAAAAAAAAAAAAAAAAAAAAAA', signalledTokens: '50', stakedTokens: '60' },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    const req = makeRequest(`/api/subgraph-versions/${VALID_HASH}`);
    const res = await GET(req, { params: Promise.resolve({ hash: VALID_HASH }) });
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json.data.subgraphId).toBe('sg-1');
    expect(json.data.versions).toHaveLength(2);
    expect(json.data.versions[0].label).toBe('0.0.3');
    expect(json.data.versions[0].isCurrent).toBe(true);
    expect(json.data.versions[1].isCurrent).toBe(false);
  });

  it('filters out versions with no deployment', async () => {
    mockSubgraphQuery.mockResolvedValueOnce({
      subgraphDeployments: [
        {
          versions: [
            {
              subgraph: {
                id: 'sg-1',
                versions: [
                  { version: 1, createdAt: 1, metadata: { label: 'a', description: null }, subgraphDeployment: { ipfsHash: VALID_HASH, signalledTokens: '1', stakedTokens: '1' } },
                  { version: 0, createdAt: 0, metadata: null, subgraphDeployment: null },
                ],
              },
            },
          ],
        },
      ],
    });

    const req = makeRequest(`/api/subgraph-versions/${VALID_HASH}`);
    const res = await GET(req, { params: Promise.resolve({ hash: VALID_HASH }) });
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json.data.versions).toHaveLength(1);
  });

  it('returns an empty list when the deployment has no parent subgraph', async () => {
    mockSubgraphQuery.mockResolvedValueOnce({ subgraphDeployments: [] });

    const req = makeRequest(`/api/subgraph-versions/${VALID_HASH}`);
    const res = await GET(req, { params: Promise.resolve({ hash: VALID_HASH }) });
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json.data.subgraphId).toBeNull();
    expect(json.data.versions).toEqual([]);
  });
});

// ============================================================
// /api/indexer/[address]
// ============================================================

describe('/api/indexer/[address]', () => {
  let GET: (req: NextRequest, ctx: { params: Promise<{ address: string }> }) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('@/app/api/indexer/[address]/route');
    GET = mod.GET as typeof GET;
  });

  it('returns { data } with indexer detail', async () => {
    mockSubgraphQuery.mockResolvedValueOnce({
      indexer: {
        id: '0x1234',
        stakedTokens: '1000000000000000000000000',
        allocations: [],
        delegators: [],
      },
    });
    // Second call: active allocation pagination loop (returns empty = exits loop)
    mockSubgraphQuery.mockResolvedValueOnce({ allocations: [] });
    // Third call: recent closed allocations
    mockSubgraphQuery.mockResolvedValueOnce({
      allocations: [
        {
          id: '0xalloc1',
          allocatedTokens: '5000000000000000000000',
          createdAtEpoch: 100,
          closedAtEpoch: 120,
          closedAt: 1700000000,
          indexingRewards: '1000000000000000000',
          queryFeesCollected: '0',
          poi: '0xpoi',
          forceClosed: false,
          subgraphDeployment: { id: '0xdep', ipfsHash: 'QmHash', versions: [] },
        },
      ],
    });

    const req = makeRequest('/api/indexer/0x1234000000000000000000000000000000001234');
    const res = await GET(req, { params: Promise.resolve({ address: '0x1234000000000000000000000000000000001234' }) });
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json).toHaveProperty('data');
    expect(json.data).toHaveProperty('indexer');
    expect(json.data.indexer.closedAllocations).toHaveLength(1);
    expect(json.data.indexer.closedAllocations[0].id).toBe('0xalloc1');
  });

  it('queries closed allocations ordered by closedAt desc', async () => {
    mockSubgraphQuery.mockResolvedValueOnce({ indexer: { id: '0x1234', allocations: [], delegators: [] } });
    mockSubgraphQuery.mockResolvedValueOnce({ allocations: [] });
    mockSubgraphQuery.mockResolvedValueOnce({ allocations: [] });

    const req = makeRequest('/api/indexer/0x1234000000000000000000000000000000001234');
    await GET(req, { params: Promise.resolve({ address: '0x1234000000000000000000000000000000001234' }) });

    // Third subgraph call is the closed-allocations query
    const closedQuery = mockSubgraphQuery.mock.calls[2][0] as string;
    expect(closedQuery).toContain('status: Closed');
    expect(closedQuery).toContain('orderBy: closedAt');
    expect(closedQuery).toContain('orderDirection: desc');
  });

  it('lowercases the address', async () => {
    mockSubgraphQuery.mockResolvedValueOnce({ indexer: { id: '0xabc', allocations: [], delegators: [] } });
    mockSubgraphQuery.mockResolvedValueOnce({ allocations: [] });
    mockSubgraphQuery.mockResolvedValueOnce({ allocations: [] });

    const req = makeRequest('/api/indexer/0xABC0000000000000000000000000000000001234');
    await GET(req, { params: Promise.resolve({ address: '0xABC0000000000000000000000000000000001234' }) });

    const query = mockSubgraphQuery.mock.calls[0][0] as string;
    expect(query).toContain('0xabc');
  });

  it('returns 503 when no API key', async () => {
    mockHasSubgraphAccess.mockReturnValue(false);
    const req = makeRequest('/api/indexer/0x1234000000000000000000000000000000001234');
    const res = await GET(req, { params: Promise.resolve({ address: '0x1234000000000000000000000000000000001234' }) });
    expect(res.status).toBe(503);
  });
});

// ============================================================
// /api/indexing-status/[hash]
// ============================================================

describe('/api/indexing-status/[hash]', () => {
  let GET: (req: NextRequest, ctx: { params: Promise<{ hash: string }> }) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('@/app/api/indexing-status/[hash]/route');
    GET = mod.GET as typeof GET;
  });

  it('returns deployment indexing status for bytes32 ID', async () => {
    // When hash doesn't start with Qm/bafy, it's treated as a bytes32 ID — skips resolution
    mockSubgraphQuery.mockResolvedValueOnce({
      allocations: [
        {
          indexer: { id: '0x1', url: null, account: { defaultDisplayName: 'Test', metadata: null } },
          allocatedTokens: '1000000000000000000000000',
        },
      ],
    });

    const req = makeRequest('/api/indexing-status/0xdep1');
    const res = await GET(req, { params: Promise.resolve({ hash: '0xdep1' }) });
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json).toHaveProperty('data');
    expect(json.data).toHaveProperty('deploymentId');
    expect(json.data).toHaveProperty('indexers');
    expect(json.data).toHaveProperty('totalIndexers');
    expect(json.data).toHaveProperty('syncedCount');
  });

  it('resolves Qm hash and returns status', async () => {
    // First call: resolve hash
    mockSubgraphQuery.mockResolvedValueOnce({
      subgraphDeployments: [
        { id: '0xdep1', ipfsHash: 'QmTest', signalledTokens: '100', stakedTokens: '200' },
      ],
    });
    // Second call: allocations
    mockSubgraphQuery.mockResolvedValueOnce({
      allocations: [],
    });

    const req = makeRequest('/api/indexing-status/QmTest');
    const res = await GET(req, { params: Promise.resolve({ hash: 'QmTest' }) });

    expect(res.status).toBe(200);
  });

  it('returns 404 when Qm deployment not found', async () => {
    mockSubgraphQuery.mockResolvedValueOnce({ subgraphDeployments: [] });

    const req = makeRequest('/api/indexing-status/QmNotFound');
    const res = await GET(req, { params: Promise.resolve({ hash: 'QmNotFound' }) });
    // The route throws 'Deployment not found' which is caught and returns 404
    expect(res.status).toBe(404);
  });

  it('returns 503 when no API key', async () => {
    mockHasSubgraphAccess.mockReturnValue(false);
    const req = makeRequest('/api/indexing-status/QmTest');
    const res = await GET(req, { params: Promise.resolve({ hash: 'QmTest' }) });
    expect(res.status).toBe(503);
  });
});

// ============================================================
// /api/delegation-events
// ============================================================

describe('/api/delegation-events', () => {
  let GET: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('@/app/api/delegation-events/route');
    GET = mod.GET as (req: NextRequest) => Promise<Response>;
  });

  // Migrated to Nuthatch in 4.26.0: no Graph fallback, so an unconfigured
  // origin is a visible 503 rather than an empty 200.
  it('fails closed with 503 when Nuthatch is not configured', async () => {
    mockHasNuthatch.mockReturnValue(false);

    const req = makeRequest('/api/delegation-events');
    const res = await GET(req);
    const json = await getJson(res);

    expect(res.status).toBe(503);
    expect(json.error).toMatch(/not configured/i);
  });

  it('returns delegationEvents with nuthatch provenance when the nest answers', async () => {
    mockHasNuthatch.mockReturnValue(true);
    mockNuthatchSql.mockResolvedValue([]);

    const req = makeRequest('/api/delegation-events');
    const res = await GET(req);
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json.data).toHaveProperty('delegationEvents');
    expect(json.data.source).toBe('nuthatch');
  });
});

// ============================================================
// /api/subgraph (proxy with mock fallback)
// ============================================================

describe('/api/subgraph', () => {
  let POST: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('@/app/api/subgraph/route');
    POST = mod.POST as (req: NextRequest) => Promise<Response>;
  });

  it('returns mock network data when no API key', async () => {
    const req = makeRequest('/api/subgraph', {
      method: 'POST',
      body: JSON.stringify({ query: '{ graphNetwork(id: "1") { currentEpoch } }' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req);
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json).toHaveProperty('data');
    expect(json.data).toHaveProperty('graphNetwork');
  });

  it('returns mock indexer data for indexer queries', async () => {
    const req = makeRequest('/api/subgraph', {
      method: 'POST',
      body: JSON.stringify({ query: '{ indexers(first: 10) { id } }' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req);
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json.data).toHaveProperty('indexers');
    expect(Array.isArray(json.data.indexers)).toBe(true);
    expect(json.data.indexers.length).toBeGreaterThan(0);
  });

  it('returns mock epoch data for epoch queries', async () => {
    const req = makeRequest('/api/subgraph', {
      method: 'POST',
      body: JSON.stringify({ query: '{ epoches(first: 10) { id } }' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req);
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json.data).toHaveProperty('epoches');
  });
});

// ============================================================
// Security: input validation across routes
// ============================================================

describe('Security: address validation', () => {
  it('/api/ens rejects GraphQL-injectable address (no format check)', async () => {
    const mod = await import('@/app/api/ens/route');
    const GET = mod.GET as (req: NextRequest) => Promise<Response>;

    // Attempt to inject GraphQL syntax via address param
    const req = makeRequest('/api/ens?address=0x0000%22%7D%7B%20id%20%7D');
    const res = await GET(req);
    const json = await getJson(res);

    // Invalid format — should not reach ENS query; returns null
    expect(res.status).toBe(200);
    expect(json.ensName).toBeNull();
    expect(mockEnsQuery).not.toHaveBeenCalled();
  });

  it('/api/payments rejects non-address receiver', async () => {
    const mod = await import('@/app/api/payments/route');
    const GET = mod.GET as (req: NextRequest) => Promise<Response>;

    const req = makeRequest('/api/payments?receiver=0xnot-an-address');
    const res = await GET(req);

    expect(res.status).toBe(400);
    expect(mockSubgraphQuery).not.toHaveBeenCalled();
  });

  it('/api/portfolio rejects invalid address', async () => {
    const mod = await import('@/app/api/portfolio/route');
    const GET = mod.GET as (req: NextRequest) => Promise<Response>;

    const req = makeRequest('/api/portfolio?address=notanaddress&type=delegator');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('/api/subgraph-search rejects query with GraphQL special chars', async () => {
    const mod = await import('@/app/api/subgraph-search/route');
    const GET = mod.GET as (req: NextRequest) => Promise<Response>;

    const req = makeRequest('/api/subgraph-search?q=uniswap%22%7D%7Badmin');
    const res = await GET(req);
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json.data).toEqual([]); // allowlist blocks special chars
    expect(mockSubgraphQuery).not.toHaveBeenCalled();
  });
});
