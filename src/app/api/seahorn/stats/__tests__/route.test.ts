/**
 * Tests for /api/seahorn/stats — fans out three parallel fetches to the
 * dispatch gateway and aggregates total / finalized / latest_slot /
 * unique_wallets. Covers the happy path, partial non-ok responses, and the
 * 502 catch when a fetch rejects. All fetches are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

async function load() {
  const mod = await import('@/app/api/seahorn/stats/route');
  return mod.GET as () => Promise<Response>;
}

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe('seahorn stats', () => {
  it('aggregates total, finalized, latest_slot and unique wallets', async () => {
    // route fires fetches in this order: maxId, recent(200), final
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('commitment_status=eq.FINAL')) {
        return jsonResponse([{ id: 900 }]);
      }
      if (url.includes('limit=200')) {
        return jsonResponse([
          { slot: 555, fields: { user: 'walletA' } },
          { slot: 554, fields: { user: 'walletB' } },
          { slot: 553, fields: { user: 'walletA' } }, // dupe
          { slot: 552, fields: null }, // null filtered out
        ]);
      }
      // maxId
      return jsonResponse([{ id: 1000 }]);
    });

    const GET = await load();
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      total: 1000,
      finalized: 900,
      latest_slot: 555,
      unique_wallets: 2,
    });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('defaults fields to zero when responses are empty or non-ok', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('limit=200')) {
        // non-ok recent response -> latest_slot/unique_wallets stay 0
        return jsonResponse([], 500);
      }
      // empty arrays for the id queries
      return jsonResponse([]);
    });

    const GET = await load();
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      total: 0,
      finalized: 0,
      latest_slot: 0,
      unique_wallets: 0,
    });
  });

  it('returns 502 when a fetch rejects', async () => {
    mockFetch.mockRejectedValue(new Error('gateway unreachable'));
    const GET = await load();
    const res = await GET();
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('gateway unreachable') });
  });
});
