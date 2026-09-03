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
  withServeProbe: (r: Record<string, unknown>, probe: string) => ({ ...r, serveProbe: probe, servable: probe === 'serving' || probe === 'alive_paid' }),
}));
let gatewayVerdict: string | null = 'bad-indexers';
const probeGateway = vi.fn(async (hash: string, probedAt: string) => ({ hash, verdict: gatewayVerdict, servedBlock: gatewayVerdict === 'served' ? 123 : null, badIndexers: [], message: null, probedAt }));
vi.mock('@/lib/gateway-probe', () => ({
  hasGatewayAccess: () => gatewayVerdict !== null,
  probeGateway: (...a: unknown[]) => probeGateway(...(a as [string, string])),
}));
// An in-memory round store with the real module's contract: newest `limit` rows, oldest first.
const rows: Array<{ deploymentHash: string; probedAt: string; servingOperators: number; servingIndexers: number; gatewayVerdict: string | null }> = [];
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

async function round(probe: 'broken' | 'alive_paid' | 'serving', gateway: string | null = 'bad-indexers') {
  probeServing.mockResolvedValueOnce(probe);
  gatewayVerdict = gateway;
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
    const r1 = await round('broken', 'bad-indexers');
    const r2 = await round('broken', 'bad-indexers');
    const r3 = await round('broken', 'bad-indexers');
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
    expect(rows.map((r) => r.gatewayVerdict)).toEqual(['bad-indexers', 'bad-indexers', 'bad-indexers']);
  });

  it('8. a same-round gateway serve makes dead unreachable, renders conflicting, and warns', async () => {
    await round('broken', 'bad-indexers');
    await round('broken', 'bad-indexers');
    const r3 = await round('broken', 'served');
    expect(r3.servabilityRendered).toMatchObject({ state: 'conflicting', effectivelyDead: false, deadStreak: 0 });
    expect(r3.gatewayVerdict).toBe('served');
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ ipfsHash: '0xdeployment', servedBlock: 123 }), expect.stringMatching(/servability conflict/));
    // and it reset the streak: one more dead round is rechecking, not dead
    const r4 = await round('broken', 'bad-indexers');
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

  it('decides on persistence alone when no gateway key allows a gateway witness', async () => {
    await round('broken', null); await round('broken', null);
    const r3 = await round('broken', null);
    expect(probeGateway).not.toHaveBeenCalled();
    expect(r3.gatewayVerdict).toBeNull();
    expect(r3.servabilityRendered.state).toBe('dead');
  });
});
