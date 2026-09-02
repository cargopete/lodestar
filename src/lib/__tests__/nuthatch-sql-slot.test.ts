/**
 * The `/sql` concurrency gate.
 *
 * A nest caps concurrent queries and refuses the rest with `503 server busy: too many concurrent
 * SQL queries`. Measured against both dips nests on 2026-09-02, that cap is **two**. This was not
 * theoretical: `/api/dips/agreements` fired nine reads in one `Promise.all` and had consequently
 * never worked against a nest with rows, and `/api/dips` still fires four.
 *
 * The gate lives in `nuthatch.ts` rather than at the call sites, so what these tests pin is that
 * no composition a caller can write gets past it — and, just as importantly, the three ways a gate
 * like this goes wrong:
 *
 *  - a leaked slot. If a thrown request does not release, the nest is unreachable from this
 *    process for ever after, and the symptom is a hang rather than an error.
 *  - retrying the wrong 503. An unready nest answers 503 too, and sitting in a backoff loop over
 *    that is #1080 again with extra latency.
 *
 * A third failure, the handover race, is **not** covered here and that is deliberate rather than an
 * oversight. Releasing the slot and letting the woken waiter re-check leaves a microtask window in
 * which a continuation queued earlier takes the slot and the waiter then takes it too. The window
 * is real — mutating the release to that form and running this whole file passes — but reaching it
 * needs a caller arriving from a microtask chain of exactly the right depth, and a test tuned to
 * that depth stops testing anything the first time the call path gains or loses an `await`, without
 * saying so. The implementation avoids the window by construction instead: see `withSqlSlot`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ORIGIN = 'https://nest.example';

beforeEach(() => {
  vi.resetModules();
  process.env.NUTHATCH_URL = ORIGIN;
  process.env.NUTHATCH_USER = 'u';
  process.env.NUTHATCH_PASSWORD = 'p';
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NUTHATCH_URL;
  delete process.env.NUTHATCH_USER;
  delete process.env.NUTHATCH_PASSWORD;
});

const load = () => import('../nuthatch');

interface Reply {
  status: number;
  body: unknown;
  /** Hold the request open until this is resolved, so overlap can be observed. */
  hold?: Promise<void>;
}

/**
 * A fetch stub that records the peak number of `/sql` requests in flight at once, per nest.
 * `/ready` always answers ready, since readiness is not what this file is about.
 */
function stubNest(reply: (url: string, call: number) => Reply) {
  const state = {
    peak: new Map<string, number>(),
    active: new Map<string, number>(),
    sqlCalls: 0,
    urls: [] as string[],
  };

  const nestOf = (url: string) => {
    const path = url.slice(ORIGIN.length);
    return path.startsWith('/sql') ? '' : path.slice(0, path.indexOf('/sql'));
  };

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.includes('/ready')) {
        return { ok: true, status: 200, json: async () => ({ ready: true, stalled: false }) };
      }

      state.urls.push(url);
      const nest = nestOf(url);
      const now = (state.active.get(nest) ?? 0) + 1;
      state.active.set(nest, now);
      state.peak.set(nest, Math.max(state.peak.get(nest) ?? 0, now));

      const r = reply(url, ++state.sqlCalls);
      if (r.hold) await r.hold;
      else await new Promise((res) => setTimeout(res, 1));

      state.active.set(nest, (state.active.get(nest) ?? 1) - 1);
      return { ok: r.status < 400, status: r.status, json: async () => r.body };
    })
  );

  return state;
}

const rows = (n = 1) => ({ count: n, rows: Array.from({ length: n }, (_, i) => ({ i })) });
const BUSY = { status: 503, body: { error: 'server busy: too many concurrent SQL queries' } };

describe('one slot per nest', () => {
  it('never lets two queries reach the same nest at once, however they are composed', async () => {
    const nest = stubNest(() => ({ status: 200, body: rows() }));
    const { nuthatchSqlReady } = await load();

    // The shape that broke `/api/dips/agreements`: nine reads, fired together.
    const results = await Promise.all(
      Array.from({ length: 9 }, (_, i) => nuthatchSqlReady(`SELECT ${i}`, '/dips'))
    );

    expect(results.every((r) => r.ok)).toBe(true);
    expect(nest.peak.get('/dips')).toBe(1);
    expect(nest.sqlCalls).toBe(9);
  });

  it('runs every query, in the order it was asked for', async () => {
    const nest = stubNest(() => ({ status: 200, body: rows() }));
    const { nuthatchSqlReady } = await load();

    await Promise.all([0, 1, 2, 3].map((i) => nuthatchSqlReady(`SELECT ${i}`, '/dips')));

    const asked = nest.urls.map((u) => decodeURIComponent(u).match(/SELECT (\d)/)![1]);
    expect(asked).toEqual(['0', '1', '2', '3']);
  });

  it('gates each nest separately, so a slow DIPS read does not block GNS', async () => {
    // The nests are separate processes on separate ports with separate caps. One gate across all
    // of them would be safe and needlessly slow.
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));

    const nest = stubNest((url) =>
      url.includes('/dips/') ? { status: 200, body: rows(), hold: held } : { status: 200, body: rows() }
    );
    const { nuthatchSqlReady } = await load();

    const slow = nuthatchSqlReady('SELECT 1', '/dips');
    const fast = await nuthatchSqlReady('SELECT 1', '/gns');

    expect(fast.ok).toBe(true);
    release();
    expect((await slow).ok).toBe(true);
    expect(nest.peak.get('/gns')).toBe(1);
  });
});

describe('releasing the slot', () => {
  it('releases it when a request throws, rather than wedging the nest for ever', async () => {
    // A leaked slot is the worst outcome available here: every later query waits on a promise
    // nothing will resolve, and the symptom is a hang, not an error.
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/ready')) {
          return { ok: true, status: 200, json: async () => ({ ready: true, stalled: false }) };
        }
        if (++calls === 1) throw new Error('ECONNRESET');
        return { ok: true, status: 200, json: async () => rows() };
      })
    );

    const { nuthatchSqlReady } = await load();

    await expect(nuthatchSqlReady('SELECT 1', '/dips')).rejects.toThrow('ECONNRESET');

    const after = await nuthatchSqlReady('SELECT 2', '/dips');
    expect(after.ok).toBe(true);
  });

  it('releases it when the nest refuses, not only when it answers', async () => {
    const nest = stubNest((_u, call) =>
      call === 1 ? { status: 400, body: { error: 'no such column: tokns' } } : { status: 200, body: rows() }
    );
    const { nuthatchSqlReady } = await load();

    const bad = await nuthatchSqlReady('SELECT tokns', '/dips');
    const good = await nuthatchSqlReady('SELECT 1', '/dips');

    expect(bad.ok).toBe(false);
    expect(good.ok).toBe(true);
    expect(nest.peak.get('/dips')).toBe(1);
  });

  it('holds under a sustained burst arriving from varied microtask depths', async () => {
    const nest = stubNest(() => ({ status: 200, body: rows() }));
    const { nuthatchSqlReady } = await load();

    const pending: Promise<unknown>[] = [];
    const atDepth = (depth: number, i: number) => {
      let chain = Promise.resolve();
      for (let d = 0; d < depth; d++) chain = chain.then(() => undefined);
      return chain.then(() => nuthatchSqlReady(`SELECT ${i}`, '/dips'));
    };

    for (let round = 0; round < 4; round++) {
      for (let depth = 0; depth < 8; depth++) pending.push(atDepth(depth, round * 8 + depth));
      await new Promise((r) => setTimeout(r, 0));
    }
    await Promise.all(pending);

    expect(nest.sqlCalls).toBe(32);
    expect(nest.peak.get('/dips')).toBe(1);
  });
});

describe('backpressure', () => {
  it('retries a busy refusal and succeeds', async () => {
    // Our own gate takes one slot, so a busy answer means somebody else holds the others — another
    // serverless instance, the SQL playground, the health check. Backing off is the right reply.
    const nest = stubNest((_u, call) => (call <= 2 ? BUSY : { status: 200, body: rows() }));
    const { nuthatchSqlReady } = await load();

    const res = await nuthatchSqlReady('SELECT 1', '/dips');

    expect(res.ok).toBe(true);
    expect(nest.sqlCalls).toBe(3);
  });

  it('gives up after a bounded number of attempts, in the nest\'s own words', async () => {
    const nest = stubNest(() => BUSY);
    const { nuthatchSqlReady } = await load();

    const res = await nuthatchSqlReady('SELECT 1', '/dips');

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unreachable');
    expect(res.status).toBe(503);
    // "server busy" and "nest is not ready" are different diagnoses; flattening them costs the
    // next person the answer.
    expect(res.error).toMatch(/too many concurrent/);
    expect(nest.sqlCalls).toBe(4);
  });

  it('does not retry an unready nest, which answers 503 for an entirely different reason', async () => {
    // #1080: an unready nest must surface immediately. Retrying it would delay the error a page is
    // waiting on, and the answer would not have changed.
    const nest = stubNest(() => ({
      status: 503,
      body: { error: 'nest is not ready: stalled' },
    }));
    const { nuthatchSqlFull } = await load();

    const res = await nuthatchSqlFull('SELECT 1', '/dips');

    expect(res.ok).toBe(false);
    expect(nest.sqlCalls).toBe(1);
  });

  it('does not retry a query error', async () => {
    const nest = stubNest(() => ({ status: 400, body: { error: 'no such table: nope' } }));
    const { nuthatchSqlFull } = await load();

    await nuthatchSqlFull('SELECT * FROM nope', '/dips');
    expect(nest.sqlCalls).toBe(1);
  });
});

describe('nuthatchSql on the shared path', () => {
  it('returns the rows and goes through the same gate', async () => {
    const nest = stubNest(() => ({ status: 200, body: rows(2) }));
    const { nuthatchSql } = await load();

    const out = await Promise.all([nuthatchSql('SELECT 1'), nuthatchSql('SELECT 2')]);

    expect(out[0]).toHaveLength(2);
    expect(nest.peak.get('')).toBe(1);
  });

  it('throws with the nest\'s message rather than a bare status', async () => {
    stubNest(() => ({ status: 400, body: { error: 'no such column: tokns' } }));
    const { nuthatchSql } = await load();

    await expect(nuthatchSql('SELECT tokns')).rejects.toThrow(/no such column: tokns/);
  });

  it('returns an empty array for a query that matched nothing', async () => {
    stubNest(() => ({ status: 200, body: { count: 0 } }));
    const { nuthatchSql } = await load();

    expect(await nuthatchSql('SELECT 1')).toEqual([]);
  });
});
