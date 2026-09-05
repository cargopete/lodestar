/**
 * RFC-006 D5 at the route (lodestar#59): the rendered state comes from persisted rounds, never
 * from the round just probed. A one-indexer deployment is driven through sequences of probe
 * outcomes and the response is read after each round, with the cache busted between calls.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/cache', () => ({
  cached: vi.fn((_k: string, _t: number, f: () => Promise<unknown>) => f()),
}));
vi.mock('@/lib/subgraph', () => ({
  hasSubgraphAccess: () => true,
  subgraphQuery: vi.fn(async () => ({
    allocations: [
      {
        indexer: { id: '0xonlyindexer', url: 'https://indexer.example', account: { defaultDisplayName: 'Only', metadata: null } },
        allocatedTokens: '1000000000000000000000',
      },
    ],
  })),
}));
const probeServing = vi.fn();
vi.mock('@/lib/indexing-status', () => ({
  queryIndexerStatus: vi.fn(async () => null),
  buildIndexerStatus: vi.fn((id: string, name: string | null, url: string, allocated: string) => ({
    indexerId: id, indexerName: name, url, allocatedTokens: allocated, status: 'synced',
  })),
  reconcileToNetworkHead: vi.fn((xs: unknown[]) => xs),
  probeServing: (...a: unknown[]) => probeServing(...a),
  // The route takes the detailed form; a `broken` here is a timed-out transport, everything else a 402.
  probeServingDetailed: async (...a: unknown[]) => {
    const probe = (await probeServing(...a)) as string;
    const broken = probe === 'broken';
    return { probe, cause: broken ? 'transport' : 'response', error: broken ? 'timeout' : null, status: broken ? null : 402, contentType: broken ? null : 'text/plain', paid: false, attempts: broken ? 2 : 1, elapsedMs: 7 };
  },
  withServeProbe: (r: Record<string, unknown>, probe: string | { probe: string }) => {
    const verdict = typeof probe === 'string' ? probe : probe.probe;
    return { ...r, serveProbe: verdict, ...(typeof probe === 'string' ? {} : { serveProbeDetail: probe }), servable: verdict === 'serving' || verdict === 'alive_paid' };
  },
}));
// An in-memory round store with the real module's contract: newest `limit` rows, oldest first.
const rows: Array<{ deploymentHash: string; probedAt: string; servingOperators: number; servingIndexers: number; gatewayVerdict: string | null; probes?: unknown[] }> = [];
let dbUp = true;
vi.mock('@/lib/db', () => ({
  hasDbAccess: () => dbUp,
  get db() { return dbUp ? {} : null; },
}));
vi.mock('@/lib/servability-rounds', () => ({
  recordRound: vi.fn(async (_db: unknown, r: (typeof rows)[number]) => { rows.push({ ...r }); }),
  recentRounds: vi.fn(async (_db: unknown, hash: string, limit: number) =>
    rows.filter((r) => r.deploymentHash === hash).slice(-limit).map(({ probedAt, servingOperators, servingIndexers, gatewayVerdict: gv }) => ({ probedAt, servingOperators, servingIndexers, gatewayVerdict: gv }))),
}));
const warn = vi.fn();
vi.mock('@/lib/logger', () => ({ log: { api: { info: vi.fn(), warn: (...a: unknown[]) => warn(...a), error: vi.fn() } } }));

import { GET } from '../[hash]/route';

async function round(probe: 'broken' | 'alive_paid' | 'serving') {
  probeServing.mockResolvedValueOnce(probe);
  const res = await GET(new NextRequest('http://localhost/api/indexing-status/0xdeployment'), { params: Promise.resolve({ hash: '0xdeployment' }) });
  expect(res.status).toBe(200);
  const { data } = await res.json();
  return data as { servability: { effectivelyDead: boolean }; servabilityRendered: { state: string; effectivelyDead: boolean; deadStreak: number; k: number; probedAt: string }; gatewayVerdict: string | null };
}

describe('indexing-status route applies D5 persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rows.length = 0;
    dbUp = true;
    vi.stubEnv('SERVABILITY_DEAD_ROUNDS', '3');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('13. one timeout then two healthy rounds never renders dead; round one is rechecking', async () => {
    const r1 = await round('broken');
    expect(r1.servability.effectivelyDead).toBe(true); // the instantaneous read, unchanged
    expect(r1.servabilityRendered).toMatchObject({ state: 'rechecking', effectivelyDead: false, deadStreak: 1, k: 3 });
    const r2 = await round('alive_paid');
    expect(r2.servabilityRendered).toMatchObject({ state: 'ok', effectivelyDead: false, deadStreak: 0 });
    const r3 = await round('alive_paid');
    expect(r3.servabilityRendered.effectivelyDead).toBe(false);
    for (const r of [r1, r2, r3]) expect(r.servabilityRendered.effectivelyDead).toBe(false);
  });

  it('14. three refused rounds with the gateway agreeing: round three is the first rendered dead', async () => {
    const r1 = await round('broken');
    const r2 = await round('broken');
    const r3 = await round('broken');
    expect([r1, r2].map((r) => r.servabilityRendered.state)).toEqual(['rechecking', 'rechecking']);
    expect(r3.servabilityRendered).toMatchObject({ state: 'dead', effectivelyDead: true, deadStreak: 3 });
  });

  it('15. every round is persisted, with probed_at strictly increasing', async () => {
    await round('broken'); await round('alive_paid'); await round('broken');
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.deploymentHash === '0xdeployment')).toBe(true);
    const ts = rows.map((r) => Date.parse(r.probedAt));
    expect(ts[0] <= ts[1] && ts[1] <= ts[2]).toBe(true);
    expect(rows.map((r) => r.servingOperators)).toEqual([0, 1, 0]);
    expect(rows.map((r) => r.gatewayVerdict)).toEqual([null, null, null]);
  });

  it('8. a persisted gateway-served round still resets the streak, though no new round records one', async () => {
    // The gateway is no longer probed (nuthatch#1160); rounds recorded while it was keep their verdict
    // and the persistence rule still reads a served round as the stronger witness.
    await round('broken');
    await round('broken');
    rows.push({ deploymentHash: '0xdeployment', probedAt: new Date().toISOString(), servingOperators: 0, servingIndexers: 0, gatewayVerdict: 'served' });
    const r4 = await round('broken');
    expect(r4.gatewayVerdict).toBeNull();
    expect(r4.servabilityRendered).toMatchObject({ state: 'rechecking', deadStreak: 1 });
  });

  it('carries probedAt so the banner can say how old the verdict is', async () => {
    const r = await round('alive_paid');
    expect(Date.parse(r.servabilityRendered.probedAt)).toBeGreaterThan(0);
  });

  it('renders rechecking, never dead, when the round store is unavailable', async () => {
    dbUp = false;
    for (let i = 0; i < 4; i += 1) {
      const r = await round('broken');
      expect(r.servabilityRendered).toMatchObject({ state: 'rechecking', effectivelyDead: false, deadStreak: 1 });
    }
    expect(rows).toHaveLength(0);
  });

  it('decides on persistence alone: three dead rounds are dead, and no gateway is asked', async () => {
    await round('broken'); await round('broken');
    const r3 = await round('broken');
    expect(r3.gatewayVerdict).toBeNull();
    expect(r3.servabilityRendered.state).toBe('dead');
  });

  it('lodestar#62: the record carries what each probe saw, not just the count', async () => {
    await round('broken');
    expect(rows).toHaveLength(1);
    expect(rows[0].probes).toEqual([
      expect.objectContaining({ indexerId: '0xonlyindexer', url: 'https://indexer.example', probe: 'broken', cause: 'transport', error: 'timeout', attempts: 2 }),
    ]);
  });
});
