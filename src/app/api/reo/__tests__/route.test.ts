/**
 * Tests for /api/reo — Rewards Eligibility Oracle endpoint.
 *
 * The oracle's `isEligible` bool is the sole source of truth. There is no
 * heuristic fallback: when the oracle read fails the route reports an explicit
 * "unavailable" (status: 'unknown', available: false) state rather than
 * fabricating an eligibility verdict.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const checkOracleEligibility = vi.fn();
vi.mock('@/lib/reo-contract', () => ({
  checkOracleEligibility: (...a: unknown[]) => checkOracleEligibility(...a),
}));
vi.mock('@/lib/cache', () => ({
  // cached() only stores on success — mirror that: run the fetcher, propagate throws.
  cached: vi.fn((_k: string, _t: number, f: () => unknown) => f()),
}));
vi.mock('@/lib/logger', () => ({ log: { api: { warn: vi.fn(), error: vi.fn() } } }));

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
    expect(json.status.available).toBe(true);
    expect(json.status.status).toBe('eligible');
    expect(json.status.isEligible).toBe(true);
    expect(json.status.daysRemaining).toBe(7.5);
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
    expect(json.status.available).toBe(true);
  });
});

describe('/api/reo oracle unavailable', () => {
  it('reports unknown/unavailable when the oracle read fails — no heuristic guess', async () => {
    checkOracleEligibility.mockRejectedValueOnce(new Error('rpc down'));
    const GET = await load();
    const res = await call(GET, ADDR);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status.source).toBe('oracle');
    expect(json.status.available).toBe(false);
    expect(json.status.status).toBe('unknown');
    expect(json.status.isEligible).toBe(false);
    // Never a fabricated eligible/ineligible verdict, and address is lowercased.
    expect(json.status.address).toBe(ADDR.toLowerCase());
  });
});
