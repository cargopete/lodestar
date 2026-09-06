/**
 * The Horizon activity cron from two nests (nightswatchhq/nuthatch#1078). What is worth pinning:
 * the flag off changes nothing; the flag on never consults the gateway key, which is the whole point
 * of the switch; an unready nest refuses the run rather than caching a stale page; and the merged
 * feed is the newest twenty-five across both sources with a provision carrying its real transaction.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const cacheSet = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/cache', () => ({
  cacheSet: (...a: unknown[]) => cacheSet(...a),
  cacheGet: vi.fn().mockResolvedValue(null),
}));
const hasSubgraphAccess = vi.fn(() => false);
const subgraphQuery = vi.fn();
const delegationEventsQuery = vi.fn();
vi.mock('@/lib/subgraph', () => ({
  hasSubgraphAccess: () => hasSubgraphAccess(),
  subgraphQuery: (...a: unknown[]) => subgraphQuery(...a),
  delegationEventsQuery: (...a: unknown[]) => delegationEventsQuery(...a),
}));
const nuthatchSqlReady = vi.fn();
let nuthatchConfigured = true;
vi.mock('@/lib/nuthatch', () => ({
  hasNuthatch: () => nuthatchConfigured,
  nuthatchEnabled: (flag: string) => nuthatchConfigured && process.env[flag] === 'true',
  nuthatchSqlReady: (...a: unknown[]) => nuthatchSqlReady(...a),
}));
vi.mock('@/lib/logger', () => ({
  log: { cron: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

import { GET } from '../route';

const req = () =>
  new NextRequest('http://localhost/api/cron/ingest-horizon-activity', {
    headers: { authorization: 'Bearer test-secret' },
  });

const ok = (rows: unknown[]) => ({ ok: true, data: { count: rows.length, rows, truncated: false } });
const delegation = (i: number, ts: number) => ({
  id: `0xtx${i}-${i}`,
  eventType: i % 3 === 0 ? 'withdrawal' : i % 2 === 0 ? 'undelegation' : 'delegation',
  indexer: '0xABC0000000000000000000000000000000000001',
  delegator: '0xDEF0000000000000000000000000000000000002',
  tokens: '1000000000000000000000',
  timestamp: String(ts),
  txHash: `0x${String(i).padStart(64, '0')}`,
});
const provision = (i: number, ts: number) => ({
  tx_hash: `0x${String(900 + i).padStart(64, '0')}`,
  log_index: i,
  block_number: 496000000 + i,
  block_timestamp: ts,
  indexer: '0xf123e51b8e0a371cc538323470bb9668f6802a6f',
  verifier: '0xb2bb92d0de618878e438b55d5846cfecd9301105',
  tokens: '100000000000000000000000',
});

describe('ingest-horizon-activity from the nests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CRON_SECRET', 'test-secret');
    vi.stubEnv('NUTHATCH_HORIZON_ACTIVITY', 'true');
    nuthatchConfigured = true;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('never consults the gateway key on the nest path', async () => {
    nuthatchSqlReady.mockResolvedValueOnce(ok([])).mockResolvedValueOnce(ok([]));
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(hasSubgraphAccess).not.toHaveBeenCalled();
    expect(subgraphQuery).not.toHaveBeenCalled();
    expect(delegationEventsQuery).not.toHaveBeenCalled();
  });

  it('refuses when no nest origin is configured rather than silently falling back', async () => {
    nuthatchConfigured = false;
    // With no origin the flag helper reports false, so the route takes the gateway path and its
    // own key gate answers; either way nothing is cached and no nest is asked.
    const res = await GET(req());
    expect(res.status).toBe(503);
    expect(cacheSet).not.toHaveBeenCalled();
    expect(nuthatchSqlReady).not.toHaveBeenCalled();
  });

  it('reads delegation events from the staking nest and provisions from the horizon nest', async () => {
    nuthatchSqlReady
      .mockResolvedValueOnce(ok([delegation(1, 1000)]))
      .mockResolvedValueOnce(ok([provision(1, 2000)]));
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, count: 2, source: 'nuthatch' });
    const [delegationCall, provisionCall] = nuthatchSqlReady.mock.calls;
    expect(String(delegationCall[0])).toMatch(/staking__tokens_delegated/);
    expect(String(delegationCall[0])).toMatch(/LIMIT 20$/);
    expect(delegationCall[1]).toBe('/alloc');
    expect(String(provisionCall[0])).toMatch(/staking__provision_created/);
    expect(String(provisionCall[0])).toMatch(/LIMIT 10$/);
    expect(provisionCall[1]).toBe('/alloc');
  });

  it('caches the newest twenty-five across both sources, with a provision carrying its transaction and block', async () => {
    const delegations = Array.from({ length: 20 }, (_, i) => delegation(i, 5000 - i));
    const provisions = Array.from({ length: 10 }, (_, i) => provision(i, 4990 - i * 2));
    nuthatchSqlReady.mockResolvedValueOnce(ok(delegations)).mockResolvedValueOnce(ok(provisions));
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(cacheSet).toHaveBeenCalledTimes(1);
    const [key, events, ttl] = cacheSet.mock.calls[0] as [string, Array<Record<string, unknown>>, number];
    expect(key).toBe('horizon:activity:25');
    expect(ttl).toBe(300);
    expect(events).toHaveLength(25);
    const stamps = events.map((e) => e.timestamp as number);
    expect([...stamps].sort((a, b) => b - a)).toEqual(stamps);
    expect(events[0]).toMatchObject({ type: 'withdrawn', timestamp: 5000, serviceProvider: '0xabc0000000000000000000000000000000000001' });
    const prov = events.find((e) => e.type === 'provision')!;
    expect(prov).toMatchObject({
      txHash: provisions[0].tx_hash,
      block: 496000000,
      timestamp: 4990,
      verifier: '0xb2bb92d0de618878e438b55d5846cfecd9301105',
    });
    // `toGRT` divides a BigInt-cast number by 1e18, which is how the gateway path has always done
    // it, so a round wei amount lands a few ulps under the integer.
    expect(prov.tokensGRT as number).toBeCloseTo(100000, 6);
    expect(events.filter((e) => e.type === 'withdrawn').length).toBeGreaterThan(0);
    expect(events.filter((e) => e.type === 'undelegated').length).toBeGreaterThan(0);
  });

  it('refuses the run and leaves the cache alone when a nest is not ready', async () => {
    nuthatchSqlReady
      .mockResolvedValueOnce(ok([delegation(1, 1000)]))
      .mockResolvedValueOnce({ ok: false, error: 'nest not ready', reason: 'lag', status: 503 });
    const res = await GET(req());
    expect(res.status).toBe(503);
    expect(cacheSet).not.toHaveBeenCalled();
  });

  it('still enforces the cron secret on the nest path', async () => {
    const res = await GET(new NextRequest('http://localhost/api/cron/ingest-horizon-activity'));
    expect(res.status).toBe(401);
    expect(nuthatchSqlReady).not.toHaveBeenCalled();
  });
});
