/**
 * Cron Route Auth Tests
 *
 * Verifies that every cron endpoint:
 *  1. Returns 401 when CRON_SECRET is not set (fail-closed)
 *  2. Returns 401 when an incorrect token is supplied
 *  3. Returns 401 when no Authorization header is present (even if secret is set)
 *  4. Returns 503 (not 200) when auth passes but required services are unavailable
 *
 * The success path for /api/cron/refresh is covered in routes-v2.test.ts.
 * This file covers the remaining cron routes plus /api/horizon/debug.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('@/lib/cache', () => ({
  cached: vi.fn((_k: string, _t: number, f: () => Promise<unknown>) => f()),
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn().mockResolvedValue(undefined),
  hasRedis: vi.fn(() => true),
  getRedis: vi.fn(() => ({ ping: vi.fn().mockResolvedValue('PONG') })),
}));

const mockDb = vi.fn();
const mockHasDbAccess = vi.fn(() => false);
vi.mock('@/lib/db', () => ({
  get db() { return mockHasDbAccess() ? ((...a: unknown[]) => mockDb(...a)) : null; },
  hasDbAccess: () => mockHasDbAccess(),
}));

const mockHasSubgraphAccess = vi.fn(() => false);
vi.mock('@/lib/subgraph', () => ({
  subgraphQuery: vi.fn(),
  hasSubgraphAccess: () => mockHasSubgraphAccess(),
}));

const mockHasAmpAccess = vi.fn(() => false);
vi.mock('@/lib/amp', () => ({
  hasAmpAccess: () => mockHasAmpAccess(),
  ampQuery: vi.fn(),
  HORIZON_STAKING: '0xstaking',
  TOPIC0: {},
  AMP_DATASET: 'dataset',
  topicToAddress: vi.fn(),
  hexToBigInt: vi.fn(),
  hexLit: vi.fn(),
  strip0x: vi.fn(),
  AmpError: class AmpError extends Error {},
}));

vi.mock('@/lib/ingest/epochs', () => ({ ingestEpochs: vi.fn().mockResolvedValue({ ingested: 0, durationMs: 0 }) }));
vi.mock('@/lib/ingest/allocations', () => ({ ingestAllocations: vi.fn().mockResolvedValue({ ingested: 0, durationMs: 0 }) }));
vi.mock('@/lib/ingest/delegations', () => ({ ingestDelegationEvents: vi.fn().mockResolvedValue({ ingested: 0, durationMs: 0 }) }));
vi.mock('@/lib/ingest/disputes', () => ({ ingestDisputes: vi.fn().mockResolvedValue({ ingested: 0, durationMs: 0 }) }));
vi.mock('@/lib/ingest/network-snapshot', () => ({ writeNetworkSnapshot: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/refresh', () => ({ refreshIndexers: vi.fn().mockResolvedValue({ count: 0, durationMs: 0 }) }));

const mockIngestQos = vi.fn().mockResolvedValue({ ingested: 0, durationMs: 0 });
const mockIngestRav = vi.fn().mockResolvedValue({ ingested: 0, durationMs: 0 });
const mockComputeQosScores = vi.fn().mockResolvedValue({ scored: 0 });
vi.mock('@/lib/ingest/qos', () => ({ ingestQos: (...a: unknown[]) => mockIngestQos(...a) }));
vi.mock('@/lib/ingest/rav', () => ({ ingestRav: (...a: unknown[]) => mockIngestRav(...a) }));
vi.mock('@/lib/qos-aggregate', () => ({
  computeAndStoreQosScores: (...a: unknown[]) => mockComputeQosScores(...a),
}));

vi.mock('@/lib/cron-runs', () => ({
  withCronTracking: vi.fn((_db: unknown, _step: string, fn: () => Promise<unknown>) => fn()),
  recordCronRun: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/logger', () => ({
  log: {
    api: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    cron: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ingest: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    amp: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    health: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    refresh: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    cache: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  },
  default: { child: vi.fn().mockReturnThis(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));

beforeEach(() => {
  vi.clearAllMocks();
  mockHasDbAccess.mockReturnValue(false);
  mockHasSubgraphAccess.mockReturnValue(false);
  mockHasAmpAccess.mockReturnValue(false);
  mockDb.mockResolvedValue([]);
  mockIngestQos.mockResolvedValue({ ingested: 0, durationMs: 0 });
  mockIngestRav.mockResolvedValue({ ingested: 0, durationMs: 0 });
  mockComputeQosScores.mockResolvedValue({ scored: 0 });
});

// ── Helpers ────────────────────────────────────────────────────────────────

function makeRequest(url: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'), { headers });
}

function authedRequest(url: string, secret = 'test-secret'): NextRequest {
  return makeRequest(url, { Authorization: `Bearer ${secret}` });
}

// ── Shared auth behaviour matrix ───────────────────────────────────────────

/**
 * Asserts the standard cron auth contract for a route GET handler.
 *   - 401 when CRON_SECRET env var is not set
 *   - 401 when Authorization header is missing
 *   - 401 when wrong token is sent
 */
async function assertCronAuth(
  routePath: string,
  importFn: () => Promise<{ GET: (r: NextRequest) => Promise<Response> }>,
) {
  const { GET } = await importFn();

  // 1. No CRON_SECRET set → fail-closed
  vi.unstubAllEnvs();
  const res1 = await GET(makeRequest(routePath));
  expect(res1.status, `${routePath}: should 401 when CRON_SECRET unset`).toBe(401);

  // 2. CRON_SECRET set but no Authorization header
  vi.stubEnv('CRON_SECRET', 'test-secret');
  const res2 = await GET(makeRequest(routePath));
  expect(res2.status, `${routePath}: should 401 when no auth header`).toBe(401);

  // 3. Wrong token
  const res3 = await GET(makeRequest(routePath, { Authorization: 'Bearer wrong' }));
  expect(res3.status, `${routePath}: should 401 for wrong token`).toBe(401);

  vi.unstubAllEnvs();
}

// ─────────────────────────────────────────────────────────────────────────────

describe('/api/cron/ingest-epochs', () => {
  it('enforces CRON_SECRET auth', async () => {
    await assertCronAuth('/api/cron/ingest-epochs', () => import('@/app/api/cron/ingest-epochs/route'));
  });

  it('returns 503 when DB not configured (auth passes)', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    const { GET } = await import('@/app/api/cron/ingest-epochs/route');
    const res = await GET(authedRequest('/api/cron/ingest-epochs'));
    expect(res.status).toBe(503);
    vi.unstubAllEnvs();
  });

  it('returns 503 when subgraph not configured (auth + DB pass)', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    mockHasDbAccess.mockReturnValue(true);
    const { GET } = await import('@/app/api/cron/ingest-epochs/route');
    const res = await GET(authedRequest('/api/cron/ingest-epochs'));
    expect(res.status).toBe(503);
    vi.unstubAllEnvs();
  });

  it('returns 200 when fully configured', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    mockHasDbAccess.mockReturnValue(true);
    mockHasSubgraphAccess.mockReturnValue(true);
    const { GET } = await import('@/app/api/cron/ingest-epochs/route');
    const res = await GET(authedRequest('/api/cron/ingest-epochs'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    vi.unstubAllEnvs();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('/api/cron/ingest-allocations', () => {
  it('enforces CRON_SECRET auth', async () => {
    await assertCronAuth('/api/cron/ingest-allocations', () => import('@/app/api/cron/ingest-allocations/route'));
  });

  it('returns 503 when DB not configured', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    const { GET } = await import('@/app/api/cron/ingest-allocations/route');
    const res = await GET(authedRequest('/api/cron/ingest-allocations'));
    expect(res.status).toBe(503);
    vi.unstubAllEnvs();
  });

  it('returns 503 when subgraph not configured', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    mockHasDbAccess.mockReturnValue(true);
    const { GET } = await import('@/app/api/cron/ingest-allocations/route');
    const res = await GET(authedRequest('/api/cron/ingest-allocations'));
    expect(res.status).toBe(503);
    vi.unstubAllEnvs();
  });

  it('returns 200 when fully configured', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    mockHasDbAccess.mockReturnValue(true);
    mockHasSubgraphAccess.mockReturnValue(true);
    const { GET } = await import('@/app/api/cron/ingest-allocations/route');
    const res = await GET(authedRequest('/api/cron/ingest-allocations'));
    expect(res.status).toBe(200);
    vi.unstubAllEnvs();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('/api/cron/ingest-delegations', () => {
  it('enforces CRON_SECRET auth', async () => {
    await assertCronAuth('/api/cron/ingest-delegations', () => import('@/app/api/cron/ingest-delegations/route'));
  });

  it('returns 503 when DB not configured', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    const { GET } = await import('@/app/api/cron/ingest-delegations/route');
    const res = await GET(authedRequest('/api/cron/ingest-delegations'));
    expect(res.status).toBe(503);
    vi.unstubAllEnvs();
  });

  it('returns 200 when DB configured (no subgraph needed)', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    mockHasDbAccess.mockReturnValue(true);
    const { GET } = await import('@/app/api/cron/ingest-delegations/route');
    const res = await GET(authedRequest('/api/cron/ingest-delegations'));
    expect(res.status).toBe(200);
    vi.unstubAllEnvs();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('/api/cron/ingest-disputes', () => {
  it('enforces CRON_SECRET auth', async () => {
    await assertCronAuth('/api/cron/ingest-disputes', () => import('@/app/api/cron/ingest-disputes/route'));
  });

  it('returns 503 when DB not configured', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    const { GET } = await import('@/app/api/cron/ingest-disputes/route');
    const res = await GET(authedRequest('/api/cron/ingest-disputes'));
    expect(res.status).toBe(503);
    vi.unstubAllEnvs();
  });

  it('returns 200 when fully configured', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    mockHasDbAccess.mockReturnValue(true);
    mockHasSubgraphAccess.mockReturnValue(true);
    const { GET } = await import('@/app/api/cron/ingest-disputes/route');
    const res = await GET(authedRequest('/api/cron/ingest-disputes'));
    expect(res.status).toBe(200);
    vi.unstubAllEnvs();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('/api/cron/ingest-horizon-activity', () => {
  it('enforces CRON_SECRET auth', async () => {
    await assertCronAuth('/api/cron/ingest-horizon-activity', () => import('@/app/api/cron/ingest-horizon-activity/route'));
  });

  it('returns 503 when Amp not configured', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    const { GET } = await import('@/app/api/cron/ingest-horizon-activity/route');
    const res = await GET(authedRequest('/api/cron/ingest-horizon-activity'));
    expect(res.status).toBe(503);
    vi.unstubAllEnvs();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('/api/cron/snapshot-network', () => {
  it('enforces CRON_SECRET auth', async () => {
    await assertCronAuth('/api/cron/snapshot-network', () => import('@/app/api/cron/snapshot-network/route'));
  });

  it('returns 503 when DB not configured', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    const { GET } = await import('@/app/api/cron/snapshot-network/route');
    const res = await GET(authedRequest('/api/cron/snapshot-network'));
    expect(res.status).toBe(503);
    vi.unstubAllEnvs();
  });

  it('returns 503 when subgraph not configured', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    mockHasDbAccess.mockReturnValue(true);
    const { GET } = await import('@/app/api/cron/snapshot-network/route');
    const res = await GET(authedRequest('/api/cron/snapshot-network'));
    expect(res.status).toBe(503);
    vi.unstubAllEnvs();
  });

  it('returns 200 when fully configured', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    mockHasDbAccess.mockReturnValue(true);
    mockHasSubgraphAccess.mockReturnValue(true);
    mockDb.mockResolvedValue([]);
    const { GET } = await import('@/app/api/cron/snapshot-network/route');
    const res = await GET(authedRequest('/api/cron/snapshot-network'));
    expect(res.status).toBe(200);
    vi.unstubAllEnvs();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('/api/cron/refresh-chain-health', () => {
  it('enforces CRON_SECRET auth', async () => {
    await assertCronAuth('/api/cron/refresh-chain-health', () => import('@/app/api/cron/refresh-chain-health/route'));
  });

  it('returns 200 with no-op message when no enriched indexers cached', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    // cacheGet returns null → no enriched indexers → short-circuit
    const { GET } = await import('@/app/api/cron/refresh-chain-health/route');
    const res = await GET(authedRequest('/api/cron/refresh-chain-health'));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    vi.unstubAllEnvs();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('/api/cron/ingest-qos', () => {
  it('enforces CRON_SECRET auth', async () => {
    await assertCronAuth('/api/cron/ingest-qos', () => import('@/app/api/cron/ingest-qos/route'));
  });

  it('returns 503 when DB not configured', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    const { GET } = await import('@/app/api/cron/ingest-qos/route');
    const res = await GET(authedRequest('/api/cron/ingest-qos'));
    expect(res.status).toBe(503);
    expect(mockIngestQos).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it('returns 503 when subgraph not configured', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    mockHasDbAccess.mockReturnValue(true);
    const { GET } = await import('@/app/api/cron/ingest-qos/route');
    const res = await GET(authedRequest('/api/cron/ingest-qos'));
    expect(res.status).toBe(503);
    vi.unstubAllEnvs();
  });

  it('ingests, then rescores from the refreshed window', async () => {
    // The scoring pass is the reason this route is not just `ingestQos`: scores computed
    // before the ingest describe the previous window and look entirely plausible.
    vi.stubEnv('CRON_SECRET', 'test-secret');
    mockHasDbAccess.mockReturnValue(true);
    mockHasSubgraphAccess.mockReturnValue(true);
    mockIngestQos.mockResolvedValue({ ingested: 12, durationMs: 5 });
    mockComputeQosScores.mockResolvedValue({ scored: 7 });

    const { GET } = await import('@/app/api/cron/ingest-qos/route');
    const res = await GET(authedRequest('/api/cron/ingest-qos'));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, ingested: 12, scored: 7 });
    expect(mockIngestQos.mock.invocationCallOrder[0])
      .toBeLessThan(mockComputeQosScores.mock.invocationCallOrder[0]);
    vi.unstubAllEnvs();
  });

  it('defaults to an incremental run and passes ?backfill=1 and ?days through', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    mockHasDbAccess.mockReturnValue(true);
    mockHasSubgraphAccess.mockReturnValue(true);
    const { GET } = await import('@/app/api/cron/ingest-qos/route');

    await GET(authedRequest('/api/cron/ingest-qos'));
    expect(mockIngestQos).toHaveBeenLastCalledWith(expect.anything(), { backfill: false, days: undefined });

    await GET(authedRequest('/api/cron/ingest-qos?backfill=1&days=30'));
    expect(mockIngestQos).toHaveBeenLastCalledWith(expect.anything(), { backfill: true, days: 30 });

    // Anything other than the literal 1 is not a backfill: a cron that quietly re-pulls all
    // history on a typo is an expensive way to find out about the typo.
    await GET(authedRequest('/api/cron/ingest-qos?backfill=true'));
    expect(mockIngestQos).toHaveBeenLastCalledWith(expect.anything(), { backfill: false, days: undefined });
    vi.unstubAllEnvs();
  });

  it('500s when the ingest throws', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    mockHasDbAccess.mockReturnValue(true);
    mockHasSubgraphAccess.mockReturnValue(true);
    mockIngestQos.mockRejectedValue(new Error('gateway 500'));

    const { GET } = await import('@/app/api/cron/ingest-qos/route');
    const res = await GET(authedRequest('/api/cron/ingest-qos'));
    expect(res.status).toBe(500);
    // The scoring pass must not run over a failed ingest.
    expect(mockComputeQosScores).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('/api/cron/ingest-rav', () => {
  it('enforces CRON_SECRET auth', async () => {
    await assertCronAuth('/api/cron/ingest-rav', () => import('@/app/api/cron/ingest-rav/route'));
  });

  it('returns 503 when DB not configured', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    const { GET } = await import('@/app/api/cron/ingest-rav/route');
    const res = await GET(authedRequest('/api/cron/ingest-rav'));
    expect(res.status).toBe(503);
    expect(mockIngestRav).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it('returns 503 when subgraph not configured', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    mockHasDbAccess.mockReturnValue(true);
    const { GET } = await import('@/app/api/cron/ingest-rav/route');
    const res = await GET(authedRequest('/api/cron/ingest-rav'));
    expect(res.status).toBe(503);
    vi.unstubAllEnvs();
  });

  it('returns 200 and the ingest count when fully configured', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    mockHasDbAccess.mockReturnValue(true);
    mockHasSubgraphAccess.mockReturnValue(true);
    mockIngestRav.mockResolvedValue({ ingested: 3, durationMs: 11 });

    const { GET } = await import('@/app/api/cron/ingest-rav/route');
    const res = await GET(authedRequest('/api/cron/ingest-rav'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, ingested: 3 });
    expect(mockIngestRav).toHaveBeenCalledWith(expect.anything(), { backfill: false });
    vi.unstubAllEnvs();
  });

  it('passes ?backfill=1 through to the resumable historical pull', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    mockHasDbAccess.mockReturnValue(true);
    mockHasSubgraphAccess.mockReturnValue(true);
    const { GET } = await import('@/app/api/cron/ingest-rav/route');
    await GET(authedRequest('/api/cron/ingest-rav?backfill=1'));
    expect(mockIngestRav).toHaveBeenCalledWith(expect.anything(), { backfill: true });
    vi.unstubAllEnvs();
  });

  it('500s when the ingest throws', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    mockHasDbAccess.mockReturnValue(true);
    mockHasSubgraphAccess.mockReturnValue(true);
    mockIngestRav.mockRejectedValue(new Error('escrow subgraph down'));

    const { GET } = await import('@/app/api/cron/ingest-rav/route');
    const res = await GET(authedRequest('/api/cron/ingest-rav'));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/RAV ingestion failed/);
    vi.unstubAllEnvs();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('/api/horizon/debug — auth guard', () => {
  it('returns 401 when CRON_SECRET not set', async () => {
    vi.unstubAllEnvs();
    const { GET } = await import('@/app/api/horizon/debug/route');
    const res = await GET(makeRequest('/api/horizon/debug'));
    expect(res.status).toBe(401);
  });

  it('returns 401 with no Authorization header', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    const { GET } = await import('@/app/api/horizon/debug/route');
    const res = await GET(makeRequest('/api/horizon/debug'));
    expect(res.status).toBe(401);
    vi.unstubAllEnvs();
  });

  it('returns 401 with wrong token', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    const { GET } = await import('@/app/api/horizon/debug/route');
    const res = await GET(makeRequest('/api/horizon/debug', { Authorization: 'Bearer wrong' }));
    expect(res.status).toBe(401);
    vi.unstubAllEnvs();
  });

  it('returns 200 (or non-401) with correct token', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    vi.stubEnv('AMP_ENDPOINT', '');
    const { GET } = await import('@/app/api/horizon/debug/route');
    const res = await GET(authedRequest('/api/horizon/debug'));
    // Not 401 — auth passed. Result depends on AMP_ENDPOINT availability.
    expect(res.status).not.toBe(401);
    vi.unstubAllEnvs();
  });
});
