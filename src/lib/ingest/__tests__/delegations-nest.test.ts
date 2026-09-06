/**
 * `ingestDelegationEvents` from `lodestar_delegations` (nuthatch#1160). The gateway path left with the
 * key; this is now the only path, and it had no test of its own. Pinned: the cursor is the stored
 * timestamp; rows are lower-cased, converted to GRT and stamped as ISO times; inserts are chunked at
 * two hundred; a full page advances the cursor to the last complete second and asks again, a short
 * page ends the run; and the ingestion state advances only when something was written.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockNuthatchSql = vi.fn();
vi.mock('@/lib/nuthatch', () => ({
  nuthatchSql: (...args: unknown[]) => mockNuthatchSql(...args),
}));
vi.mock('@/lib/logger', () => ({ log: { ingest: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } } }));

import { ingestDelegationEvents } from '../delegations';

const row = (i: number, over: Partial<Record<string, unknown>> = {}) => ({
  id: `0xTX-${i}`,
  event_type: 'delegation',
  indexer: '0xINDEXER',
  delegator: '0xDELEGATOR',
  tokens: '2500000000000000000000',
  timestamp: 1_700_000_000 + i,
  ...over,
});

/** A `postgres`-style tagged-template mock: first call answers the ingestion-state SELECT, the rest record. */
function makeSql(state: Record<string, unknown> = { last_block: 0, last_epoch: null, last_id: null }) {
  const calls: unknown[][] = [];
  const fn = vi.fn((...args: unknown[]) => {
    calls.push(args);
    if (calls.length === 1) return Promise.resolve([state]);
    return Promise.resolve([]);
  });
  // `sql(rows)` and `sql({ set })` inside a template are the helper form; hand the value back so the
  // template sees it, and record it so a test can read what was set.
  const helper = (v: unknown) => {
    calls.push([v]);
    return v;
  };
  const proxy = new Proxy(fn, {
    apply(target, thisArg, args) {
      if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null && !('raw' in (args[0] as object))) return helper(args[0]);
      return Reflect.apply(target, thisArg, args);
    },
  }) as unknown as ((...a: unknown[]) => Promise<unknown[]>) & { calls: unknown[][] };
  (proxy as unknown as { calls: unknown[][] }).calls = calls;
  return proxy;
}

const calls = (sql: unknown) => (sql as { calls: unknown[][] }).calls;
/** The rows handed to each `INSERT INTO delegation_events` (the helper form records the array). */
const inserts = (sql: unknown) => {
  const cs = calls(sql);
  return cs.filter((c, i) => Array.isArray(c[0]) && 'raw' in (c[0] as object) && String((c[0] as string[])[0]).includes('INSERT INTO delegation_events') && i > 0)
    .map((c) => cs[cs.indexOf(c) - 1][0] as unknown[]);
};
/** The `SET` object handed to `UPDATE ingestion_state`, or undefined when no update ran. */
const stateSet = (sql: unknown) =>
  calls(sql).find((c) => c.length === 1 && typeof c[0] === 'object' && c[0] !== null && !Array.isArray(c[0]) && 'updated_at' in (c[0] as object))?.[0] as
    | Record<string, unknown>
    | undefined;

describe('ingestDelegationEvents from the nest', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('asks the view after the stored timestamp, on /alloc, and writes nothing when it is empty', async () => {
    mockNuthatchSql.mockResolvedValueOnce([]);
    const sql = makeSql({ last_block: 1_699_999_000, last_epoch: null, last_id: null });
    const r = await ingestDelegationEvents(sql as never);
    expect(r.ingested).toBe(0);
    expect(mockNuthatchSql).toHaveBeenCalledTimes(1);
    const [q, base] = mockNuthatchSql.mock.calls[0];
    expect(q).toContain('FROM lodestar_delegations');
    expect(q).toContain('WHERE timestamp > 1699999000');
    expect(q).toContain('ORDER BY timestamp ASC, id ASC LIMIT 1000');
    expect(base).toBe('/alloc');
    expect(inserts(sql)).toHaveLength(0);
    // The state is still touched, so a health check can tell "ran and found nothing" from "stuck" -
    // but the cursor is left alone.
    const set = stateSet(sql);
    expect(set).toBeTruthy();
    expect(set).not.toHaveProperty('last_block');
  });

  it('lower-cases addresses, converts wei to GRT, stamps ISO times, and advances the cursor to the last second', async () => {
    mockNuthatchSql.mockResolvedValueOnce([row(1), row(2, { event_type: 'undelegation', tokens: '1000000000000000000' })]);
    const sql = makeSql();
    const r = await ingestDelegationEvents(sql as never);
    expect(r.ingested).toBe(2);
    const ins = inserts(sql);
    expect(ins).toHaveLength(1);
    const rows = ins[0] as Array<Record<string, unknown>>;
    expect(rows[0]).toEqual({
      id: '0xTX-1',
      event_type: 'delegation',
      delegator: '0xdelegator',
      indexer: '0xindexer',
      tokens_grt: 2500,
      timestamp: new Date(1_700_000_001 * 1000).toISOString(),
    });
    expect(rows[1]).toMatchObject({ event_type: 'undelegation', tokens_grt: 1 });
    // A short page ends the run and the cursor is the whole last second.
    expect(mockNuthatchSql).toHaveBeenCalledTimes(1);
    expect(stateSet(sql)).toMatchObject({ last_block: 1_700_000_002 });
  });

  it('chunks a large page into inserts of two hundred', async () => {
    mockNuthatchSql.mockResolvedValueOnce(Array.from({ length: 450 }, (_, i) => row(i)));
    const sql = makeSql();
    const r = await ingestDelegationEvents(sql as never);
    expect(r.ingested).toBe(450);
    expect(inserts(sql).map((rows) => rows.length)).toEqual([200, 200, 50]);
  });

  it('a full page asks again from the last complete second, and a short page ends it', async () => {
    const full = Array.from({ length: 1000 }, (_, i) => row(i));
    mockNuthatchSql.mockResolvedValueOnce(full).mockResolvedValueOnce([row(2000)]);
    const sql = makeSql();
    const r = await ingestDelegationEvents(sql as never);
    expect(r.ingested).toBe(1001);
    expect(mockNuthatchSql).toHaveBeenCalledTimes(2);
    // Last timestamp of the full page is 1_700_000_999; the cursor holds back one second so an
    // event sharing that second on the next page is not skipped.
    expect(mockNuthatchSql.mock.calls[1][0]).toContain('WHERE timestamp > 1700000998');
    expect(stateSet(sql)).toMatchObject({ last_block: 1_700_002_000 });
  });

  it('a full page whose last second is behind the cursor still moves the cursor forward by one', async () => {
    // Every row in the same second as the cursor + 1: `last - 1` would be the cursor itself and the
    // loop would re-ask the same page forever; `max(cursor + 1, last - 1)` is what stops that.
    const same = Array.from({ length: 1000 }, (_, i) => row(i, { timestamp: 1_700_000_001 }));
    mockNuthatchSql.mockResolvedValueOnce(same).mockResolvedValueOnce([]);
    const sql = makeSql({ last_block: 1_700_000_000, last_epoch: null, last_id: null });
    await ingestDelegationEvents(sql as never);
    expect(mockNuthatchSql.mock.calls[1][0]).toContain('WHERE timestamp > 1700000001');
  });
});
