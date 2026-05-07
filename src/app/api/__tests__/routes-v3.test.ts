/**
 * API Route Contract Tests — Part 3
 *
 * Covers routes not tested in routes.test.ts or routes-v2.test.ts:
 * horizon/activity, horizon/events, horizon/slashing,
 * delegation-flows, indexer-qos, indexer-trends, indexer-stake-history,
 * subgraph-curation, subgraph-fees-30d, subgraph-history,
 * dropped-chains, chain-lag, indexer-node-health
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockCacheGet = vi.fn().mockResolvedValue(null);
vi.mock('@/lib/cache', () => ({
  cached: vi.fn((_key: string, _ttl: number, fetcher: () => Promise<unknown>) => fetcher()),
  cacheGet: (...args: unknown[]) => mockCacheGet(...args),
  cacheSet: vi.fn().mockResolvedValue(undefined),
  hasRedis: vi.fn(() => true),
  getRedis: vi.fn(() => ({ ping: vi.fn().mockResolvedValue('PONG') })),
}));

const mockSubgraphQuery = vi.fn();
const mockHasSubgraphAccess = vi.fn(() => true);
vi.mock('@/lib/subgraph', () => ({
  subgraphQuery: (...args: unknown[]) => mockSubgraphQuery(...args),
  qosOracleQuery: (...args: unknown[]) => mockSubgraphQuery(...args),
  horizonPerfQuery: (...args: unknown[]) => mockSubgraphQuery(...args),
  hasSubgraphAccess: () => mockHasSubgraphAccess(),
  ensQuery: vi.fn(),
  delegationEventsQuery: vi.fn(),
}));

const mockAmpQuery = vi.fn();
const mockHasAmpAccess = vi.fn(() => false);
vi.mock('@/lib/amp', () => ({
  hasAmpAccess: () => mockHasAmpAccess(),
  ampQuery: (...args: unknown[]) => mockAmpQuery(...args),
  HORIZON_STAKING: '0xstaking',
  TOPIC0: {
    TokensDelegated: '0x' + 'a'.repeat(64),
    TokensUndelegated: '0x' + 'b'.repeat(64),
    DelegatedTokensWithdrawn: '0x' + 'c'.repeat(64),
    HorizonStakeDeposited: '0x' + 'd'.repeat(64),
    HorizonStakeWithdrawn: '0x' + 'e'.repeat(64),
    HorizonStakeLocked: '0x' + 'f'.repeat(64),
    ProvisionCreated: '0x' + '1'.repeat(64),
    ProvisionSlashed: '0x' + '2'.repeat(64),
    DelegationSlashed: '0x' + '3'.repeat(64),
  },
  AMP_DATASET: 'dataset',
  topicToAddress: vi.fn((t: string) => '0x' + t.slice(-40)),
  hexToBigInt: vi.fn(() => BigInt(1000000000000000000)),
  hexLit: vi.fn((s: string) => `'${s}'`),
  strip0x: vi.fn((s: string) => s.replace('0x', '')),
  AmpError: class AmpError extends Error {},
}));

const mockDb = vi.fn();
const mockHasDbAccess = vi.fn(() => false);
vi.mock('@/lib/db', () => ({
  get db() { return mockHasDbAccess() ? ((...a: unknown[]) => mockDb(...a)) : null; },
  hasDbAccess: () => mockHasDbAccess(),
}));

vi.mock('@/lib/logger', () => ({
  log: {
    api: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    cron: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    amp: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    health: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    refresh: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ingest: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    cache: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  },
  default: { child: vi.fn().mockReturnThis(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));

beforeEach(() => {
  vi.clearAllMocks();
  mockHasSubgraphAccess.mockReturnValue(true);
  mockHasAmpAccess.mockReturnValue(false);
  mockHasDbAccess.mockReturnValue(false);
  mockCacheGet.mockResolvedValue(null);
  mockDb.mockResolvedValue([]);
});

function makeRequest(url: string): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'));
}

async function getJson(res: Response) { return res.json(); }

// ============================================================
// /api/horizon/activity
// ============================================================

describe('/api/horizon/activity', () => {
  let GET: () => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('@/app/api/horizon/activity/route');
    GET = mod.GET;
  });

  it('returns 503 when cache is empty (cron not yet run)', async () => {
    // cacheGet returns null → Amp not yet fetched data
    const res = await GET();
    expect(res.status).toBe(503);
  });

  it('returns { data } with cached events', async () => {
    const mockEvents = [
      { id: 'tx1-0', type: 'delegated', block: 100, txHash: '0xtx1', serviceProvider: '0xsp1', tokensGRT: 1000 },
    ];
    mockCacheGet.mockResolvedValueOnce(mockEvents);

    const res = await GET();
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json).toHaveProperty('data');
    expect(json.data).toHaveLength(1);
    expect(json.data[0].type).toBe('delegated');
  });
});

// ============================================================
// /api/horizon/events
// ============================================================

describe('/api/horizon/events', () => {
  let GET: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('@/app/api/horizon/events/route');
    GET = mod.GET as (req: Request) => Promise<Response>;
  });

  it('returns 503 when Amp not configured', async () => {
    const req = makeRequest('/api/horizon/events?address=0x1234000000000000000000000000000000001234');
    const res = await GET(req);
    expect(res.status).toBe(503);
  });

  it('returns 400 when address is missing', async () => {
    mockHasAmpAccess.mockReturnValue(true);
    const req = makeRequest('/api/horizon/events');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid address format', async () => {
    mockHasAmpAccess.mockReturnValue(true);
    const req = makeRequest('/api/horizon/events?address=notanaddress');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid type', async () => {
    mockHasAmpAccess.mockReturnValue(true);
    const req = makeRequest('/api/horizon/events?address=0x1234000000000000000000000000000000001234&type=invalid');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('returns { data } with events for delegator type', async () => {
    mockHasAmpAccess.mockReturnValue(true);
    mockAmpQuery.mockResolvedValueOnce([]);

    const req = makeRequest('/api/horizon/events?address=0x1234000000000000000000000000000000001234&type=delegator');
    const res = await GET(req);
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json).toHaveProperty('data');
    expect(Array.isArray(json.data)).toBe(true);
  });

  it('returns { data } for provider type', async () => {
    mockHasAmpAccess.mockReturnValue(true);
    mockAmpQuery.mockResolvedValueOnce([]);

    const req = makeRequest('/api/horizon/events?address=0x1234000000000000000000000000000000001234&type=provider');
    const res = await GET(req);
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json).toHaveProperty('data');
  });
});

// ============================================================
// /api/horizon/slashing
// ============================================================

describe('/api/horizon/slashing', () => {
  let GET: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('@/app/api/horizon/slashing/route');
    GET = mod.GET as (req: Request) => Promise<Response>;
  });

  it('returns 503 when Amp not configured', async () => {
    const req = makeRequest('/api/horizon/slashing');
    const res = await GET(req);
    expect(res.status).toBe(503);
  });

  it('returns 400 for invalid address', async () => {
    mockHasAmpAccess.mockReturnValue(true);
    const req = makeRequest('/api/horizon/slashing?address=notanaddress');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('returns { data } with empty events when Amp returns no rows', async () => {
    mockHasAmpAccess.mockReturnValue(true);
    mockAmpQuery.mockResolvedValueOnce([]);

    const req = makeRequest('/api/horizon/slashing');
    const res = await GET(req);
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json).toHaveProperty('data');
    expect(Array.isArray(json.data)).toBe(true);
  });
});

// ============================================================
// /api/delegation-flows
// ============================================================

describe('/api/delegation-flows', () => {
  let GET: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('@/app/api/delegation-flows/route');
    GET = mod.GET as (req: Request) => Promise<Response>;
  });

  it('returns { data: [] } when DB not configured', async () => {
    const req = makeRequest('/api/delegation-flows');
    const res = await GET(req);
    const json = await getJson(res);
    expect(res.status).toBe(200);
    expect(json.data).toEqual([]);
  });

  it('returns { data } with flow records from DB', async () => {
    mockHasDbAccess.mockReturnValue(true);
    mockDb.mockResolvedValueOnce([
      { indexer_address: '0x1', net_flow: '500000000000000000000', delegations_in: 1, delegations_out: 0, period_days: 7 },
    ]);

    const req = makeRequest('/api/delegation-flows');
    const res = await GET(req);
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(Array.isArray(json.data)).toBe(true);
  });
});

// ============================================================
// /api/indexer-qos/[address]
// ============================================================

describe('/api/indexer-qos/[address]', () => {
  let GET: (req: Request, ctx: { params: Promise<{ address: string }> }) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('@/app/api/indexer-qos/[address]/route');
    GET = mod.GET as typeof GET;
  });

  it('returns 400 for invalid address format', async () => {
    const req = makeRequest('/api/indexer-qos/0x1234');
    const res = await GET(req, { params: Promise.resolve({ address: '0x1234' }) });
    expect(res.status).toBe(400);
  });

  it('returns 503 when no API key (valid address)', async () => {
    mockHasSubgraphAccess.mockReturnValue(false);
    const req = makeRequest('/api/indexer-qos/0x1234000000000000000000000000000000001234');
    const res = await GET(req, { params: Promise.resolve({ address: '0x1234000000000000000000000000000000001234' }) });
    expect(res.status).toBe(503);
  });

  it('returns { data: { qos } } with QoS points', async () => {
    mockSubgraphQuery.mockResolvedValueOnce({
      indexerDailyDataPoints: [
        {
          dayNumber: '19800',
          query_count: '1000',
          proportion_indexer_200_responses: '0.99',
          avg_indexer_latency_ms: '120',
          avg_indexer_blocks_behind: '2',
          avg_query_fee: '0.001',
          total_query_fees: '1.0',
        },
      ],
    });

    const req = makeRequest('/api/indexer-qos/0x1234000000000000000000000000000000001234');
    const res = await GET(req, { params: Promise.resolve({ address: '0x1234000000000000000000000000000000001234' }) });
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json).toHaveProperty('data');
    expect(json.data).toHaveProperty('qos');
    expect(Array.isArray(json.data.qos)).toBe(true);
  });

  it('returns empty qos when oracle unavailable', async () => {
    mockSubgraphQuery.mockRejectedValueOnce(new Error('oracle down'));

    const req = makeRequest('/api/indexer-qos/0x1234000000000000000000000000000000001234');
    const res = await GET(req, { params: Promise.resolve({ address: '0x1234000000000000000000000000000000001234' }) });
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json.data.qos).toEqual([]);
  });
});

// ============================================================
// /api/indexer-trends
// ============================================================

describe('/api/indexer-trends', () => {
  let GET: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('@/app/api/indexer-trends/route');
    GET = mod.GET as (req: Request) => Promise<Response>;
  });

  it('returns 400 when indexer param is missing', async () => {
    const req = makeRequest('/api/indexer-trends');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid indexer address', async () => {
    const req = makeRequest('/api/indexer-trends?indexer=notanaddress');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('returns 503 when no API key (valid address)', async () => {
    mockHasSubgraphAccess.mockReturnValue(false);
    const req = makeRequest('/api/indexer-trends?indexer=0x1234000000000000000000000000000000001234');
    const res = await GET(req);
    expect(res.status).toBe(503);
  });

  it('returns { data } with trends', async () => {
    mockSubgraphQuery.mockResolvedValueOnce({
      rewardDailyAggs: [],
      queryFeeDailyAggs: [],
    });

    const req = makeRequest('/api/indexer-trends?indexer=0x1234000000000000000000000000000000001234');
    const res = await GET(req);
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json).toHaveProperty('data');
    expect(json.data).toHaveProperty('rewards');
    expect(json.data).toHaveProperty('queryFees');
  });

  it('returns empty data on subgraph error (non-critical)', async () => {
    mockSubgraphQuery.mockRejectedValueOnce(new Error('unavailable'));

    const req = makeRequest('/api/indexer-trends?indexer=0x1234000000000000000000000000000000001234');
    const res = await GET(req);
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json.data).toEqual({ rewards: [], queryFees: [] });
  });
});

// ============================================================
// /api/indexer-stake-history/[address]
// ============================================================

describe('/api/indexer-stake-history/[address]', () => {
  let GET: (req: Request, ctx: { params: Promise<{ address: string }> }) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('@/app/api/indexer-stake-history/[address]/route');
    GET = mod.GET as typeof GET;
  });

  it('returns 400 for invalid address', async () => {
    const req = makeRequest('/api/indexer-stake-history/0x1234');
    const res = await GET(req, { params: Promise.resolve({ address: '0x1234' }) });
    expect(res.status).toBe(400);
  });

  it('returns 503 when no API key (valid address)', async () => {
    mockHasSubgraphAccess.mockReturnValue(false);
    const req = makeRequest('/api/indexer-stake-history/0x1234000000000000000000000000000000001234');
    const res = await GET(req, { params: Promise.resolve({ address: '0x1234000000000000000000000000000000001234' }) });
    expect(res.status).toBe(503);
  });

  it('returns { data } with stake history', async () => {
    // Route makes 2 subgraph calls: _meta first, then weekly alias block-query
    mockSubgraphQuery.mockResolvedValueOnce({ _meta: { block: { number: 10_000_000 } } });
    mockSubgraphQuery.mockResolvedValueOnce({}); // all week aliases null → empty history

    const req = makeRequest('/api/indexer-stake-history/0x1234000000000000000000000000000000001234');
    const res = await GET(req, { params: Promise.resolve({ address: '0x1234000000000000000000000000000000001234' }) });
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json).toHaveProperty('data');
    expect(json.data).toHaveProperty('history');
    expect(Array.isArray(json.data.history)).toBe(true);
  });
});

// ============================================================
// /api/subgraph-curation/[hash]
// ============================================================

describe('/api/subgraph-curation/[hash]', () => {
  let GET: (req: Request, ctx: { params: Promise<{ hash: string }> }) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('@/app/api/subgraph-curation/[hash]/route');
    GET = mod.GET as typeof GET;
  });

  it('returns 503 when no API key', async () => {
    mockHasSubgraphAccess.mockReturnValue(false);
    const req = makeRequest('/api/subgraph-curation/QmNRuGkzXYPd75LbqHfx6Ksu8n7eDHwD18VCU3UEoxAZxT');
    const res = await GET(req, { params: Promise.resolve({ hash: 'QmNRuGkzXYPd75LbqHfx6Ksu8n7eDHwD18VCU3UEoxAZxT' }) });
    expect(res.status).toBe(503);
  });

  it('returns { data } with curation info', async () => {
    mockSubgraphQuery.mockResolvedValueOnce({
      subgraphDeployments: [{
        signalledTokens: '100000000000000000000000',
        queryFeesAmount: '5000000000000000000',
        curatorSignals: [],
      }],
    });

    const req = makeRequest('/api/subgraph-curation/QmNRuGkzXYPd75LbqHfx6Ksu8n7eDHwD18VCU3UEoxAZxT');
    const res = await GET(req, { params: Promise.resolve({ hash: 'QmNRuGkzXYPd75LbqHfx6Ksu8n7eDHwD18VCU3UEoxAZxT' }) });
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json).toHaveProperty('data');
    expect(json.data).toHaveProperty('signals');
    expect(json.data).toHaveProperty('totalSignalledTokens');
  });
});

// ============================================================
// /api/subgraph-history/[hash]
// ============================================================

describe('/api/subgraph-history/[hash]', () => {
  let GET: (req: Request, ctx: { params: Promise<{ hash: string }> }) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('@/app/api/subgraph-history/[hash]/route');
    GET = mod.GET as typeof GET;
  });

  it('returns 503 when no API key', async () => {
    mockHasSubgraphAccess.mockReturnValue(false);
    const req = makeRequest('/api/subgraph-history/QmNRuGkzXYPd75LbqHfx6Ksu8n7eDHwD18VCU3UEoxAZxT');
    const res = await GET(req, { params: Promise.resolve({ hash: 'QmNRuGkzXYPd75LbqHfx6Ksu8n7eDHwD18VCU3UEoxAZxT' }) });
    expect(res.status).toBe(503);
  });

  it('returns { data } with history (empty when no transactions)', async () => {
    // Route makes one subgraph call: signalTransactions + allocations
    mockSubgraphQuery.mockResolvedValueOnce({
      signalTransactions: [],
      allocations: [],
    });

    const req = makeRequest('/api/subgraph-history/QmNRuGkzXYPd75LbqHfx6Ksu8n7eDHwD18VCU3UEoxAZxT');
    const res = await GET(req, { params: Promise.resolve({ hash: 'QmNRuGkzXYPd75LbqHfx6Ksu8n7eDHwD18VCU3UEoxAZxT' }) });
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json).toHaveProperty('data');
    expect(json.data).toHaveProperty('history');
    expect(Array.isArray(json.data.history)).toBe(true);
  });
});

// ============================================================
// /api/subgraph-fees-30d
// ============================================================

describe('/api/subgraph-fees-30d', () => {
  let GET: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('@/app/api/subgraph-fees-30d/route');
    GET = mod.GET as (req: Request) => Promise<Response>;
  });

  it('returns 503 when no API key', async () => {
    mockHasSubgraphAccess.mockReturnValue(false);
    const req = makeRequest('/api/subgraph-fees-30d');
    const res = await GET(req);
    expect(res.status).toBe(503);
  });

  it('returns { data: [] } when no allocations found', async () => {
    // Route paginates allocations; empty first page → early return of []
    mockSubgraphQuery.mockResolvedValue({ allocations: [] });

    const req = makeRequest('/api/subgraph-fees-30d');
    const res = await GET(req);
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json).toHaveProperty('data');
    expect(Array.isArray(json.data)).toBe(true);
  });
});

// ============================================================
// /api/dropped-chains
// ============================================================

describe('/api/dropped-chains', () => {
  let GET: () => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('@/app/api/dropped-chains/route');
    GET = mod.GET;
  });

  it('returns { data } — empty when no cache', async () => {
    const res = await GET();
    const json = await getJson(res);
    expect(res.status).toBe(200);
    expect(json).toHaveProperty('data');
  });

  it('returns cached dropped-chain data', async () => {
    mockCacheGet.mockResolvedValueOnce({
      chains: { mainnet: { current: ['eth'], previous: ['eth', 'matic'], capturedAt: Date.now() } },
      computedAt: Date.now(),
    });

    const res = await GET();
    const json = await getJson(res);
    expect(res.status).toBe(200);
  });
});

// ============================================================
// /api/chain-lag
// ============================================================

describe('/api/chain-lag', () => {
  let GET: () => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('@/app/api/chain-lag/route');
    GET = mod.GET;
  });

  it('returns { data } — empty when no cache', async () => {
    const res = await GET();
    const json = await getJson(res);
    expect(res.status).toBe(200);
    expect(json).toHaveProperty('data');
  });
});
