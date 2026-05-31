/**
 * Tests for /api/cron/check-conversions — Bearer CRON_SECRET auth (via
 * isCronAuthorized), the no-db 503 guard, and the conversion-marking happy
 * path. `db` is a tagged-template fn; we mock it so each invocation pushes a
 * resolved value queue. The Uniswap swaps query goes through fetch, mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// db is a postgres-style tagged template fn: db`...` -> Promise<rows>.
// We script its return values in order via a queue.
const dbQueue: unknown[] = [];
const dbCalls: string[] = [];
let dbEnabled = true;
const dbTag = (strings: TemplateStringsArray, ..._v: unknown[]) => {
  dbCalls.push(strings.join('?'));
  return Promise.resolve(dbQueue.length ? dbQueue.shift() : []);
};
vi.mock('@/lib/db', () => ({
  get db() {
    return dbEnabled ? dbTag : null;
  },
}));

const isCronAuthorized = vi.fn(() => true);
vi.mock('@/lib/cron-auth', () => ({
  isCronAuthorized: (...a: unknown[]) =>
    (isCronAuthorized as (...a: unknown[]) => unknown)(...a),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const SECRET = 'conv-secret';

async function load() {
  const mod = await import('@/app/api/cron/check-conversions/route');
  return mod.POST as (req: NextRequest) => Promise<Response>;
}

function req(auth?: string) {
  return new NextRequest('http://localhost/api/cron/check-conversions', {
    method: 'POST',
    headers: auth ? { authorization: auth } : {},
  });
}

function swapResponse(swaps: unknown[]) {
  return Promise.resolve(
    new Response(JSON.stringify({ data: { swaps } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  dbQueue.length = 0;
  dbCalls.length = 0;
  dbEnabled = true;
  isCronAuthorized.mockReturnValue(true);
  process.env.CRON_SECRET = SECRET;
  process.env.GRAPH_API_KEY = 'test-key';
});

describe('check-conversions auth & guards', () => {
  it('401s when not authorized', async () => {
    isCronAuthorized.mockReturnValue(false);
    const POST = await load();
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: 'unauthorized' });
    expect(dbCalls).toHaveLength(0);
  });

  it('503s when db is unavailable', async () => {
    dbEnabled = false;
    const POST = await load();
    const res = await POST(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, error: 'no db' });
  });
});

describe('check-conversions processing', () => {
  it('marks a pending event as converted when a swap is found', async () => {
    // queue: [0] expire UPDATE, [1] SELECT pending, [2] UPDATE convert
    dbQueue.push([]); // expire update
    dbQueue.push([
      { id: 7, wallet: '0xWALLET', clicked_at: '2026-05-31T00:00:00.000Z' },
    ]); // pending select
    dbQueue.push([]); // convert update

    mockFetch.mockImplementation(() =>
      swapResponse([
        { id: 's1', timestamp: '1730000000', amountUSD: '42.5', transaction: { id: '0xtx' } },
      ]),
    );

    const POST = await load();
    const res = await POST(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, checked: 1, converted: 1 });

    // fetch called once for the one pending event
    expect(mockFetch).toHaveBeenCalledTimes(1);
    // expire + select + convert update = 3 db calls
    expect(dbCalls).toHaveLength(3);
    // wallet is lowercased in the query body
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.query).toContain('0xwallet');
  });

  it('checks but does not convert when no swaps are returned', async () => {
    dbQueue.push([]); // expire
    dbQueue.push([
      { id: 8, wallet: '0xabc', clicked_at: '2026-05-31T00:00:00.000Z' },
    ]); // pending
    mockFetch.mockImplementation(() => swapResponse([]));

    const POST = await load();
    const res = await POST(req(`Bearer ${SECRET}`));
    expect(await res.json()).toEqual({ ok: true, checked: 1, converted: 0 });
    // only expire + select; no convert update
    expect(dbCalls).toHaveLength(2);
  });

  it('returns zero counts when there are no pending events', async () => {
    dbQueue.push([]); // expire
    dbQueue.push([]); // pending = empty

    const POST = await load();
    const res = await POST(req(`Bearer ${SECRET}`));
    expect(await res.json()).toEqual({ ok: true, checked: 0, converted: 0 });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('swallows a swap-query failure: event is neither checked nor converted', async () => {
    dbQueue.push([]); // expire
    dbQueue.push([
      { id: 9, wallet: '0xdef', clicked_at: '2026-05-31T00:00:00.000Z' },
    ]); // pending
    mockFetch.mockRejectedValue(new Error('gateway down'));

    const POST = await load();
    const res = await POST(req(`Bearer ${SECRET}`));
    // the catch increments neither checked nor converted (checked++ is after the await)
    expect(await res.json()).toEqual({ ok: true, checked: 0, converted: 0 });
  });

  it('returns empty swaps (no fetch) when GRAPH_API_KEY is unset', async () => {
    delete process.env.GRAPH_API_KEY;
    dbQueue.push([]); // expire
    dbQueue.push([
      { id: 10, wallet: '0x111', clicked_at: '2026-05-31T00:00:00.000Z' },
    ]); // pending

    const POST = await load();
    const res = await POST(req(`Bearer ${SECRET}`));
    // UNI_V3_URL is null -> querySwapsByWallet returns [] without fetching
    expect(await res.json()).toEqual({ ok: true, checked: 1, converted: 0 });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
