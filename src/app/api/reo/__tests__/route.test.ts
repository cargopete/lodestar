/**
 * Tests for /api/reo — Rewards Eligibility Oracle endpoint.
 * Covers address validation, oracle path (eligible/ineligible), heuristic
 * fallback (eligible / ineligible / indexer-not-found), and the catch-all.
 *
 * GRAPH_API_KEY must be set at import time so the route's internal
 * SUBGRAPH_URL is non-null and the heuristic fetch path is active.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

process.env.GRAPH_API_KEY = 'test-key';

const checkOracleEligibility = vi.fn();
vi.mock('@/lib/reo-contract', () => ({
  checkOracleEligibility: (...a: unknown[]) => checkOracleEligibility(...a),
}));
vi.mock('@/lib/cache', () => ({
  cached: vi.fn((_k: string, _t: number, f: () => unknown) => f()),
}));
vi.mock('@/lib/logger', () => ({ log: { api: { warn: vi.fn(), error: vi.fn() } } }));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const ADDR = '0x1234567890ABCDEF1234567890ABCDEF12345678';

async function load() {
  const mod = await import('@/app/api/reo/route');
  return mod.GET as (req: NextRequest) => Promise<Response>;
}

function call(GET: Awaited<ReturnType<typeof load>>, address?: string) {
  const url = address
    ? `http://localhost/api/reo?address=${address}`
    : 'http://localhost/api/reo';
  return GET(new NextRequest(url));
}

// Helper to enqueue subgraph fetch responses (indexer, poi, provisions order)
function gql(data: unknown) {
  return () => Promise.resolve(new Response(JSON.stringify({ data }), { status: 200 }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('/api/reo validation', () => {
  it('400 when address missing', async () => {
    const GET = await load();
    const res = await call(GET);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/address parameter required/i);
  });
});

describe('/api/reo oracle path', () => {
  it('returns eligible from oracle', async () => {
    checkOracleEligibility.mockResolvedValueOnce({
      address: ADDR.toLowerCase(),
      isEligible: true,
      renewalTimestamp: 1700000000,
      eligibilityPeriod: 1209600,
      expiresAt: 1701209600,
      daysRemaining: 7.5,
    });
    const GET = await load();
    const res = await call(GET, ADDR);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status.source).toBe('oracle');
    expect(json.status.status).toBe('eligible');
    expect(json.status.isEligible).toBe(true);
    expect(json.status.daysRemaining).toBe(7.5);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns ineligible from oracle', async () => {
    checkOracleEligibility.mockResolvedValueOnce({
      address: ADDR.toLowerCase(),
      isEligible: false,
      renewalTimestamp: 1700000000,
      eligibilityPeriod: 1209600,
      expiresAt: 1701209600,
      daysRemaining: -2,
    });
    const GET = await load();
    const res = await call(GET, ADDR);
    const json = await res.json();
    expect(json.status.status).toBe('ineligible');
    expect(json.status.isEligible).toBe(false);
  });
});

describe('/api/reo heuristic fallback', () => {
  it('eligible when stake/allocations/POIs all pass', async () => {
    checkOracleEligibility.mockRejectedValueOnce(new Error('rpc down'));
    // Promise.all order: indexer, allocations(poi), provisions
    mockFetch
      .mockImplementationOnce(
        gql({ indexer: { stakedTokens: '200000000000000000000000', allocationCount: 5, allocatedTokens: '1' } }),
      )
      .mockImplementationOnce(gql({ allocations: [{ id: 'a1', poi: '0xpoi' }] }))
      .mockImplementationOnce(gql({ provisions: [{ id: 'p1', tokensProvisioned: '1' }] }));
    const GET = await load();
    const res = await call(GET, ADDR);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status.source).toBe('heuristic');
    expect(json.status.status).toBe('eligible');
    expect(json.status.isEligible).toBe(true);
    expect(json.status.checks.hasSufficientStake).toBe(true);
    expect(json.status.reasons).toEqual([]);
  });

  it('ineligible when stake below threshold', async () => {
    checkOracleEligibility.mockRejectedValueOnce(new Error('rpc down'));
    mockFetch
      .mockImplementationOnce(
        gql({ indexer: { stakedTokens: '1000000000000000000', allocationCount: 5, allocatedTokens: '1' } }),
      )
      .mockImplementationOnce(gql({ allocations: [{ id: 'a1', poi: '0xpoi' }] }))
      .mockImplementationOnce(gql({ provisions: [] }));
    const GET = await load();
    const res = await call(GET, ADDR);
    const json = await res.json();
    expect(json.status.source).toBe('heuristic');
    expect(json.status.isEligible).toBe(false);
    expect(json.status.status).toBe('ineligible');
    expect(json.status.checks.hasSufficientStake).toBe(false);
    expect(json.status.reasons).toContain('Stake below 100K GRT');
    expect(json.status.reasons).toContain('No Horizon service provisions');
  });

  it('unknown when indexer not found', async () => {
    checkOracleEligibility.mockRejectedValueOnce(new Error('rpc down'));
    mockFetch
      .mockImplementationOnce(gql({ indexer: null }))
      .mockImplementationOnce(gql({ allocations: [] }))
      .mockImplementationOnce(gql({ provisions: [] }));
    const GET = await load();
    const res = await call(GET, ADDR);
    const json = await res.json();
    expect(json.status.status).toBe('unknown');
    expect(json.status.isEligible).toBe(false);
    expect(json.status.reasons).toContain('Indexer not found');
    // address is lowercased
    expect(json.status.address).toBe(ADDR.toLowerCase());
  });

  it('handles subgraph non-ok responses gracefully (treated as no data -> unknown)', async () => {
    checkOracleEligibility.mockRejectedValueOnce(new Error('rpc down'));
    mockFetch
      .mockImplementationOnce(() => Promise.resolve(new Response('err', { status: 500 })))
      .mockImplementationOnce(() => Promise.resolve(new Response('err', { status: 500 })))
      .mockImplementationOnce(() => Promise.resolve(new Response('err', { status: 500 })));
    const GET = await load();
    const res = await call(GET, ADDR);
    const json = await res.json();
    expect(json.status.status).toBe('unknown');
  });
});
