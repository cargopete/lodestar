/**
 * Serving must ask `/ready` before `/sql`. A 200 with stale rows is the failure this exists to stop.
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

async function load() {
  return import('../nuthatch');
}

function stub(handler: (url: string) => { status: number; body: unknown }) {
  const seen: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      seen.push(String(url));
      const r = handler(String(url));
      return {
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        json: async () => r.body,
      } as unknown as Response;
    }),
  );
  return seen;
}

const READY = {
  ready: true,
  lag_blocks: 1,
  tip: 10,
  last_block: 9,
  sealed_through: 5,
  stalled: false,
  wedged: false,
};

const ROWS = {
  count: 1,
  rows: [{ id: 'a' }],
  provenance: { as_of: 9, sealed_through: 5 },
};

describe('nuthatchSqlReady', () => {
  it('refuses to query when the nest is not ready', async () => {
    const seen = stub((url) => {
      if (url.endsWith('/ready')) {
        return { status: 503, body: { ...READY, ready: false, stalled: true } };
      }
      return { status: 200, body: ROWS };
    });
    const { nuthatchSqlReady } = await load();
    const r = await nuthatchSqlReady('SELECT 1');
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected failure');
    expect(r.status).toBe(503);
    expect(r.error).toMatch(/not ready/);
    expect(r.reason).toMatch(/stalled/);
    expect(seen.some((u) => u.includes('/sql'))).toBe(false);
  });

  it('queries and returns provenance when the nest is ready', async () => {
    stub((url) => {
      if (url.endsWith('/ready')) return { status: 200, body: READY };
      return { status: 200, body: ROWS };
    });
    const { nuthatchSqlReady } = await load();
    const r = await nuthatchSqlReady('SELECT 1');
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('expected success');
    expect(r.data.rows).toEqual([{ id: 'a' }]);
    expect(r.data.provenance).toEqual({ as_of: 9, sealed_through: 5 });
  });

  it('skips /ready for an archival nest', async () => {
    const seen = stub((url) => {
      if (url.endsWith('/ready')) {
        return { status: 503, body: { ready: false, stalled: true } };
      }
      return { status: 200, body: ROWS };
    });
    const { nuthatchSqlReady } = await load();
    const r = await nuthatchSqlReady('SELECT 1', '/legacy-flows', { requireReady: false });
    expect(r.ok).toBe(true);
    expect(seen.some((u) => u.includes('/ready'))).toBe(false);
    expect(seen.some((u) => u.includes('/sql'))).toBe(true);
  });
});
