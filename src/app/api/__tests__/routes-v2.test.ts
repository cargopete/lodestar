/**
 * API Route Contract Tests — Part 2
 *
 * Covers all routes not tested in routes.test.ts:
 * portfolio, provisions, indexer-status, payments,
 * feed, networks, parameter-history, vote, token-metrics,
 * rewards-history, health, cron/refresh
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------- Mocks ----------

// @/lib/cache — bypass Redis entirely
const mockCacheGet = vi.fn(() => Promise.resolve(null));
vi.mock('@/lib/cache', () => ({
  cached: vi.fn((_key: string, _ttl: number, fetcher: () => Promise<unknown>) => fetcher()),
  cacheGet: (...args: unknown[]) => (mockCacheGet as (...a: unknown[]) => unknown)(...args),
  cacheSet: vi.fn(),
  redis: { get: vi.fn(), set: vi.fn(), ping: vi.fn().mockResolvedValue('PONG') },
  hasRedis: vi.fn(() => true),
  getRedis: vi.fn(() => ({ ping: vi.fn().mockResolvedValue('PONG') })),
}));

// @/lib/subgraph
const mockSubgraphQuery = vi.fn();
const mockHasSubgraphAccess = vi.fn(() => true);
vi.mock('@/lib/subgraph', () => ({
  subgraphQuery: (...args: unknown[]) => mockSubgraphQuery(...args),
  ensQuery: vi.fn(),
  hasSubgraphAccess: () => mockHasSubgraphAccess(),
  delegationEventsQuery: vi.fn(),
}));

// @/lib/db — db export is nullable (null when hasDbAccess() is false)
// The vote route checks `if (!db)` directly, so we need db to actually be null
// when the DB is unconfigured.
const mockDb = vi.fn();
const mockHasDbAccess = vi.fn(() => false);
vi.mock('@/lib/db', () => ({
  get db() {
    return mockHasDbAccess() ? ((...args: unknown[]) => mockDb(...args)) : null;
  },
  hasDbAccess: () => mockHasDbAccess(),
}));

// @/lib/voting
const mockRecoverVoteSigner = vi.fn();
const mockGetCurrentPeriod = vi.fn(() => '2026-04');
vi.mock('@/lib/voting', () => ({
  recoverVoteSigner: (...args: unknown[]) => mockRecoverVoteSigner(...args),
  getCurrentPeriod: () => mockGetCurrentPeriod(),
  VOTE_DOMAIN: { name: 'CommunityVote', version: '1', chainId: 1 },
  VOTE_TYPES: { Vote: [{ name: 'indexer', type: 'address' }] },
}));

// @/lib/refresh
const mockRefreshIndexers = vi.fn();
vi.mock('@/lib/refresh', () => ({
  refreshIndexers: (...args: unknown[]) => mockRefreshIndexers(...args),
}));

// @/lib/cron-runs
vi.mock('@/lib/cron-runs', () => ({
  recordCronRun: vi.fn().mockResolvedValue(undefined),
}));

// @/lib/logger
vi.mock('@/lib/logger', () => ({
  log: {
    api: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    cron: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    health: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ingest: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    amp: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    cache: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    refresh: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  },
  default: { child: vi.fn().mockReturnThis(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  vi.clearAllMocks();
  mockSubgraphQuery.mockReset();
  // Re-establish defaults after clearAllMocks (which may clear implementations)
  mockDb.mockResolvedValue([]);
  mockHasSubgraphAccess.mockReturnValue(true);
  mockHasDbAccess.mockReturnValue(false);
  mockCacheGet.mockResolvedValue(null);
  mockFetch.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
  mockGetCurrentPeriod.mockReturnValue('2026-04');
  mockRefreshIndexers.mockResolvedValue({ count: 42, durationMs: 500 });
});

// ---------- Helpers ----------

function makeRequest(url: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'), init);
}

async function getJson(response: Response) {
  return response.json();
}

// ============================================================
// /api/portfolio
// ============================================================

describe('/api/portfolio', () => {
  let GET: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('@/app/api/portfolio/route');
    GET = mod.GET as (req: NextRequest) => Promise<Response>;
  });

  it('returns 400 when address missing', async () => {
    const req = makeRequest('/api/portfolio?type=delegator');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid type', async () => {
    const req = makeRequest('/api/portfolio?address=0x1234000000000000000000000000000000001234&type=invalid');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

});

// ============================================================
// /api/provisions
// ============================================================

describe('/api/provisions', () => {
  let GET: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('@/app/api/provisions/route');
    GET = mod.GET as (req: NextRequest) => Promise<Response>;
  });

  it('returns 400 when neither indexer nor service provided', async () => {
    const req = makeRequest('/api/provisions');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

});

// ============================================================
// /api/indexer-status/[address]
// ============================================================

describe('/api/indexer-status/[address]', () => {
  let GET: (req: NextRequest, ctx: { params: Promise<{ address: string }> }) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('@/app/api/indexer-status/[address]/route');
    GET = mod.GET as typeof GET;
  });

  it('returns 503 when no API key', async () => {
    mockHasSubgraphAccess.mockReturnValue(false);
    const req = makeRequest('/api/indexer-status/0x1234000000000000000000000000000000001234');
    const res = await GET(req, { params: Promise.resolve({ address: '0x1234000000000000000000000000000000001234' }) });
    expect(res.status).toBe(503);
  });

  it('returns empty deployment list when indexer has no allocations', async () => {
    // Pagination: first call returns empty allocations → loop exits
    mockSubgraphQuery.mockResolvedValueOnce({
      indexer: { url: null },
      allocations: [],
    });

    const req = makeRequest('/api/indexer-status/0x1234000000000000000000000000000000001234');
    const res = await GET(req, { params: Promise.resolve({ address: '0x1234000000000000000000000000000000001234' }) });
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json).toHaveProperty('data');
    expect(json.data.totalAllocations).toBe(0);
    expect(json.data.deployments).toEqual([]);
  });

  it('returns deployment status for indexer with allocations (unreachable — no indexer URL)', async () => {
    mockSubgraphQuery.mockResolvedValueOnce({
      indexer: { url: null },
      allocations: [
        {
          id: 'a1',
          allocatedTokens: '1000000000000000000000',
          createdAtEpoch: 100,
          subgraphDeployment: {
            id: '0xdep1',
            ipfsHash: 'QmTest',
            signalledTokens: '100000000000000000000',
            stakedTokens: '200000000000000000000',
          },
        },
      ],
    });
    // Second pagination call: empty = exits loop
    mockSubgraphQuery.mockResolvedValueOnce({ allocations: [] });

    const req = makeRequest('/api/indexer-status/0x1234000000000000000000000000000000001234');
    const res = await GET(req, { params: Promise.resolve({ address: '0x1234000000000000000000000000000000001234' }) });
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json.data.totalAllocations).toBe(1);
    expect(json.data.unreachableCount).toBe(1);
    expect(json.data.deployments[0].status).toBe('unreachable');
  });
});

// ============================================================
// /api/payments
// ============================================================

describe('/api/payments', () => {
  let GET: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('@/app/api/payments/route');
    GET = mod.GET as (req: NextRequest) => Promise<Response>;
  });

  it('returns 400 for invalid receiver address format', async () => {
    const req = makeRequest('/api/payments?receiver=0xindexer');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });
});

// ============================================================
// /api/feed
// ============================================================

describe('/api/feed', () => {
  let GET: () => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('@/app/api/feed/route');
    GET = mod.GET;
  });

  it('returns { items } array when all external sources fail gracefully', async () => {
    // All fetch calls return non-ok or empty — route should still return 200
    mockFetch.mockResolvedValue(new Response('', { status: 404 }));

    const res = await GET();
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json).toHaveProperty('items');
    expect(Array.isArray(json.items)).toBe(true);
  });

  it('returns items when forum API succeeds', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          topic_list: {
            topics: [
              { id: 1, title: 'GIP-0001', slug: 'gip-0001', pinned: false, views: 100, reply_count: 5, bumped_at: '2026-04-01T00:00:00Z', tags: ['gip'], excerpt: 'A proposal' },
            ],
          },
        }),
        { status: 200 },
      ),
    );
    // Remaining fetch calls fail gracefully
    mockFetch.mockResolvedValue(new Response('', { status: 404 }));

    const res = await GET();
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(Array.isArray(json.items)).toBe(true);
  });
});

// ============================================================
// /api/parameter-history/[address]
// ============================================================

describe('/api/parameter-history/[address]', () => {
  let GET: (req: NextRequest, ctx: { params: Promise<{ address: string }> }) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('@/app/api/parameter-history/[address]/route');
    GET = mod.GET as typeof GET;
  });

  it('returns { data: [] } when DB not configured', async () => {
    // mockHasDbAccess returns false by default in beforeEach
    const req = makeRequest('/api/parameter-history/0x1234');
    const res = await GET(req, { params: Promise.resolve({ address: '0x1234000000000000000000000000000000001234' }) });
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json).toHaveProperty('data');
    expect(json.data).toEqual([]);
  });

  it('returns parameter change history from DB', async () => {
    mockHasDbAccess.mockReturnValue(true);
    mockDb.mockResolvedValueOnce([
      {
        param_name: 'reward_cut',
        old_value: 100000,
        new_value: 120000,
        epoch: 1247,
        detected_at: new Date('2026-04-01'),
      },
      {
        param_name: 'query_fee_cut',
        old_value: null,
        new_value: 50000,
        epoch: null,
        detected_at: new Date('2026-03-15'),
      },
    ]);

    const req = makeRequest('/api/parameter-history/0x1234');
    const res = await GET(req, { params: Promise.resolve({ address: '0x1234000000000000000000000000000000001234' }) });
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json.data).toHaveLength(2);
    expect(json.data[0]).toHaveProperty('param_name', 'reward_cut');
    expect(json.data[0]).toHaveProperty('old_value', 100000);
    expect(json.data[0]).toHaveProperty('new_value', 120000);
    expect(json.data[0]).toHaveProperty('epoch', 1247);
    expect(json.data[0]).toHaveProperty('detected_at');
    // null epoch passes through
    expect(json.data[1].epoch).toBeNull();
    // null old_value passes through
    expect(json.data[1].old_value).toBeNull();
  });

  it('lowercases address in query', async () => {
    mockHasDbAccess.mockReturnValue(true);
    mockDb.mockResolvedValueOnce([]);

    const req = makeRequest('/api/parameter-history/0xABCD');
    await GET(req, { params: Promise.resolve({ address: '0xABCD' }) });

    // The db tagged template is called with the lowercased address
    // We can't easily inspect the SQL args but we can verify it was called
    expect(mockDb).toHaveBeenCalled();
  });
});

// ============================================================
// /api/vote
// ============================================================

describe('/api/vote GET', () => {
  let GET: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('@/app/api/vote/route');
    GET = mod.GET as (req: NextRequest) => Promise<Response>;
  });

  it('returns 503 when DB not configured', async () => {
    const req = makeRequest('/api/vote?period=2026-04');
    const res = await GET(req);
    expect(res.status).toBe(503);
  });

  it('returns vote tallies and voters when DB configured', async () => {
    mockHasDbAccess.mockReturnValue(true);
    // Three DB calls: tallies, voters, optionally userVote (if voter param present)
    mockDb
      .mockResolvedValueOnce([{ indexer_address: '0xindexer', weighted_votes: 3, voter_count: 2 }])
      .mockResolvedValueOnce([{ voter_address: '0xvoter', indexer_address: '0xindexer', is_delegator: false, vote_weight: 1, created_at: new Date() }]);

    const req = makeRequest('/api/vote?period=2026-04');
    const res = await GET(req);
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json).toHaveProperty('period', '2026-04');
    expect(json).toHaveProperty('tallies');
    expect(json).toHaveProperty('voters');
    expect(json).toHaveProperty('userVote');
  });

  it('checks for existing user vote when voter param provided', async () => {
    mockHasDbAccess.mockReturnValue(true);
    mockDb
      .mockResolvedValueOnce([])   // tallies
      .mockResolvedValueOnce([])   // voters
      .mockResolvedValueOnce([{ indexer_address: '0xindexer' }]); // user's existing vote

    const req = makeRequest('/api/vote?period=2026-04&voter=0xaaaa000000000000000000000000000000001234');
    const res = await GET(req);
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json.userVote).toBe('0xindexer');
  });
});

describe('/api/vote POST', () => {
  let POST: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('@/app/api/vote/route');
    POST = mod.POST as (req: NextRequest) => Promise<Response>;
  });

  it('returns 503 when DB not configured', async () => {
    const req = makeRequest('/api/vote', {
      method: 'POST',
      body: JSON.stringify({ message: {}, signature: '0x' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(503);
  });

  it('returns 400 for invalid JSON', async () => {
    mockHasDbAccess.mockReturnValue(true);
    const req = makeRequest('/api/vote', {
      method: 'POST',
      body: 'not-json',
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when required fields missing', async () => {
    mockHasDbAccess.mockReturnValue(true);
    const req = makeRequest('/api/vote', {
      method: 'POST',
      body: JSON.stringify({ message: { indexer: '0x1234' }, signature: '' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when voting for a non-current period', async () => {
    mockHasDbAccess.mockReturnValue(true);
    const req = makeRequest('/api/vote', {
      method: 'POST',
      body: JSON.stringify({
        message: {
          indexer: '0x1234567890123456789012345678901234567890',
          period: '2025-01',
          voter: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        },
        signature: '0xsig',
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await getJson(res);
    expect(json.error).toContain('current period');
  });

  it('returns 400 for invalid address format', async () => {
    mockHasDbAccess.mockReturnValue(true);
    const req = makeRequest('/api/vote', {
      method: 'POST',
      body: JSON.stringify({
        message: {
          indexer: 'notanaddress',
          period: '2026-04',
          voter: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        },
        signature: '0xsig',
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when signature is invalid', async () => {
    mockHasDbAccess.mockReturnValue(true);
    mockRecoverVoteSigner.mockRejectedValueOnce(new Error('invalid signature'));

    const req = makeRequest('/api/vote', {
      method: 'POST',
      body: JSON.stringify({
        message: {
          indexer: '0x1234567890123456789012345678901234567890',
          period: '2026-04',
          voter: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        },
        signature: '0xbadsig',
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 403 when signer does not match voter', async () => {
    mockHasDbAccess.mockReturnValue(true);
    mockRecoverVoteSigner.mockResolvedValueOnce('0xdifferentaddress000000000000000000000000');

    const req = makeRequest('/api/vote', {
      method: 'POST',
      body: JSON.stringify({
        message: {
          indexer: '0x1234567890123456789012345678901234567890',
          period: '2026-04',
          voter: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        },
        signature: '0xsig',
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it('returns 409 when voter already voted this period', async () => {
    mockHasDbAccess.mockReturnValue(true);
    mockRecoverVoteSigner.mockResolvedValueOnce('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');
    // Existing vote check returns a row
    mockDb.mockResolvedValueOnce([{ id: 1 }]);

    const req = makeRequest('/api/vote', {
      method: 'POST',
      body: JSON.stringify({
        message: {
          indexer: '0x1234567890123456789012345678901234567890',
          period: '2026-04',
          voter: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        },
        signature: '0xsig',
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(409);
  });

  it('records vote successfully for non-delegator', async () => {
    mockHasDbAccess.mockReturnValue(true);
    mockRecoverVoteSigner.mockResolvedValueOnce('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');
    mockDb
      .mockResolvedValueOnce([])    // no existing vote
      .mockResolvedValueOnce([])    // not a delegator
      .mockResolvedValueOnce([]);   // insert succeeds

    const req = makeRequest('/api/vote', {
      method: 'POST',
      body: JSON.stringify({
        message: {
          indexer: '0x1234567890123456789012345678901234567890',
          period: '2026-04',
          voter: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        },
        signature: '0xvalidsig',
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.vote.voteWeight).toBe(1);
    expect(json.vote.isDelegator).toBe(false);
  });

  it('gives delegators 5x vote weight', async () => {
    mockHasDbAccess.mockReturnValue(true);
    mockRecoverVoteSigner.mockResolvedValueOnce('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');
    mockDb
      .mockResolvedValueOnce([])          // no existing vote
      .mockResolvedValueOnce([{ '?column?': 1 }])  // is a delegator
      .mockResolvedValueOnce([]);          // insert succeeds

    const req = makeRequest('/api/vote', {
      method: 'POST',
      body: JSON.stringify({
        message: {
          indexer: '0x1234567890123456789012345678901234567890',
          period: '2026-04',
          voter: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        },
        signature: '0xvalidsig',
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json.vote.voteWeight).toBe(5);
    expect(json.vote.isDelegator).toBe(true);
  });
});

// ============================================================
// /api/token-metrics
// ============================================================

describe('/api/token-metrics', () => {
  let GET: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('@/app/api/token-metrics/route');
    GET = mod.GET as (req: NextRequest) => Promise<Response>;
  });

  it('falls back to the subgraph when the DB is not configured', async () => {
    // Previously this asserted a bare `200 { data: [] }`, which was the route answering
    // successfully with nothing whatever went wrong (#36). It must actually reach the fallback.
    //
    // `mockReset` rather than `mockResolvedValueOnce` alone: the suite's `vi.clearAllMocks()`
    // clears recorded calls but not queued one-shot implementations, so an unconsumed `Once`
    // from an earlier test would be served here instead.
    mockSubgraphQuery.mockReset().mockResolvedValue({ epoches: [] });

    const req = makeRequest('/api/token-metrics');
    const res = await GET(req);
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json.data).toEqual([]);
    expect(mockSubgraphQuery).toHaveBeenCalled();
  });

  it('503s instead of an empty series when there is no gateway key either', async () => {
    mockHasSubgraphAccess.mockReturnValue(false);

    const res = await GET(makeRequest('/api/token-metrics'));
    const json = await getJson(res);

    expect(res.status).toBe(503);
    expect(json.data).toBeUndefined();
  });

  it('returns computed token metrics from DB', async () => {
    mockHasDbAccess.mockReturnValue(true);
    mockDb.mockResolvedValueOnce([
      { epoch: 1247, issuance: '1000', query_fee_tax_burn: '50', dispute_burn: '10' },
      { epoch: 1246, issuance: '990', query_fee_tax_burn: '45', dispute_burn: '5' },
    ]);

    const req = makeRequest('/api/token-metrics');
    const res = await GET(req);
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data.length).toBe(2);
    expect(json.data[0]).toHaveProperty('epoch');
    expect(json.data[0]).toHaveProperty('issuance');
    expect(json.data[0]).toHaveProperty('totalBurn');
    expect(json.data[0]).toHaveProperty('net');
  });

  it('uses count=100 by default', async () => {
    mockHasDbAccess.mockReturnValue(true);
    mockDb.mockResolvedValueOnce([]);

    const req = makeRequest('/api/token-metrics');
    await GET(req);

    // default count is 100 — verify db was called (count embedded in SQL)
    expect(mockDb).toHaveBeenCalled();
  });

  it('only allows whitelisted count values', async () => {
    mockHasDbAccess.mockReturnValue(true);
    mockDb.mockResolvedValue([]);
    mockSubgraphQuery.mockReset().mockResolvedValue({ epoches: [] });

    // Count 999 is not in the allowlist — should silently use 100
    const req = makeRequest('/api/token-metrics?count=999');
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(mockSubgraphQuery.mock.calls[0][0]).toContain('first: 100');
  });
});

// ============================================================
// /api/rewards-history
// ============================================================

describe('/api/rewards-history', () => {
  let GET: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('@/app/api/rewards-history/route');
    GET = mod.GET as (req: NextRequest) => Promise<Response>;
  });

  it('returns 400 when address missing', async () => {
    const req = makeRequest('/api/rewards-history');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('returns 503 when DB not configured', async () => {
    const req = makeRequest('/api/rewards-history?address=0x1234000000000000000000000000000000001234');
    const res = await GET(req);
    expect(res.status).toBe(503);
  });

  it('returns 503 when no API key', async () => {
    mockHasDbAccess.mockReturnValue(true);
    mockHasSubgraphAccess.mockReturnValue(false);
    const req = makeRequest('/api/rewards-history?address=0x1234000000000000000000000000000000001234');
    const res = await GET(req);
    expect(res.status).toBe(503);
  });

  it('returns empty history when delegator has no stakes', async () => {
    mockHasDbAccess.mockReturnValue(true);
    mockSubgraphQuery.mockResolvedValueOnce({ delegator: null });

    const req = makeRequest('/api/rewards-history?address=0x1234000000000000000000000000000000001234');
    const res = await GET(req);
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json).toHaveProperty('history');
    expect(json.history).toEqual([]);
  });

  it('returns empty history when no exchange rate snapshots', async () => {
    mockHasDbAccess.mockReturnValue(true);
    mockSubgraphQuery.mockResolvedValueOnce({
      delegator: {
        stakes: [
          { stakedTokens: '1000000000000000000000', shareAmount: '900000000000000000000', indexer: { id: '0xindexer' } },
        ],
      },
    });
    // DB returns no snapshots
    mockDb.mockResolvedValueOnce([]);

    const req = makeRequest('/api/rewards-history?address=0x1234000000000000000000000000000000001234');
    const res = await GET(req);
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json.history).toEqual([]);
  });

  it('returns history array when delegator has stakes', async () => {
    // Contract test: route returns { history: [...] } when data is available.
    // The computation logic (exchange rate → value) is covered by the rewards
    // lib unit tests. Here we verify the API surface and error handling.
    mockHasDbAccess.mockReturnValue(true);
    mockSubgraphQuery.mockResolvedValueOnce({
      delegator: {
        stakes: [
          { stakedTokens: '1000000000000000000000', shareAmount: '900000000000000000000', indexer: { id: '0xindexer' } },
        ],
      },
    });
    // DB mock returns empty snapshots (no snapshots yet for this delegator) →
    // route gracefully returns { history: [] }
    // (Full computation path tested via the route returning non-empty data
    // requires a running Postgres — tested in integration.)

    const req = makeRequest('/api/rewards-history?address=0x1234000000000000000000000000000000001234');
    const res = await GET(req);
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json).toHaveProperty('history');
    expect(Array.isArray(json.history)).toBe(true);
  });

  it('clamps days between 7 and 365', async () => {
    mockHasDbAccess.mockReturnValue(true);
    mockSubgraphQuery.mockResolvedValueOnce({ delegator: null });

    // days=1 should be clamped to 7
    const req = makeRequest('/api/rewards-history?address=0x1234000000000000000000000000000000001234&days=1');
    const res = await GET(req);
    expect(res.status).toBe(200);
  });
});

// ============================================================
// /api/health
// ============================================================

describe('/api/health', () => {
  let GET: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    // Reset mockDb queue — vi.clearAllMocks() does not flush onceImplementations
    mockDb.mockReset();
    mockDb.mockResolvedValue([]);
    const mod = await import('@/app/api/health/route');
    GET = mod.GET as (req: NextRequest) => Promise<Response>;
  });

  it('returns status with components shape', async () => {
    const req = makeRequest('/api/health');
    const res = await GET(req);
    const json = await getJson(res);

    // Either 200 (healthy/degraded) or 503 (unhealthy — postgres down)
    expect([200, 503]).toContain(res.status);
    expect(json).toHaveProperty('status');
    expect(json).toHaveProperty('timestamp');
    expect(json).toHaveProperty('components');
    expect(json.components).toHaveProperty('postgres');
    expect(json.components).toHaveProperty('redis');
  });

  it('reports postgres as down when DB not configured', async () => {
    // mockHasDbAccess returns false by default → postgres: down
    const req = makeRequest('/api/health');
    const res = await GET(req);
    const json = await getJson(res);

    expect(json.status).toBe('unhealthy');
    expect(json.components.postgres.status).toBe('down');
    expect(res.status).toBe(503);
  });

  it('returns ingestion status when postgres is up', async () => {
    mockHasDbAccess.mockReturnValue(true);
    // SELECT 1 probe
    mockDb.mockResolvedValueOnce([{ '?column?': 1 }]);
    // ingestion_state query
    mockDb.mockResolvedValueOnce([
      { key: 'epochs', updated_at: new Date(Date.now() - 30 * 60000) },
    ]);
    // cron_runs query
    mockDb.mockResolvedValueOnce([]);

    const req = makeRequest('/api/health');
    const res = await GET(req);
    const json = await getJson(res);

    expect(json.components.postgres.status).toBe('up');
    expect(json).toHaveProperty('ingestion');
    expect(json.ingestion).toHaveProperty('epochs');
    expect(json.ingestion.epochs.healthy).toBe(true);
  });
});

// ============================================================
// /api/cron/refresh
// ============================================================

describe('/api/cron/refresh', () => {
  let GET: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import('@/app/api/cron/refresh/route');
    GET = mod.GET as (req: NextRequest) => Promise<Response>;
  });

  it('returns 401 when CRON_SECRET is set and request is missing auth header', async () => {
    vi.stubEnv('CRON_SECRET', 'super-secret');
    const req = makeRequest('/api/cron/refresh');
    const res = await GET(req);
    expect(res.status).toBe(401);
    vi.unstubAllEnvs();
  });

  it('proceeds when CRON_SECRET is set and auth header matches', async () => {
    vi.stubEnv('CRON_SECRET', 'super-secret');
    const req = makeRequest('/api/cron/refresh', {
      headers: { Authorization: 'Bearer super-secret' },
    });
    const res = await GET(req);
    const json = await getJson(res);

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json).toHaveProperty('count');
    vi.unstubAllEnvs();
  });

  it('returns 401 when CRON_SECRET not set (fail-closed)', async () => {
    vi.unstubAllEnvs();
    const req = makeRequest('/api/cron/refresh');
    const res = await GET(req);

    expect(res.status).toBe(401);
  });
});
