/**
 * RAV redemption ingestion.
 *
 * Query-fee revenue. The failure modes worth pinning are the ones that produce a plausible number
 * rather than an error: counting escrow deposits as revenue would inflate it, dropping the overlap
 * window would lose late-arriving rows near the cursor boundary and nobody would ever see the gap,
 * and advancing the cursor past rows that were never written would make that loss permanent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DbClient } from '../../db';

const getIngestionState = vi.fn();
const updateIngestionState = vi.fn();
const subgraphQuery = vi.fn();

vi.mock('../../db', () => ({
  getIngestionState: (...a: unknown[]) => getIngestionState(...a),
  updateIngestionState: (...a: unknown[]) => updateIngestionState(...a),
}));
vi.mock('../../subgraph', () => ({
  subgraphQuery: (...a: unknown[]) => subgraphQuery(...a),
}));
vi.mock('../../logger', () => ({
  log: { ingest: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

import { ingestRav } from '../rav';

/**
 * A postgres.js-shaped tag. Called as a template it answers a queued result set; called as a
 * function it is the value helper, `sql(rows)`, so both uses in the module under test work.
 */
function makeSql(queue: unknown[][] = []) {
  let i = 0;
  const queries: { text: string; values: unknown[] }[] = [];
  const fn = ((...args: unknown[]) => {
    const first = args[0];
    if (Array.isArray(first) && 'raw' in (first as object)) {
      queries.push({ text: (first as string[]).join('?'), values: args.slice(1) });
      return Promise.resolve(queue[i++] ?? []);
    }
    return { embedded: first };
  }) as unknown as DbClient & {
    queries: { text: string; values: unknown[] }[];
  };
  (fn as unknown as { queries: unknown }).queries = queries;
  return fn as DbClient & { queries: { text: string; values: unknown[] }[] };
}

/** Pull the rows handed to an INSERT via the `sql(slice)` value helper. */
function insertedRows(sql: { queries: { text: string; values: unknown[] }[] }) {
  return sql.queries
    .filter((q) => q.text.includes('INSERT INTO rav_redemptions'))
    .flatMap((q) => (q.values[0] as { embedded: Record<string, unknown>[] }).embedded);
}

const GRT = '1000000000000000000';

function tx(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'tx1',
    type: 'redeem',
    payer: { id: '0xPAYER' },
    receiver: { id: '0xINDEXER' },
    allocationId: '0xALLOC',
    amount: GRT,
    timestamp: '1756000000',
    ...over,
  };
}

/** Answer the paged query with these pages in order, then an empty one. */
function pages(...ps: unknown[][]) {
  subgraphQuery.mockReset();
  for (const p of ps) subgraphQuery.mockResolvedValueOnce({ paymentsEscrowTransactions: p });
  subgraphQuery.mockResolvedValue({ paymentsEscrowTransactions: [] });
}

beforeEach(() => {
  getIngestionState.mockReset().mockResolvedValue({ last_block: 0 });
  updateIngestionState.mockReset().mockResolvedValue(undefined);
  subgraphQuery.mockReset();
});

describe('ingestRav', () => {
  it('keeps redemptions and drops escrow deposits', async () => {
    // Deposits are money going in, not revenue. Counting them would overstate query fees.
    pages([tx({ id: 'a', type: 'redeem' }), tx({ id: 'b', type: 'deposit' })]);
    const sql = makeSql([[]]);

    const r = await ingestRav(sql);

    expect(r.ingested).toBe(1);
    expect(insertedRows(sql).map((x) => x.id)).toEqual(['a']);
  });

  it('drops a redemption with no receiver rather than writing a null indexer', async () => {
    pages([tx({ id: 'a', receiver: null })]);
    const sql = makeSql();
    expect((await ingestRav(sql)).ingested).toBe(0);
    expect(insertedRows(sql)).toEqual([]);
  });

  it('re-scans an overlap window on a delta run so boundary rows are not lost', async () => {
    getIngestionState.mockResolvedValue({ last_block: 1_756_000_000 });
    pages([tx()]);
    await ingestRav(makeSql([[]]));

    // 3600s of overlap. Upserts make the repeat harmless; not re-scanning would not be.
    expect(subgraphQuery.mock.calls[0][0]).toContain('timestamp_gte: "1755996400"');
  });

  it('reads from the beginning on a backfill', async () => {
    getIngestionState.mockResolvedValue({ last_block: 1_756_000_000 });
    pages([tx()]);
    await ingestRav(makeSql([[]]), { backfill: true });
    expect(subgraphQuery.mock.calls[0][0]).not.toContain('timestamp_gte');
  });

  it('pages on id and stops on a short page', async () => {
    pages([tx({ id: 'a' }), tx({ id: 'b' })]);
    await ingestRav(makeSql([[]]));

    expect(subgraphQuery).toHaveBeenCalledTimes(1);
    expect(subgraphQuery.mock.calls[0][0]).not.toContain('id_gt');
  });

  it('carries the id cursor into the next page when a page comes back full', async () => {
    const full = Array.from({ length: 1000 }, (_, i) => tx({ id: `id${String(i).padStart(4, '0')}` }));
    pages(full, [tx({ id: 'last' })]);
    await ingestRav(makeSql([[], [], []]));

    expect(subgraphQuery.mock.calls[1][0]).toContain('id_gt: "id0999"');
  });

  it('advances the cursor to the highest timestamp seen', async () => {
    pages([tx({ id: 'a', timestamp: '100' }), tx({ id: 'b', timestamp: '900' })]);
    await ingestRav(makeSql([[]]));
    expect(updateIngestionState).toHaveBeenCalledWith(expect.anything(), 'rav', { last_block: 900 });
  });

  it('advances the cursor on non-revenue rows too, so deposits do not stall it', async () => {
    pages([tx({ id: 'a', type: 'deposit', timestamp: '900' })]);
    await ingestRav(makeSql());
    expect(updateIngestionState).toHaveBeenCalledWith(expect.anything(), 'rav', { last_block: 900 });
  });

  it('leaves the cursor alone when nothing newer arrived', async () => {
    getIngestionState.mockResolvedValue({ last_block: 5000 });
    pages([tx({ timestamp: '4000' })]);
    await ingestRav(makeSql([[]]));
    expect(updateIngestionState).not.toHaveBeenCalled();
  });

  it('resolves deployment_id from the allocations table', async () => {
    pages([tx({ id: 'a', allocationId: '0xAllocOne' })]);
    const sql = makeSql([[{ id: '0xallocone', deployment_id: 'QmDeploy' }], []]);

    await ingestRav(sql);

    expect(insertedRows(sql)[0]).toMatchObject({
      allocation_id: '0xallocone',
      deployment_id: 'QmDeploy',
    });
  });

  it('leaves deployment_id null when the allocation is unknown, rather than failing the run', async () => {
    pages([tx({ id: 'a', allocationId: '0xUnknown' })]);
    const sql = makeSql([[], []]);
    await ingestRav(sql);
    expect(insertedRows(sql)[0].deployment_id).toBeNull();
  });

  it('leaves allocation and deployment null when the redemption names no allocation', async () => {
    pages([tx({ id: 'a', allocationId: null })]);
    const sql = makeSql([[]]);
    await ingestRav(sql);

    expect(insertedRows(sql)[0]).toMatchObject({ allocation_id: null, deployment_id: null });
    // No allocation ids to resolve, so the lookup query is skipped entirely.
    expect(sql.queries.some((q) => q.text.includes('FROM allocations'))).toBe(false);
  });

  it('lower-cases indexer, payer and allocation before writing them', async () => {
    // These are primary keys and join keys on both sides. Mixed case silently fails to match.
    pages([tx({ id: 'a' })]);
    const sql = makeSql([[], []]);
    await ingestRav(sql);

    expect(insertedRows(sql)[0]).toMatchObject({
      indexer_address: '0xindexer',
      payer: '0xpayer',
      allocation_id: '0xalloc',
    });
  });

  it('converts wei to GRT and stamps the collection time from the unix timestamp', async () => {
    pages([tx({ id: 'a', amount: '2500000000000000000', timestamp: '1756000000' })]);
    const sql = makeSql([[], []]);
    await ingestRav(sql);

    const row = insertedRows(sql)[0];
    expect(Number(row.tokens_grt)).toBeCloseTo(2.5, 9);
    expect(row.collected_at).toBe(new Date(1_756_000_000_000).toISOString());
    expect(row).toMatchObject({ source: 'graphtally', chain_id: 42161, block: null });
  });

  it('chunks large batches rather than sending one enormous insert', async () => {
    const many = Array.from({ length: 450 }, (_, i) => tx({ id: `id${i}` }));
    pages(many);
    const sql = makeSql([[], [], [], []]);

    const r = await ingestRav(sql);

    expect(r.ingested).toBe(450);
    const inserts = sql.queries.filter((q) => q.text.includes('INSERT INTO rav_redemptions'));
    expect(inserts).toHaveLength(3); // 200 + 200 + 50
  });

  it('does nothing at all when the source returns no transactions', async () => {
    pages([]);
    const sql = makeSql();
    expect((await ingestRav(sql)).ingested).toBe(0);
    expect(sql.queries).toEqual([]);
    expect(updateIngestionState).not.toHaveBeenCalled();
  });

  it('treats a missing cursor as a full read rather than crashing', async () => {
    getIngestionState.mockResolvedValue({});
    pages([tx()]);
    await ingestRav(makeSql([[], []]));
    expect(subgraphQuery.mock.calls[0][0]).not.toContain('timestamp_gte');
  });
});
