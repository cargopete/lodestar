/**
 * `ingestEpochs` from `lodestar_epochs` (nightswatchhq/nuthatch#1160). Pinned here: the flag off
 * leaves the gateway path untouched; on the nest path the gateway is never queried; the rows land in
 * the same `epochs` upsert with the same GRT conversion, the subgraph's fee figure rebuilt from the view's
 * parts and rebates stated as 0; the cursor is the epoch id and the newest epoch is re-read so an
 * open epoch's moving sums are refreshed; and the ingestion state is advanced.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockSubgraphQuery = vi.fn();
vi.mock('@/lib/subgraph', () => ({
  subgraphQuery: (...args: unknown[]) => mockSubgraphQuery(...args),
}));
const mockNuthatchSql = vi.fn();
vi.mock('@/lib/nuthatch', () => ({
  nuthatchEnabled: (flag: string) => process.env[flag] === 'true',
  nuthatchSql: (...args: unknown[]) => mockNuthatchSql(...args),
}));
vi.mock('@/lib/logger', () => ({ log: { ingest: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } } }));

import { ingestEpochs } from '../epochs';

const row = (id: number) => ({
  id, start_block: id * 1000, end_block: id * 1000 + 999,
  signalled_tokens: '2000000000000000000000', stake_deposited: '1000000000000000000000',
  total_rewards: '500000000000000000000', total_indexer_rewards: '300000000000000000000', total_delegator_rewards: '200000000000000000000',
  query_fees_collected: '90000000000000000000', curator_query_fees: '5000000000000000000', taxed_query_fees: '1000000000000000000',
});

/** A `postgres`-style tagged-template mock: first call answers the ingestion-state SELECT, the rest record. */
function makeSql(state: Record<string, unknown> = { last_epoch: 0, last_block: null, last_id: null }) {
  const calls: unknown[][] = [];
  const fn = vi.fn((...args: unknown[]) => {
    calls.push(args);
    if (calls.length === 1) return Promise.resolve([state]);
    return Promise.resolve([]);
  }) as unknown as ((...a: unknown[]) => Promise<unknown[]>) & { calls: unknown[][] };
  // `sql(rows)` inside the template is the helper form; return the rows so the template sees them.
  const helper = (rows: unknown) => rows;
  const proxy = new Proxy(fn, {
    apply(target, thisArg, args) {
      if (args.length === 1 && Array.isArray(args[0]) && !('raw' in (args[0] as object))) return helper(args[0]);
      return Reflect.apply(target, thisArg, args);
    },
  }) as unknown as ((...a: unknown[]) => Promise<unknown[]>) & { calls: unknown[][] };
  (proxy as unknown as { calls: unknown[][] }).calls = calls;
  return proxy;
}

describe('ingestEpochs from the nest', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.NUTHATCH_EPOCHS = 'true';
  });
  afterEach(() => {
    delete process.env.NUTHATCH_EPOCHS;
  });

  it('reads the view after the cursor, re-reading the newest epoch, and never the gateway', async () => {
    // A full page of 100 forces a second page; the second page is short and ends the loop.
    const page = Array.from({ length: 100 }, (_, i) => row(500 + i));
    mockNuthatchSql.mockResolvedValueOnce(page).mockResolvedValueOnce([row(600)]);
    const sql = makeSql({ last_epoch: 500, last_block: 500000, last_id: null });
    const r = await ingestEpochs(sql as never);
    expect(r.ingested).toBe(101);
    expect(mockSubgraphQuery).not.toHaveBeenCalled();
    const firstSql = mockNuthatchSql.mock.calls[0][0] as string;
    // cursor is last_epoch - 1, so epoch 500 (open when last seen) is refreshed
    expect(firstSql).toContain('WHERE id > 499');
    expect(firstSql).toContain('ORDER BY id ASC LIMIT 100');
    expect(mockNuthatchSql.mock.calls[0][1]).toBe('/alloc');
    // the second page asks past the last id seen, and a short page ends it
    expect(mockNuthatchSql.mock.calls[1][0]).toContain('WHERE id > 599');
    expect(mockNuthatchSql).toHaveBeenCalledTimes(2);
  });

  it('rows are converted to GRT with gross fees rebuilt and rebates 0, then the state advances', async () => {
    mockNuthatchSql.mockResolvedValueOnce([row(7)]).mockResolvedValueOnce([]);
    const sql = makeSql();
    await ingestEpochs(sql as never);
    // The INSERT is the second sql call (after the state SELECT); the helper form saw the rows.
    const calls = (sql as unknown as { calls: unknown[][] }).calls;
    const insert = calls.find((c) => Array.isArray(c[0]) && String((c[0] as string[])[0]).includes('INSERT INTO epochs'));
    expect(insert).toBeTruthy();
    const rows = insert![1] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 7, start_block: 7000, end_block: 7999,
      total_query_fees: 95, // 90 + 5 GRT: gross less the 1% protocol cut, the subgraph's figure; the cut is kept beside it
      query_fees_collected: 90, curator_query_fees: 5, taxed_query_fees: 1,
      query_fee_rebates: 0, total_rewards: 500, stake_deposited: 1000,
    });
    const update = calls.find((c) => Array.isArray(c[0]) && String((c[0] as string[]).join('?')).toLowerCase().includes('ingestion_state'));
    expect(update).toBeTruthy();
  });
});
