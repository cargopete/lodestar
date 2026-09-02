/**
 * GET /api/apr-provenance/[address] — the "why did my APR change" trail.
 *
 * The route is three independent best-effort sources merged into one answer, and every one of
 * them is wrapped in its own try/catch. That is the right shape and it is also the dangerous one:
 * a swallowed failure looks exactly like a quiet week. So the tests below pin what each partial
 * failure is allowed to cost, and what it must not:
 *
 *  - the on-chain reconcile failing must not discard the event trail, and vice versa
 *  - an ENS lookup failing must leave the delegators as hex rather than dropping the events
 *  - a no-op parameter row (old == new) must not appear at all; the ingest re-detects unchanged
 *    cuts, and "reward cut changed 50% → 50%" is noise wearing the costume of provenance
 *  - the trail is newest-first and capped at 40, because the caller renders it in order
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const hasDbAccess = vi.fn(() => true);
const db = vi.fn();
vi.mock('@/lib/db', () => ({
  hasDbAccess: () => hasDbAccess(),
  db: (...a: unknown[]) => db(...a),
}));

const hasSubgraphAccess = vi.fn(() => true);
const subgraphQuery = vi.fn();
const ensQuery = vi.fn();
vi.mock('@/lib/subgraph', () => ({
  hasSubgraphAccess: () => hasSubgraphAccess(),
  subgraphQuery: (...a: unknown[]) => subgraphQuery(...a),
  ensQuery: (...a: unknown[]) => ensQuery(...a),
}));

const reconcileDelegationPool = vi.fn();
vi.mock('@/lib/staking-pool-contract', () => ({
  reconcileDelegationPool: (...a: unknown[]) => reconcileDelegationPool(...a),
}));

// No cache in the way: every test should see the function it configured.
const cached = vi.fn((_k: string, _t: number, f: () => Promise<unknown>) => f());
vi.mock('@/lib/cache', () => ({
  cached: (...a: unknown[]) => (cached as unknown as (...x: unknown[]) => unknown)(...a),
}));
vi.mock('@/lib/logger', () => ({
  log: { api: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } },
}));

import { GET } from '../route';

const ADDR = '0x0000000000000000000000000000000000000abc';

const req = () => new NextRequest(`http://localhost/api/apr-provenance/${ADDR}`);
const call = (address = ADDR) => GET(req(), { params: Promise.resolve({ address }) });
const body = async (address = ADDR) => (await call(address)).json();

/** Queue the two DB reads the route makes, in the order it makes them. */
function rows(delegation: unknown[], params: unknown[] = []) {
  db.mockResolvedValueOnce(delegation).mockResolvedValueOnce(params);
}

const RECONCILE = { subgraphGRT: 100, chainGRT: 100, driftGRT: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  hasDbAccess.mockReturnValue(true);
  hasSubgraphAccess.mockReturnValue(true);
  subgraphQuery.mockResolvedValue({ indexer: { delegatedTokens: '1', delegatedThawingTokens: '0' } });
  reconcileDelegationPool.mockResolvedValue(RECONCILE);
  ensQuery.mockResolvedValue({ domains: [] });
  cached.mockImplementation((_k: string, _t: number, f: () => Promise<unknown>) => f());
  // The standing default: both reads return nothing. `rows()` queues ahead of it.
  db.mockResolvedValue([]);
});

describe('address validation', () => {
  it('rejects a non-address without touching any source', async () => {
    const res = await call('not-an-address');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/invalid address/i);
    expect(db).not.toHaveBeenCalled();
    expect(subgraphQuery).not.toHaveBeenCalled();
  });

  it('rejects an address of the wrong length', async () => {
    expect((await call('0xabc')).status).toBe(400);
  });

  it('accepts a checksummed address by lowercasing it first', async () => {
    const res = await call('0x0000000000000000000000000000000000000ABC');
    expect(res.status).toBe(200);
    expect(subgraphQuery).toHaveBeenCalledWith(expect.stringContaining(ADDR));
  });
});

describe('the on-chain reconcile', () => {
  it('is included when the subgraph knows the indexer', async () => {
    const { data } = await body();
    expect(data.reconcile).toEqual(RECONCILE);
    expect(reconcileDelegationPool).toHaveBeenCalledWith(ADDR, '1', '0');
  });

  it('defaults a missing delegatedThawingTokens to zero rather than passing undefined on', async () => {
    subgraphQuery.mockResolvedValue({ indexer: { delegatedTokens: '5' } });
    await body();
    expect(reconcileDelegationPool).toHaveBeenCalledWith(ADDR, '5', '0');
  });

  it('is null, not an error, for an indexer the subgraph has never seen', async () => {
    subgraphQuery.mockResolvedValue({ indexer: null });
    const { data } = await body();
    expect(data.reconcile).toBeNull();
    expect(reconcileDelegationPool).not.toHaveBeenCalled();
  });

  it('is skipped entirely when there is no subgraph access', async () => {
    hasSubgraphAccess.mockReturnValue(false);
    const { data } = await body();
    expect(data.reconcile).toBeNull();
    expect(subgraphQuery).not.toHaveBeenCalled();
  });

  it('failing does not cost the event trail', async () => {
    reconcileDelegationPool.mockRejectedValue(new Error('rpc down'));
    rows([{ event_type: 'delegation', delegator: '0xDEL', tokens_grt: '10', timestamp: '2026-01-01T00:00:00Z' }]);

    const { data } = await body();
    expect(data.reconcile).toBeNull();
    expect(data.events).toHaveLength(1);
  });
});

describe('the event trail', () => {
  it('maps the three delegation event types and drops anything else', async () => {
    rows([
      { event_type: 'delegation', delegator: '0xa', tokens_grt: '1', timestamp: '2026-01-04T00:00:00Z' },
      { event_type: 'undelegation', delegator: '0xb', tokens_grt: '2', timestamp: '2026-01-03T00:00:00Z' },
      { event_type: 'withdrawal', delegator: '0xc', tokens_grt: '3', timestamp: '2026-01-02T00:00:00Z' },
      { event_type: 'something_new', delegator: '0xd', tokens_grt: '4', timestamp: '2026-01-01T00:00:00Z' },
    ]);

    const { data } = await body();
    expect(data.events.map((e: { kind: string }) => e.kind)).toEqual([
      'delegation',
      'undelegation',
      'withdrawal',
    ]);
  });

  it('renders a Date timestamp as ISO and a string one unchanged', async () => {
    rows([
      { event_type: 'delegation', delegator: '0xa', tokens_grt: '1', timestamp: new Date('2026-01-02T03:04:05Z') },
      { event_type: 'delegation', delegator: '0xb', tokens_grt: '1', timestamp: '2026-01-01T00:00:00.000Z' },
    ]);

    const { data } = await body();
    expect(data.events[0].timestamp).toBe('2026-01-02T03:04:05.000Z');
    expect(data.events[1].timestamp).toBe('2026-01-01T00:00:00.000Z');
  });

  it('lowercases the delegator and leaves a null amount undefined rather than zero', async () => {
    rows([{ event_type: 'delegation', delegator: '0xAbCd', tokens_grt: null, timestamp: '2026-01-01T00:00:00Z' }]);

    const { data } = await body();
    expect(data.events[0].delegator).toBe('0xabcd');
    // A missing amount must not render as "delegated 0 GRT".
    expect(data.events[0].tokensGRT).toBeUndefined();
  });

  it('keeps only the two cut parameters', async () => {
    rows([], [
      { param_name: 'reward_cut', old_value: 100000, new_value: 200000, created_at: '2026-01-03T00:00:00Z' },
      { param_name: 'query_fee_cut', old_value: null, new_value: 50000, created_at: '2026-01-02T00:00:00Z' },
      { param_name: 'minimum_stake', old_value: 1, new_value: 2, created_at: '2026-01-01T00:00:00Z' },
    ]);

    const { data } = await body();
    expect(data.events.map((e: { kind: string }) => e.kind)).toEqual(['reward_cut', 'query_fee_cut']);
    // A first observation has no previous value; null says that, 0 would claim a change from zero.
    expect(data.events[1].oldValue).toBeNull();
  });

  it('drops a no-op cut change', async () => {
    rows([], [
      { param_name: 'reward_cut', old_value: 500000, new_value: 500000, created_at: '2026-01-02T00:00:00Z' },
      { param_name: 'reward_cut', old_value: 400000, new_value: 500000, created_at: '2026-01-01T00:00:00Z' },
    ]);

    const { data } = await body();
    expect(data.events).toHaveLength(1);
    expect(data.events[0].oldValue).toBe(400000);
  });

  it('merges both sources newest-first', async () => {
    rows(
      [{ event_type: 'delegation', delegator: '0xa', tokens_grt: '1', timestamp: '2026-01-02T00:00:00Z' }],
      [{ param_name: 'reward_cut', old_value: 1, new_value: 2, created_at: '2026-01-03T00:00:00Z' }],
    );

    const { data } = await body();
    expect(data.events.map((e: { kind: string }) => e.kind)).toEqual(['reward_cut', 'delegation']);
  });

  it('caps the trail at 40 entries', async () => {
    rows(
      [],
      Array.from({ length: 60 }, (_, i) => ({
        param_name: 'reward_cut',
        old_value: i,
        new_value: i + 1,
        created_at: new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString(),
      })),
    );

    const { data } = await body();
    expect(data.events).toHaveLength(40);
  });

  it('degrades to an empty trail when the DB throws, keeping the reconcile', async () => {
    db.mockRejectedValue(new Error('pool exhausted'));
    const { data } = await body();
    expect(data.events).toEqual([]);
    expect(data.reconcile).toEqual(RECONCILE);
  });

  it('is skipped when there is no DB access', async () => {
    hasDbAccess.mockReturnValue(false);
    const { data } = await body();
    expect(db).not.toHaveBeenCalled();
    expect(data.events).toEqual([]);
  });
});

describe('the ENS pass', () => {
  it('is not attempted when the trail has no delegators', async () => {
    rows([], [{ param_name: 'reward_cut', old_value: 1, new_value: 2, created_at: '2026-01-01T00:00:00Z' }]);
    await body();
    expect(ensQuery).not.toHaveBeenCalled();
  });

  it('asks once for the distinct delegators, not once per event', async () => {
    rows([
      { event_type: 'delegation', delegator: '0xa', tokens_grt: '1', timestamp: '2026-01-02T00:00:00Z' },
      { event_type: 'undelegation', delegator: '0xa', tokens_grt: '1', timestamp: '2026-01-01T00:00:00Z' },
    ]);

    await body();
    expect(ensQuery).toHaveBeenCalledTimes(1);
    const q = ensQuery.mock.calls[0][0] as string;
    expect(q.match(/"0xa"/g)).toHaveLength(1);
  });

  it('prefers the shortest name when one address resolves several', async () => {
    // ENS lets many names point at one address; the shortest is the one a human recognises.
    rows([{ event_type: 'delegation', delegator: '0xa', tokens_grt: '1', timestamp: '2026-01-01T00:00:00Z' }]);
    ensQuery.mockResolvedValue({
      domains: [
        { name: 'a-very-long-name.eth', resolvedAddress: { id: '0xA' } },
        { name: 'short.eth', resolvedAddress: { id: '0xA' } },
      ],
    });

    const { data } = await body();
    expect(data.events[0].delegatorName).toBe('short.eth');
  });

  it('leaves the delegator unnamed when the lookup fails', async () => {
    rows([{ event_type: 'delegation', delegator: '0xa', tokens_grt: '1', timestamp: '2026-01-01T00:00:00Z' }]);
    ensQuery.mockRejectedValue(new Error('ens down'));

    const { data } = await body();
    expect(data.events).toHaveLength(1);
    expect(data.events[0].delegatorName).toBeNull();
  });

  it('is skipped when there is no subgraph access', async () => {
    hasSubgraphAccess.mockReturnValue(false);
    rows([{ event_type: 'delegation', delegator: '0xa', tokens_grt: '1', timestamp: '2026-01-01T00:00:00Z' }]);

    await body();
    expect(ensQuery).not.toHaveBeenCalled();
  });
});

describe('the response envelope', () => {
  it('carries the 120-second cache header', async () => {
    const res = await call();
    expect(res.headers.get('Cache-Control')).toBe('public, s-maxage=120, stale-while-revalidate=600');
  });

  it('500s when the cache layer itself throws', async () => {
    cached.mockRejectedValueOnce(new Error('redis gone') as never);

    const res = await call();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/failed to compute/i);
  });
});
