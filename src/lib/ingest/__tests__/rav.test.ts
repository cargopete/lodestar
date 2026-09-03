/**
 * RAV redemption ingestion.
 *
 * Query-fee revenue. The failure modes worth pinning are the ones that produce a plausible number
 * rather than an error: counting escrow deposits as revenue would inflate it, dropping the overlap
 * window would lose late-arriving rows near the cursor boundary and nobody would ever see the gap,
 * and advancing the cursor past rows that were never written would make that loss permanent.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
const nuthatchSqlReady = vi.fn();
vi.mock('../../nuthatch', () => ({
  nuthatchEnabled: (flag: string) => process.env[flag] === 'true',
  nuthatchSqlReady: (...a: unknown[]) => nuthatchSqlReady(...a),
}));

import { ingestRav, subgraphEscrowTxId } from '../rav';

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

describe('subgraphEscrowTxId', () => {
  // Real vectors: one transaction on Arbitrum One holding thirteen collections, whose Postgres ids
  // (written by the gateway path) and nest log indices were matched by amount, 13 of 13.
  const tx = '0x2ddfa4e9ed5f9800062f3570a95fcd2dc0f5f2dfe0a75ee1551a2c734bb5e3df';
  it('rebuilds the subgraph id as txHash || LE32(log_index + 1)', () => {
    expect(subgraphEscrowTxId(tx, 43)).toBe(`${tx}2c000000`);
    expect(subgraphEscrowTxId(tx, 63)).toBe(`${tx}40000000`);
    expect(subgraphEscrowTxId(tx, 262)).toBe(`${tx}07010000`);
    expect(subgraphEscrowTxId(tx, 280)).toBe(`${tx}19010000`);
  });
  it('lowercases the hash, since the subgraph ids are lowercase and the upsert keys on them', () => {
    expect(subgraphEscrowTxId(tx.toUpperCase().replace('0X', '0x'), 0)).toBe(`${tx}01000000`);
  });
});

describe('ingestRav from the nest', () => {
  const tx = '0x2ddfa4e9ed5f9800062f3570a95fcd2dc0f5f2dfe0a75ee1551a2c734bb5e3df';
  const row = (overrides: Partial<Record<string, unknown>> = {}) => ({
    tx_hash: tx,
    log_index: 43,
    payer: '0xDDE4cffd3d9052a9cb618fc05a1cd02be1f2f467',
    receiver: '0xF92F430dd8567b0d466358c79594ab58d919a6d4',
    tokens: '327932886083708863119',
    block_timestamp: 1788447655,
    allocation_id: '0x8fff2ea29cf6f950dd3011f98c2cc550b04832d6',
    fee_tokens: '327932886083708863119',
    ...overrides,
  });
  const ok = (rows: unknown[], extra: Record<string, unknown> = {}) => ({
    ok: true,
    data: { count: rows.length, rows, truncated: false, ...extra },
  });

  beforeEach(() => {
    vi.resetAllMocks();
    process.env.NUTHATCH_RAV = 'true';
    getIngestionState.mockResolvedValue({ last_epoch: null, last_block: null, last_id: null });
  });
  afterEach(() => {
    delete process.env.NUTHATCH_RAV;
  });

  it('is off by default, so the subgraph path is unchanged until someone opts in', async () => {
    delete process.env.NUTHATCH_RAV;
    subgraphQuery.mockResolvedValueOnce({ paymentsEscrowTransactions: [] });
    await ingestRav(makeSql());
    expect(nuthatchSqlReady).not.toHaveBeenCalled();
    expect(subgraphQuery).toHaveBeenCalled();
  });

  it('reads the nest, never the gateway, and writes the row the gateway path would have written', async () => {
    nuthatchSqlReady.mockResolvedValueOnce(ok([row()]));
    const sql = makeSql([[{ id: '0x8fff2ea29cf6f950dd3011f98c2cc550b04832d6', deployment_id: '0xdep' }]]);
    const result = await ingestRav(sql);
    expect(result.ingested).toBe(1);
    expect(subgraphQuery).not.toHaveBeenCalled();
    expect(nuthatchSqlReady.mock.calls[0][1]).toBe('/alloc');
    const written = insertedRows(sql)[0] as Record<string, unknown>;
    expect(written).toMatchObject({
      id: `${tx}2c000000`,
      indexer_address: '0xf92f430dd8567b0d466358c79594ab58d919a6d4',
      payer: '0xdde4cffd3d9052a9cb618fc05a1cd02be1f2f467',
      allocation_id: '0x8fff2ea29cf6f950dd3011f98c2cc550b04832d6',
      deployment_id: '0xdep',
      tokens_grt: 327.932886083708863119,
      source: 'graphtally',
      collected_at: new Date(1788447655 * 1000).toISOString(),
      chain_id: 42161,
    });
  });

  it('keeps a self-collection with no fee partner, with a null allocation, as nuthatch#1114 records', async () => {
    nuthatchSqlReady.mockResolvedValueOnce(ok([row({ log_index: 7, allocation_id: null, fee_tokens: null })]));
    const sql = makeSql();
    const result = await ingestRav(sql);
    expect(result.ingested).toBe(1);
    const written = insertedRows(sql)[0] as Record<string, unknown>;
    expect(written).toMatchObject({ id: `${tx}08000000`, allocation_id: null, deployment_id: null });
  });

  it('refuses a pair whose fee amount differs from the escrow amount rather than guessing the allocation', async () => {
    nuthatchSqlReady.mockResolvedValueOnce(ok([row({ fee_tokens: '1' })]));
    await expect(ingestRav(makeSql())).rejects.toThrow(/different amount/);
    expect(updateIngestionState).not.toHaveBeenCalled();
  });

  it('refuses a truncated page rather than writing it as complete', async () => {
    nuthatchSqlReady.mockResolvedValueOnce(ok([row()], { truncated: true }));
    await expect(ingestRav(makeSql())).rejects.toThrow(/truncated/);
  });

  it('surfaces an unready nest with its own reason', async () => {
    nuthatchSqlReady.mockResolvedValueOnce({ ok: false, error: 'nest not ready', reason: 'lag', status: 503 });
    await expect(ingestRav(makeSql())).rejects.toThrow('nest not ready');
  });

  it('re-scans an hour of overlap on a delta run and advances the cursor to the newest timestamp', async () => {
    getIngestionState.mockResolvedValue({ last_epoch: null, last_block: 1788447655, last_id: null });
    nuthatchSqlReady.mockResolvedValueOnce(ok([row({ block_timestamp: 1788450000 })]));
    await ingestRav(makeSql());
    expect(String(nuthatchSqlReady.mock.calls[0][0])).toMatch(/c\.block_timestamp >= 1788444055/);
    expect(updateIngestionState).toHaveBeenCalledWith(expect.anything(), 'rav', { last_block: 1788450000 });
  });

  it('leaves the cursor alone when nothing newer arrived', async () => {
    getIngestionState.mockResolvedValue({ last_epoch: null, last_block: 1788450000, last_id: null });
    nuthatchSqlReady.mockResolvedValueOnce(ok([row({ block_timestamp: 1788447655 })]));
    await ingestRav(makeSql());
    expect(updateIngestionState).not.toHaveBeenCalled();
  });

  it('reads from the beginning on a backfill and pages by (timestamp, tx, log index)', async () => {
    const page1 = Array.from({ length: 10000 }, (_, i) => row({ log_index: i, block_timestamp: 1700000000 + i }));
    const page2 = [row({ log_index: 5, block_timestamp: 1700020000 })];
    nuthatchSqlReady.mockResolvedValueOnce(ok(page1)).mockResolvedValueOnce(ok(page2));
    const result = await ingestRav(makeSql(), { backfill: true });
    expect(result.ingested).toBe(10001);
    const q0 = String(nuthatchSqlReady.mock.calls[0][0]);
    const q1 = String(nuthatchSqlReady.mock.calls[1][0]);
    expect(q0).toMatch(/c\.block_timestamp >= 0 ORDER BY/);
    expect(q1).toMatch(/c\.block_timestamp > 1700009999/);
    expect(q1).toMatch(/c\.log_index > 9999/);
  });
});
