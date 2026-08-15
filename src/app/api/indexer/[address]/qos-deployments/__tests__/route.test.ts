/**
 * Contract tests for the QoS deployment breakdown — the endpoint that makes a score
 * explainable. The case it was built for: one deployment carrying most of an indexer's
 * traffic and failing, while everything else it serves is healthy.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockDb = vi.fn();
const mockHasDbAccess = vi.fn(() => true);

vi.mock('@/lib/cache', () => ({
  cached: vi.fn((_key: string, _ttl: number, fetcher: () => Promise<unknown>) => fetcher()),
}));
vi.mock('@/lib/db', () => ({
  get db() { return mockHasDbAccess() ? ((...a: unknown[]) => mockDb(...a)) : null; },
  hasDbAccess: () => mockHasDbAccess(),
}));
vi.mock('@/lib/logger', () => ({
  log: { api: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

import { GET } from '../route';

const ADDR = '0x8cc22436ba6f07a4d5dd2043e3109267eee5aab8';
const PEER = '0xf92f430dd8567b0d466358c79594ab58d919a6d4';
const call = (addr = ADDR) =>
  GET(new NextRequest(`http://localhost/api/indexer/${addr}/qos-deployments`), {
    params: Promise.resolve({ address: addr }),
  });

const today = Math.floor(Date.now() / 86400000) - 18613;
const qosRow = (o: Record<string, unknown>) => ({
  indexer_address: ADDR, deployment_id: 'QmBusy', day_number: today,
  query_count: 1000, success_count: 1000, avg_latency_ms: 200,
  blocks_behind: 10, chain_id: 'arbitrum-one', ...o,
});

describe('GET /api/indexer/[address]/qos-deployments', () => {
  beforeEach(() => {
    mockDb.mockReset();
    mockHasDbAccess.mockReturnValue(true);
  });

  it('rejects a malformed address', async () => {
    const res = await call('not-an-address');
    expect(res.status).toBe(400);
  });

  it('says the database is unconfigured rather than pretending there is no data', async () => {
    mockHasDbAccess.mockReturnValue(false);
    expect((await call()).status).toBe(503);
  });

  it('returns an empty breakdown when the indexer has no rows in the window', async () => {
    mockDb.mockResolvedValue([]);
    const { data } = await (await call()).json();
    expect(data.deployments).toEqual([]);
    expect(data.total).toBeNull();
  });

  it('ranks the deployment dragging the score to the top', async () => {
    mockDb.mockResolvedValue([
      // The one failing: most of the traffic, almost none of it succeeding.
      qosRow({ deployment_id: 'QmBroken', query_count: 4731, success_count: 45 }),
      qosRow({ deployment_id: 'QmFine', query_count: 544, success_count: 540 }),
      qosRow({ deployment_id: 'QmAlsoFine', query_count: 512, success_count: 512 }),
    ]);

    const { data } = await (await call()).json();
    expect(data.deployments[0].deployment_id).toBe('QmBroken');
    expect(data.deployments[0].drag).toBeGreaterThan(0.5);
    expect(data.deployments[0].weight).toBeGreaterThan(0.8); // volume-weighted, as the score is
    expect(data.deployments[0].reliability).toBeLessThan(0.05);
    expect(data.total.q_score).toBeLessThan(30);
  });

  it('reports a deployment with no published success figure as unmeasured, not failed', async () => {
    mockDb.mockResolvedValue([
      qosRow({ deployment_id: 'QmSilent', query_count: 800, success_count: null }),
      qosRow({ deployment_id: 'QmFine', query_count: 1000, success_count: 1000 }),
    ]);

    const { data } = await (await call()).json();
    const silent = data.deployments.find((d: { deployment_id: string }) => d.deployment_id === 'QmSilent');
    expect(silent.measured).toBe(false);
    expect(silent.reliability).toBeNull();
    expect(silent.weight).toBe(0);
    expect(data.total.unmeasured_deployments).toBe(1);
  });

  it('carries the cohort figure so a subgraph broken for everyone can be told apart', async () => {
    // Four indexers on one deployment, none of them managing better than ~60%.
    const peers = ['0xb', '0xc', PEER].map((ix, i) =>
      qosRow({ indexer_address: ix, deployment_id: 'QmBroken', query_count: 5000, success_count: [3000, 2500, 1000][i] }),
    );
    mockDb.mockResolvedValue([
      qosRow({ deployment_id: 'QmBroken', query_count: 5000, success_count: 2900 }),
      ...peers,
    ]);

    const { data } = await (await call()).json();
    const broken = data.deployments[0];
    expect(broken.cohort_best_reliability).toBeGreaterThan(0.5);
    // Graded against what the cohort proves is achievable, this indexer is near the best of them.
    expect(broken.reliability_used).toBeGreaterThan(broken.reliability);
  });
});
