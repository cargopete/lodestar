/**
 * The nest probe.
 *
 * The case that earns this file is `a_nest_that_answers_but_has_stopped_indexing`: an "ok" from a
 * running process says nothing about whether it is still following the chain, and a nest serving
 * three-week-old data breaks nothing visibly — every page renders, every number is wrong. That is
 * why the probe asks `/ready` for the nest's own verdict rather than inferring one from a 200.
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

/** Reimported per test because the module reads env at load. */
async function load() {
  return import('../nest-health');
}

function stubFetch(handler: (url: string) => { status: number; body: unknown } | 'throw' | 'timeout') {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const r = handler(String(url));
      if (r === 'throw') throw new Error('connect ECONNREFUSED');
      if (r === 'timeout') {
        const e = new Error('timed out');
        e.name = 'TimeoutError';
        throw e;
      }
      return {
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        json: async () => r.body,
      } as unknown as Response;
    })
  );
}

/**
 * The exact body a live nest returned on 2026-08-29, captured rather than invented.
 *
 * Every other test here asserts the parser against a shape I made up, which proves only that it is
 * self-consistent. This one is the shape the thing on the other end actually sends, so if nuthatch
 * renames a field the probe stops reporting lag and starts reporting `undefined` — and that would
 * be invisible without this.
 */
const REAL_READY = {
  entities: [],
  entities_stalled: false,
  initial_poll_failed: false,
  lag_blocks: 2,
  last_block: 499688636,
  last_poll_unixtime: 1788027779,
  ready: true,
  seal_direct_active: false,
  seal_direct_completed: 0,
  seal_direct_origin: 0,
  seal_direct_stalled: false,
  seal_direct_target: 0,
  sealed_through: 499685543,
  seconds_since_poll: 0,
  stalled: false,
  tip: 499688638,
  wedged: false,
};

describe('against the response a real nest actually sends', () => {
  it('parses it without inventing or dropping anything', async () => {
    stubFetch(() => ({ status: 200, body: REAL_READY }));
    const { probeNest } = await load();
    expect(await probeNest('staking', 'Horizon staking', '')).toEqual({
      id: 'staking',
      label: 'Horizon staking',
      ready: true,
      reason: undefined,
      tip: 499688638,
      lastBlock: 499688636,
      lagBlocks: 2,
    });
  });

  it('prefers the nest own lag_blocks over recomputing it', async () => {
    // Deliberately inconsistent: if the probe subtracts, it gets 2 and this fails.
    stubFetch(() => ({ status: 200, body: { ...REAL_READY, lag_blocks: 9999 } }));
    const { probeNest } = await load();
    expect((await probeNest('a', 'A', '')).lagBlocks).toBe(9999);
  });

  it.each([
    ['initial_poll_failed', { initial_poll_failed: true }, /never reached the chain/],
    ['wedged', { wedged: true }, /wedged/],
    ['stalled', { stalled: true }, /no longer following the chain/],
    ['entities_stalled', { entities_stalled: true }, /derived entity/],
  ])('turns %s into a diagnosis rather than a shrug', async (_name, patch, matcher) => {
    stubFetch(() => ({ status: 503, body: { ...REAL_READY, ready: false, ...patch } }));
    const { probeNest } = await load();
    const r = await probeNest('a', 'A', '');
    expect(r.ready).toBe(false);
    expect(r.reason).toMatch(matcher);
  });
});

describe('probeNest', () => {
  it('reports a healthy nest with its lag', async () => {
    stubFetch(() => ({ status: 200, body: { ready: true, tip: 500, last_block: 497 } }));
    const { probeNest } = await load();
    const r = await probeNest('staking', 'Horizon staking', '');
    expect(r).toMatchObject({ id: 'staking', ready: true, tip: 500, lastBlock: 497, lagBlocks: 3 });
  });

  it('asks the right path for a nest behind a base path', async () => {
    const seen: string[] = [];
    stubFetch((url) => {
      seen.push(url);
      return { status: 200, body: { ready: true } };
    });
    const { probeNest } = await load();
    await probeNest('dips', 'DIPS', '/dips');
    expect(seen[0]).toBe(`${ORIGIN}/dips/ready`);
  });

  // The whole point. A 200 from a process that stopped indexing must not read as healthy.
  it('believes the nest when it says it is not ready, even on a 200', async () => {
    stubFetch(() => ({ status: 200, body: { ready: false, tip: 500, last_block: 100 } }));
    const { probeNest } = await load();
    const r = await probeNest('staking', 'Horizon staking', '');
    expect(r.ready).toBe(false);
    expect(r.lagBlocks).toBe(400);
  });

  // `/ready` answers 503 *with a body*, and the body is the useful part.
  it('reads the explanation out of a 503 rather than discarding it', async () => {
    stubFetch(() => ({
      status: 503,
      body: { ready: false, quarantined: true, reason: 'poll failed', tip: 500, last_block: 400 },
    }));
    const { probeNest } = await load();
    const r = await probeNest('staking', 'Horizon staking', '');
    expect(r.ready).toBe(false);
    expect(r.reason).toContain('quarantined');
    expect(r.reason).toContain('poll failed');
    expect(r.lagBlocks).toBe(100);
  });

  it('treats unreachable and timed out as not ready, and says which', async () => {
    stubFetch(() => 'throw');
    const { probeNest } = await load();
    expect(await probeNest('a', 'A', '')).toMatchObject({ ready: false, reason: 'unreachable' });

    stubFetch(() => 'timeout');
    const { probeNest: p2 } = await load();
    expect(await p2('a', 'A', '')).toMatchObject({ ready: false, reason: 'timed out' });
  });

  it('does not invent a lag when the nest did not report block heights', async () => {
    stubFetch(() => ({ status: 200, body: { ready: true } }));
    const { probeNest } = await load();
    const r = await probeNest('a', 'A', '');
    expect(r.ready).toBe(true);
    expect(r.lagBlocks).toBeUndefined();
  });

  // A nest ahead of its own reported tip is a counter race, not negative lag.
  it('never reports a negative lag', async () => {
    stubFetch(() => ({ status: 200, body: { ready: true, tip: 100, last_block: 105 } }));
    const { probeNest } = await load();
    expect((await probeNest('a', 'A', '')).lagBlocks).toBe(0);
  });

  it('sends basic auth when credentials are configured', async () => {
    let sawAuth: string | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        sawAuth = (init.headers as Record<string, string>)?.Authorization;
        return { ok: true, status: 200, json: async () => ({ ready: true }) } as unknown as Response;
      })
    );
    const { probeNest } = await load();
    await probeNest('a', 'A', '');
    expect(sawAuth).toBe(`Basic ${Buffer.from('u:p').toString('base64')}`);
  });

  it('reports honestly when there is no origin at all rather than pretending health', async () => {
    delete process.env.NUTHATCH_URL;
    vi.resetModules();
    const { probeNest, hasNestOrigin } = await import('../nest-health');
    expect(hasNestOrigin()).toBe(false);
    expect((await probeNest('a', 'A', '')).ready).toBe(false);
  });

  it('probes every dataset it is given', async () => {
    const seen: string[] = [];
    stubFetch((url) => {
      seen.push(url);
      return { status: 200, body: { ready: true } };
    });
    const { probeAllNests } = await load();
    const out = await probeAllNests([
      { id: 'a', label: 'A', basePath: '' },
      { id: 'b', label: 'B', basePath: '/b' },
    ]);
    expect(out).toHaveLength(2);
    expect(seen).toEqual([`${ORIGIN}/ready`, `${ORIGIN}/b/ready`]);
  });
});
