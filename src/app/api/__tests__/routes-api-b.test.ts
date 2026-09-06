/**
 * API route tests (assignment api-routes-b)
 *
 *  - /api/cron/refresh-chain-health  — Bearer auth + chain-lag aggregation
 *  - /api/cron/tap-provision         — Bearer auth + main provisioning path
 *  - /api/indexer-node-health        — isSafeUrl SSRF guard + happy path
 *  - /api/indexer-status/[address]   — address validation + subgraph/status merge
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockCacheGet = vi.fn().mockResolvedValue(null);
const mockCacheSet = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/cache', () => ({
  cached: vi.fn((_key: string, _ttl: number, fetcher: () => Promise<unknown>) => fetcher()),
  cacheGet: (...args: unknown[]) => mockCacheGet(...args),
  cacheSet: (...args: unknown[]) => mockCacheSet(...args),
  hasRedis: vi.fn(() => false),
}));

const mockNuthatchSql = vi.fn();
const mockHasNuthatch = vi.fn(() => true);
vi.mock('@/lib/nuthatch', () => ({
  hasNuthatch: () => mockHasNuthatch(),
  nuthatchSql: (...a: unknown[]) => mockNuthatchSql(...a),
  nuthatchSqlReady: async (...a: unknown[]) => {
    const rows = await mockNuthatchSql(...a);
    return { ok: true, data: { rows, count: rows.length } };
  },
}));
/** Feed indexer-status's two nest queries from a gateway-shaped fixture (nuthatch#1160). */
function indexerStatusNest(gw: {
  indexer: { url: string | null } | null;
  allocations: Array<{ id: string; allocatedTokens: string; createdAtEpoch: number; subgraphDeployment: { id: string; ipfsHash: string; signalledTokens: string; stakedTokens: string; versions?: unknown } }>;
}) {
  mockNuthatchSql.mockImplementation(async (sql: string) => {
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
const mockSubgraphQuery = vi.fn();
const mockHasSubgraphAccess = vi.fn(() => true);
vi.mock('@/lib/subgraph', () => ({
  subgraphQuery: (...args: unknown[]) => mockSubgraphQuery(...args),
  hasSubgraphAccess: () => mockHasSubgraphAccess(),
}));

const mockDb = vi.fn();
const mockHasDbAccess = vi.fn(() => true);
vi.mock('@/lib/db', () => ({
  get db() { return mockHasDbAccess() ? ((...a: unknown[]) => mockDb(...a)) : null; },
  hasDbAccess: () => mockHasDbAccess(),
}));

// tap.ts is mocked for the tap-provision route (its real internals hit-chain).
const mockHasTapSigner = vi.fn(() => true);
const mockGetEscrowBalance = vi.fn();
const mockEnsureEscrow = vi.fn();
vi.mock('@/lib/tap', () => ({
  hasTapSigner: () => mockHasTapSigner(),
  getEscrowBalance: (...a: unknown[]) => mockGetEscrowBalance(...a),
  ensureEscrow: (...a: unknown[]) => mockEnsureEscrow(...a),
  MIN_ESCROW_WEI: 1_000_000_000_000_000_000n,
}));

const mockReadContract = vi.fn();
vi.mock('@/lib/reo-contract', () => ({
  arbitrumClient: { readContract: (...a: unknown[]) => mockReadContract(...a) },
}));

vi.mock('@/lib/bountyBoard', () => ({
  BOUNTY_BOARD_ABI: [],
}));

vi.mock('@/lib/studio/ipfs', () => ({
  ipfsHashToBytes32: vi.fn((h: string) => `0x${'a'.repeat(64)}` as `0x${string}`),
}));

vi.mock('@/lib/logger', () => ({
  log: {
    api: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    cron: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const CRON_SECRET = 'test-cron-secret';

beforeEach(() => {
  vi.clearAllMocks();
  mockCacheGet.mockResolvedValue(null);
  mockCacheSet.mockResolvedValue(undefined);
  mockHasSubgraphAccess.mockReturnValue(true);
  mockHasNuthatch.mockReturnValue(true);
  mockHasDbAccess.mockReturnValue(true);
  mockHasTapSigner.mockReturnValue(true);
  mockDb.mockResolvedValue([]);
  process.env.CRON_SECRET = CRON_SECRET;
  process.env.NEXT_PUBLIC_BOUNTY_BOARD_ADDRESS = '0xBb00000000000000000000000000000000000001';
});

function cronRequest(url: string, secret?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (secret !== undefined) headers['authorization'] = `Bearer ${secret}`;
  return new NextRequest(new URL(url, 'http://localhost:3000'), { headers });
}

function plainRequest(url: string): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'));
}

function statusResponse(indexingStatuses: unknown[]): Response {
  return new Response(JSON.stringify({ data: { indexingStatuses } }), { status: 200 });
}

// ============================================================
// /api/cron/refresh-chain-health
// ============================================================

describe('/api/cron/refresh-chain-health', () => {
  let GET: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('@/app/api/cron/refresh-chain-health/route');
    GET = mod.GET as typeof GET;
  });

  it('returns 401 without a bearer token', async () => {
    const res = await GET(plainRequest('/api/cron/refresh-chain-health'));
    expect(res.status).toBe(401);
  });

  it('returns 401 with a wrong bearer token', async () => {
    const res = await GET(cronRequest('/api/cron/refresh-chain-health', 'wrong'));
    expect(res.status).toBe(401);
  });

  it('returns 401 when CRON_SECRET is not configured (fail-closed)', async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(cronRequest('/api/cron/refresh-chain-health', 'anything'));
    expect(res.status).toBe(401);
  });

  it('short-circuits with no cached indexers', async () => {
    mockCacheGet.mockResolvedValueOnce(null); // lodestar:indexers-enriched
    const res = await GET(cronRequest('/api/cron/refresh-chain-health', CRON_SECRET));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ ok: true, message: 'No indexers cached' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('skips indexers with unsafe (private) URLs — no fetch issued', async () => {
    // enriched indexers list: one loopback, one private — both must be filtered out
    mockCacheGet.mockImplementation(async (key: string) => {
      if (key === 'lodestar:indexers-enriched') {
        return [
          { id: '0xAAA', url: 'http://127.0.0.1:8030' },
          { id: '0xBBB', url: 'http://10.0.0.5:8030' },
        ];
      }
      return null;
    });

    const res = await GET(cronRequest('/api/cron/refresh-chain-health', CRON_SECRET));
    const json = await res.json();
    expect(res.status).toBe(200);
    // No safe candidates → zero fetches, zero chains
    expect(mockFetch).not.toHaveBeenCalled();
    expect(json.chains).toBe(0);
    expect(json.indexers).toBe(0);
  });

  it('aggregates per-chain lag: median blocks behind + sampled + lagging counts', async () => {
    mockCacheGet.mockImplementation(async (key: string) => {
      if (key === 'lodestar:indexers-enriched') {
        return [
          { id: '0xIndexerOne', url: 'https://node-one.example.com' },
          { id: '0xIndexerTwo', url: 'https://node-two.example.com' },
          { id: '0xIndexerThree', url: 'https://node-three.example.com' },
        ];
      }
      return null; // no prior snapshots
    });

    // Indexer one: mainnet 100 behind, not synced
    // Indexer two: mainnet 300 behind, not synced
    // Indexer three: mainnet synced (0 behind)
    mockFetch
      .mockResolvedValueOnce(statusResponse([
        { synced: false, health: 'healthy', chains: [
          { network: 'mainnet', chainHeadBlock: { number: 1100 }, latestBlock: { number: 1000 } },
        ] },
      ]))
      .mockResolvedValueOnce(statusResponse([
        { synced: false, health: 'healthy', chains: [
          { network: 'mainnet', chainHeadBlock: { number: 1300 }, latestBlock: { number: 1000 } },
        ] },
      ]))
      .mockResolvedValueOnce(statusResponse([
        { synced: true, health: 'healthy', chains: [
          { network: 'mainnet', chainHeadBlock: { number: 1000 }, latestBlock: { number: 1000 } },
        ] },
      ]));

    const res = await GET(cronRequest('/api/cron/refresh-chain-health', CRON_SECRET));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.chains).toBe(1);
    expect(json.indexers).toBe(3);

    // Verify the actual ChainLagData written to cache
    const lagCall = mockCacheSet.mock.calls.find((c) => c[0] === 'lodestar:chain-lag');
    expect(lagCall).toBeTruthy();
    const lagData = lagCall![1] as { chains: Record<string, { medianBlocksBehind: number; sampledIndexers: number; laggingCount: number }> };
    expect(lagData.chains.mainnet.sampledIndexers).toBe(3); // all three sampled mainnet
    expect(lagData.chains.mainnet.laggingCount).toBe(2);    // two lagging
    expect(lagData.chains.mainnet.medianBlocksBehind).toBe(200); // median(100,300)
  });

  it('caps blocksBehind noise above 10,000 (treated as not-lagging)', async () => {
    mockCacheGet.mockImplementation(async (key: string) => {
      if (key === 'lodestar:indexers-enriched') {
        return [{ id: '0xNoisy', url: 'https://noisy.example.com' }];
      }
      return null;
    });
    mockFetch.mockResolvedValueOnce(statusResponse([
      { synced: false, health: 'healthy', chains: [
        { network: 'mainnet', chainHeadBlock: { number: 5_000_000 }, latestBlock: { number: 1000 } },
      ] },
    ]));

    const res = await GET(cronRequest('/api/cron/refresh-chain-health', CRON_SECRET));
    await res.json();

    const lagCall = mockCacheSet.mock.calls.find((c) => c[0] === 'lodestar:chain-lag');
    const lagData = lagCall![1] as { chains: Record<string, { laggingCount: number; sampledIndexers: number }> };
    // sampled but blocksBehind is null (capped) → not counted as lagging
    expect(lagData.chains.mainnet.sampledIndexers).toBe(1);
    expect(lagData.chains.mainnet.laggingCount).toBe(0);
  });

  it('detects dropped chains vs the previous snapshot', async () => {
    mockCacheGet.mockImplementation(async (key: string) => {
      if (key === 'lodestar:indexers-enriched') {
        return [{ id: '0xDropper', url: 'https://dropper.example.com' }];
      }
      if (key === 'lodestar:indexer-chains:0xdropper') {
        return { current: ['mainnet', 'gnosis'], previous: null, capturedAt: 1 };
      }
      return null;
    });
    // Now only serving mainnet → gnosis dropped
    mockFetch.mockResolvedValueOnce(statusResponse([
      { synced: true, health: 'healthy', chains: [
        { network: 'mainnet', chainHeadBlock: { number: 100 }, latestBlock: { number: 100 } },
      ] },
    ]));

    const res = await GET(cronRequest('/api/cron/refresh-chain-health', CRON_SECRET));
    const json = await res.json();
    expect(json.droppedCount).toBe(1);

    const droppedCall = mockCacheSet.mock.calls.find((c) => c[0] === 'lodestar:dropped-chains');
    const dropped = droppedCall![1] as Record<string, string[]>;
    expect(dropped['0xdropper']).toEqual(['gnosis']);
  });

  it('treats an unreachable node (fetch throws) as no deployments — no snapshot write', async () => {
    mockCacheGet.mockImplementation(async (key: string) => {
      if (key === 'lodestar:indexers-enriched') {
        return [{ id: '0xDown', url: 'https://down.example.com' }];
      }
      return null;
    });
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const res = await GET(cronRequest('/api/cron/refresh-chain-health', CRON_SECRET));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.chains).toBe(0);
    // No per-indexer chain snapshot written for the unreachable node
    const snapCall = mockCacheSet.mock.calls.find((c) => String(c[0]).startsWith('lodestar:indexer-chains:'));
    expect(snapCall).toBeUndefined();
  });
});

// ============================================================
// /api/cron/tap-provision
// ============================================================

describe('/api/cron/tap-provision', () => {
  let GET: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('@/app/api/cron/tap-provision/route');
    GET = mod.GET as typeof GET;
  });

  it('returns 401 without a bearer token', async () => {
    const res = await GET(plainRequest('/api/cron/tap-provision'));
    expect(res.status).toBe(401);
  });

  it('returns 401 with a wrong bearer token', async () => {
    const res = await GET(cronRequest('/api/cron/tap-provision', 'nope'));
    expect(res.status).toBe(401);
  });

  it('skips when the TAP signer is not configured', async () => {
    mockHasTapSigner.mockReturnValue(false);
    const res = await GET(cronRequest('/api/cron/tap-provision', CRON_SECRET));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.skipped).toBe(true);
    expect(json.reason).toMatch(/TAP_SIGNER/);
  });

  it('returns 503 when the DB is unavailable', async () => {
    mockHasDbAccess.mockReturnValue(false);
    const res = await GET(cronRequest('/api/cron/tap-provision', CRON_SECRET));
    const json = await res.json();
    expect(res.status).toBe(503);
    expect(json.error).toMatch(/DB/);
  });

  it('returns a note when there are no claimed bounties', async () => {
    mockDb.mockResolvedValueOnce([]); // sync_bounties query
    const res = await GET(cronRequest('/api/cron/tap-provision', CRON_SECRET));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.note).toMatch(/no claimed bounties/);
    expect(json.provisioned).toEqual({});
  });

  it('main path: provisions escrow for the resolved winner', async () => {
    mockDb.mockResolvedValueOnce([
      { chain_bounty_id: '7', deployment_id: 'QmDeploy' },
    ]);
    // resolveIndexers: getBounty returns a non-zero winner
    mockReadContract.mockResolvedValueOnce({ winner: '0xWinneR00000000000000000000000000000Aaaa' });
    // winner has a URL in the subgraph → [winner]
    mockSubgraphQuery.mockResolvedValueOnce({ indexer: { url: 'https://winner.example.com' } });
    // escrow below threshold → deposit
    mockGetEscrowBalance.mockResolvedValueOnce(0n);
    mockEnsureEscrow.mockResolvedValueOnce(undefined);

    const res = await GET(cronRequest('/api/cron/tap-provision', CRON_SECRET));
    const json = await res.json();

    expect(res.status).toBe(200);
    const winner = '0xwinner00000000000000000000000000000aaaa';
    expect(json.provisioned[winner]).toBe('deposited');
    expect(mockEnsureEscrow).toHaveBeenCalledWith(winner);
  });

  it('main path: marks already-funded indexers as sufficient (no deposit)', async () => {
    mockDb.mockResolvedValueOnce([
      { chain_bounty_id: '9', deployment_id: 'QmDeploy' },
    ]);
    mockReadContract.mockResolvedValueOnce({ winner: '0xWinneR00000000000000000000000000000Aaaa' });
    mockSubgraphQuery.mockResolvedValueOnce({ indexer: { url: 'https://winner.example.com' } });
    mockGetEscrowBalance.mockResolvedValueOnce(2_000_000_000_000_000_000n); // 2 GRT >= 1 GRT

    const res = await GET(cronRequest('/api/cron/tap-provision', CRON_SECRET));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.provisioned['0xwinner00000000000000000000000000000aaaa']).toBe('sufficient');
    expect(mockEnsureEscrow).not.toHaveBeenCalled();
  });

  it('captures per-indexer errors instead of failing the whole run', async () => {
    mockDb.mockResolvedValueOnce([
      { chain_bounty_id: '1', deployment_id: 'QmDeploy' },
    ]);
    mockReadContract.mockResolvedValueOnce({ winner: '0xWinneR00000000000000000000000000000Aaaa' });
    mockSubgraphQuery.mockResolvedValueOnce({ indexer: { url: 'https://winner.example.com' } });
    mockGetEscrowBalance.mockRejectedValueOnce(new Error('rpc timeout'));

    const res = await GET(cronRequest('/api/cron/tap-provision', CRON_SECRET));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.provisioned['0xwinner00000000000000000000000000000aaaa']).toMatch(/^error: rpc timeout/);
  });

  it('resolves no indexers when getBounty reverts (empty provisioned)', async () => {
    mockDb.mockResolvedValueOnce([
      { chain_bounty_id: '1', deployment_id: 'QmDeploy' },
    ]);
    mockReadContract.mockRejectedValueOnce(new Error('execution reverted'));

    const res = await GET(cronRequest('/api/cron/tap-provision', CRON_SECRET));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.provisioned).toEqual({});
  });
});

// ============================================================
// /api/indexer-node-health  (isSafeUrl SSRF guard)
// ============================================================

describe('/api/indexer-node-health', () => {
  let GET: (req: NextRequest) => Promise<Response>;
  const ADDR = '0x1234000000000000000000000000000000001234';

  beforeEach(async () => {
    const mod = await import('@/app/api/indexer-node-health/route');
    GET = mod.GET as typeof GET;
  });

  it('returns 400 when url or addr is missing', async () => {
    const res = await GET(plainRequest('/api/indexer-node-health'));
    expect(res.status).toBe(400);
  });

  const unsafe = [
    ['localhost', 'http://localhost:8030'],
    ['loopback 127.x', 'http://127.0.0.1:8030'],
    ['private 10.x', 'http://10.1.2.3:8030'],
    ['private 172.16-31', 'http://172.20.0.1:8030'],
    ['private 192.168.x', 'http://192.168.1.1:8030'],
    ['link-local 169.254 (metadata)', 'http://169.254.169.254/latest/meta-data'],
    ['IPv6 loopback', 'http://[::1]:8030'],
    ['non-http scheme', 'ftp://example.com'],
    ['file scheme', 'file:///etc/passwd'],
  ] as const;

  for (const [label, url] of unsafe) {
    it(`SSRF guard rejects ${label} (no fetch, returns reachable:false)`, async () => {
      const res = await GET(plainRequest(`/api/indexer-node-health?url=${encodeURIComponent(url)}&addr=${ADDR}`));
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.data.reachable).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  }

  it('forwards safe public URLs and summarises node health', async () => {
    mockFetch.mockResolvedValueOnce(statusResponse([
      { synced: true, health: 'healthy', chains: [{ chainHeadBlock: { number: 100 }, latestBlock: { number: 100 } }] },
      { synced: false, health: 'healthy', chains: [{ chainHeadBlock: { number: 1100 }, latestBlock: { number: 1000 } }] },
      { synced: false, health: 'failed', chains: [] },
    ]));

    const res = await GET(plainRequest(`/api/indexer-node-health?url=${encodeURIComponent('https://node.example.com')}&addr=${ADDR}`));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(json.data.reachable).toBe(true);
    expect(json.data.totalDeployments).toBe(3);
    expect(json.data.syncedCount).toBe(1);
    expect(json.data.worstBlocksBehind).toBe(100); // from the lagging (non-failed) deployment
  });

  it('returns reachable:false when the node responds non-2xx', async () => {
    mockFetch.mockResolvedValueOnce(new Response('nope', { status: 502 }));
    const res = await GET(plainRequest(`/api/indexer-node-health?url=${encodeURIComponent('https://node.example.com')}&addr=${ADDR}`));
    const json = await res.json();
    expect(json.data.reachable).toBe(false);
  });
});

// ============================================================
// /api/indexer-status/[address]
// ============================================================

describe('/api/indexer-status/[address]', () => {
  let GET: (req: NextRequest, ctx: { params: Promise<{ address: string }> }) => Promise<Response>;
  const VALID = '0x1234000000000000000000000000000000001234';

  beforeEach(async () => {
    const mod = await import('@/app/api/indexer-status/[address]/route');
    GET = mod.GET as typeof GET;
  });

  it('returns 503 when no nest is configured', async () => {
    mockHasNuthatch.mockReturnValue(false);
    const res = await GET(plainRequest(`/api/indexer-status/${VALID}`), { params: Promise.resolve({ address: VALID }) });
    expect(res.status).toBe(503);
  });

  it('returns 400 for an invalid address format', async () => {
    const res = await GET(plainRequest('/api/indexer-status/0xnothex'), { params: Promise.resolve({ address: '0xnothex' }) });
    expect(res.status).toBe(400);
  });

  it('returns an empty deployment summary when the indexer has no allocations', async () => {
    indexerStatusNest({ indexer: { url: null }, allocations: [] });
    const res = await GET(plainRequest(`/api/indexer-status/${VALID}`), { params: Promise.resolve({ address: VALID }) });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.totalAllocations).toBe(0);
    expect(json.data.deployments).toEqual([]);
  });

  it('marks deployments unreachable when the indexer URL is unsafe (SSRF) — no status fetch', async () => {
    indexerStatusNest({
      indexer: { url: 'http://127.0.0.1:8030' }, // unsafe → status fetch skipped
      allocations: [{
        id: 'alloc1',
        allocatedTokens: '1000',
        createdAtEpoch: 100,
        subgraphDeployment: { id: 'dep1', ipfsHash: 'QmHash1', signalledTokens: '5', stakedTokens: '9', versions: [] },
      }],
    });

    const res = await GET(plainRequest(`/api/indexer-status/${VALID}`), { params: Promise.resolve({ address: VALID }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(json.data.totalAllocations).toBe(1);
    expect(json.data.unreachableCount).toBe(1);
    expect(json.data.deployments[0].status).toBe('unreachable');
  });

  it('merges live status: synced / syncing / failed classification', async () => {
    indexerStatusNest({
      indexer: { url: 'https://node.example.com' },
      allocations: [
        { id: 'a1', allocatedTokens: '1', createdAtEpoch: 1, subgraphDeployment: { id: 'd1', ipfsHash: 'QmSynced', signalledTokens: '0', stakedTokens: '0', versions: [] } },
        { id: 'a2', allocatedTokens: '1', createdAtEpoch: 1, subgraphDeployment: { id: 'd2', ipfsHash: 'QmSyncing', signalledTokens: '0', stakedTokens: '0', versions: [] } },
        { id: 'a3', allocatedTokens: '1', createdAtEpoch: 1, subgraphDeployment: { id: 'd3', ipfsHash: 'QmFailed', signalledTokens: '0', stakedTokens: '0', versions: [] } },
      ],
    });
    // status endpoint responds for all three
    mockFetch.mockResolvedValueOnce(statusResponse([
      { subgraph: 'QmSynced', synced: true, health: 'healthy', chains: [{ network: 'mainnet', chainHeadBlock: { number: 1000 }, latestBlock: { number: 1000 } }] },
      { subgraph: 'QmSyncing', synced: false, health: 'healthy', chains: [{ network: 'mainnet', chainHeadBlock: { number: 5000 }, latestBlock: { number: 1000 } }] },
      { subgraph: 'QmFailed', synced: false, health: 'failed', fatalError: { message: 'boom' }, chains: [] },
    ]));

    const res = await GET(plainRequest(`/api/indexer-status/${VALID}`), { params: Promise.resolve({ address: VALID }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.totalAllocations).toBe(3);
    expect(json.data.syncedCount).toBe(1);
    expect(json.data.syncingCount).toBe(1);
    expect(json.data.failedCount).toBe(1);
    // failed sorts first
    expect(json.data.deployments[0].status).toBe('failed');
    expect(json.data.deployments[0].fatalError).toBe('boom');
  });

  it('returns 500 when the subgraph query throws', async () => {
    mockNuthatchSql.mockRejectedValueOnce(new Error('subgraph down'));
    const res = await GET(plainRequest(`/api/indexer-status/${VALID}`), { params: Promise.resolve({ address: VALID }) });
    expect(res.status).toBe(500);
  });
});

// ============================================================
// /api/cron/tap-provision — bounty-board-not-configured branch
// (kept LAST: needs a fresh module eval with the env var unset, which
//  requires vi.resetModules and would otherwise poison shared imports.)
// ============================================================

describe('/api/cron/tap-provision (bounty board unset)', () => {
  it('skips when NEXT_PUBLIC_BOUNTY_BOARD_ADDRESS is not configured', async () => {
    process.env.CRON_SECRET = CRON_SECRET;
    delete process.env.NEXT_PUBLIC_BOUNTY_BOARD_ADDRESS;
    mockHasTapSigner.mockReturnValue(true);

    vi.resetModules();
    const mod = await import('@/app/api/cron/tap-provision/route');
    const GET = mod.GET as (req: NextRequest) => Promise<Response>;

    const res = await GET(cronRequest('/api/cron/tap-provision', CRON_SECRET));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.skipped).toBe(true);
    expect(json.reason).toMatch(/BOUNTY_BOARD/);
  });
});
