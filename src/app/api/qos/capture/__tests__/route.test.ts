/**
 * GET /api/qos/capture — how allocated stake is distributed across quality bands.
 *
 * The whole reason this route was rewritten is a distinction that is trivial to lose in a fold:
 * an indexer the Lodestar Oracle has not probed is *unmeasured*, not a zero. Collapse the two and
 * the page reports a third of the network as poor-quality stake, confidently, with no way to tell
 * from the output that it is wrong. So the tests below are largely about `rated: false` and a
 * missing address both arriving as `null`, and about the coverage count that admits how little has
 * been measured.
 *
 * The other half is the address casing. The scores come from Foghorn and the allocations from our
 * own table, and the two agree on case by luck. A fold that skips the lowercasing produces a map
 * that is fully populated and never hits, which renders as "we have measured nobody".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const hasDbAccess = vi.fn(() => true);
const db = vi.fn();
vi.mock('@/lib/db', () => ({
  hasDbAccess: () => hasDbAccess(),
  get db() {
    return hasDbAccess() ? (...a: unknown[]) => db(...a) : null;
  },
}));

const computeConcentration = vi.fn();
vi.mock('@/lib/concentration', () => ({
  computeConcentration: (...a: unknown[]) => computeConcentration(...a),
}));

vi.mock('@/lib/cache', () => ({
  cached: (_k: string, _t: number, f: () => Promise<unknown>) => f(),
}));
vi.mock('@/lib/logger', () => ({ log: { api: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } } }));

const mockFetch = vi.fn();

/** The route reads FOGHORN_API_URL at module load, so each variant needs a fresh import. */
async function load(foghornUrl = 'https://foghorn.example') {
  vi.resetModules();
  vi.stubEnv('FOGHORN_API_URL', foghornUrl);
  return (await import('../route')).GET;
}

/** Foghorn's leaderboard, as the route's fetch would return it. */
function scores(indexers: unknown[], { ok = true, status = 200 } = {}) {
  mockFetch.mockResolvedValue({ ok, status, json: async () => ({ indexers }) });
}

/** The rows the folding is judged on. */
const rows = () => computeConcentration.mock.calls.at(-1)![0] as { allocated_grt: number; q_score: number | null }[];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mockFetch);
  hasDbAccess.mockReturnValue(true);
  computeConcentration.mockReturnValue({ gini: 0.4 });
  scores([]);
  db.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('the guards', () => {
  it('503s without a database', async () => {
    hasDbAccess.mockReturnValue(false);
    const GET = await load();
    const res = await GET();
    expect(res.status).toBe(503);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('503s when Foghorn is not configured, rather than reporting nothing measured', async () => {
    const GET = await load('');
    const res = await GET();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/foghorn/i);
  });
});

describe('scoring the allocations', () => {
  it('keeps a rated indexer\'s composite', async () => {
    scores([{ indexer_address: '0xaaa', composite: 87.5, rated: true }]);
    db.mockResolvedValue([{ address: '0xaaa', allocated_grt: 1000 }]);

    const GET = await load();
    await GET();
    expect(rows()).toEqual([{ allocated_grt: 1000, q_score: 87.5 }]);
  });

  it('reports an unrated indexer as unmeasured, not as a zero', async () => {
    // The distinction this route was rewritten for. A composite of 0 on an unrated row would put
    // that stake in the worst band and be indistinguishable from a real finding.
    scores([{ indexer_address: '0xaaa', composite: 0, rated: false }]);
    db.mockResolvedValue([{ address: '0xaaa', allocated_grt: 1000 }]);

    const GET = await load();
    await GET();
    expect(rows()[0].q_score).toBeNull();
  });

  it('reports an indexer Foghorn has never seen as unmeasured', async () => {
    scores([]);
    db.mockResolvedValue([{ address: '0xbbb', allocated_grt: 500 }]);

    const GET = await load();
    await GET();
    expect(rows()[0].q_score).toBeNull();
  });

  it('matches the two sources regardless of address casing', async () => {
    scores([{ indexer_address: '0xAAAA000000000000000000000000000000000001', composite: 60, rated: true }]);
    db.mockResolvedValue([{ address: '0xaaaa000000000000000000000000000000000001', allocated_grt: 7 }]);

    const GET = await load();
    await GET();
    expect(rows()[0].q_score).toBe(60);
  });
});

describe('the coverage figure', () => {
  it('counts measured against allocated, and says what unscored means', async () => {
    scores([
      { indexer_address: '0xaaa', composite: 90, rated: true },
      { indexer_address: '0xbbb', composite: 10, rated: false },
    ]);
    db.mockResolvedValue([
      { address: '0xaaa', allocated_grt: 100 },
      { address: '0xbbb', allocated_grt: 200 },
      { address: '0xccc', allocated_grt: 300 },
    ]);

    const GET = await load();
    const { data } = await (await GET()).json();

    expect(data.coverage.allocated_indexers).toBe(3);
    expect(data.coverage.measured_indexers).toBe(1);
    expect(data.coverage.note).toMatch(/never measured and found wanting/);
    expect(data.concentration).toEqual({ gini: 0.4 });
  });
});

describe('when a source fails', () => {
  it('500s on a Foghorn error status rather than reporting an empty network', async () => {
    scores([], { ok: false, status: 502 });
    db.mockResolvedValue([{ address: '0xaaa', allocated_grt: 100 }]);

    const GET = await load();
    const res = await GET();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/failed to compute/i);
  });

  it('500s when the allocation query fails', async () => {
    db.mockRejectedValue(new Error('pool exhausted'));
    const GET = await load();
    expect((await GET()).status).toBe(500);
  });
});
