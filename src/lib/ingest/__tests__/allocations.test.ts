import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockSubgraphQuery = vi.fn();
vi.mock('@/lib/subgraph', () => ({
  subgraphQuery: (...args: unknown[]) => mockSubgraphQuery(...args),
}));
vi.mock('@/lib/logger', () => ({
  log: { ingest: { info: vi.fn() } },
  default: {},
}));

const mockNuthatchSql = vi.fn();
vi.mock('@/lib/nuthatch', () => ({
  nuthatchEnabled: (flag: string) => process.env[flag] === 'true',
  nuthatchSqlReady: (...args: unknown[]) => mockNuthatchSql(...args),
}));

import { ingestAllocations } from '../allocations';

// sql mock that returns ingestion state on first call, then [] for everything else
function makeSql(lastEpoch: number | null = null) {
  let calls = 0;
  return vi.fn((..._args: unknown[]) => {
    calls++;
    if (calls === 1) {
      return Promise.resolve(
        lastEpoch !== null
          ? [{ last_epoch: lastEpoch, last_block: null, last_id: null }]
          : []
      );
    }
    return Promise.resolve([]);
  });
}

describe('ingestAllocations from the nest', () => {
  const nestRow = (id: string, status = 'Active') => ({
    id,
    indexer: '0xABCDEF0000000000000000000000000000000001',
    subgraph_deployment: '0xdeployment',
    signalled_tokens: '1000000000000000000000',
    allocated_tokens: '500000000000000000000',
    created_at_epoch: '1300',
    closed_at_epoch: status === 'Active' ? null : '1310',
    created_at: 1700000000,
    closed_at: status === 'Active' ? null : 1700100000,
    poi: status === 'Active' ? null : '0xpoi',
    indexing_rewards: '10000000000000000000',
    query_fees_collected: '5000000000000000000',
    status,
  });
  const ok = (rows: unknown[], extra: Record<string, unknown> = {}) => ({
    ok: true,
    data: { count: rows.length, rows, truncated: false, ...extra },
  });

  beforeEach(() => {
    vi.resetAllMocks();
    process.env.NUTHATCH_ALLOCATIONS = 'true';
  });
  afterEach(() => {
    delete process.env.NUTHATCH_ALLOCATIONS;
  });

  it('reads active and recently-closed allocations from the nest and never the gateway', async () => {
    mockNuthatchSql
      .mockResolvedValueOnce(ok([nestRow('0xa1'), nestRow('0xa2')]))          // active
      .mockResolvedValueOnce(ok([nestRow('0xc1', 'Closed')]))                  // closed since cursor
      .mockResolvedValueOnce(ok([{ epoch: '1371' }]));                        // current epoch
    const sql = makeSql(1369);
    const result = await ingestAllocations(sql as never);
    expect(result.ingested).toBe(3);
    expect(mockSubgraphQuery).not.toHaveBeenCalled();
    const queries = mockNuthatchSql.mock.calls.map((c) => String(c[0]));
    expect(queries[0]).toMatch(/status = 'Active'/);
    expect(queries[1]).toMatch(/closed_at_epoch >= 1369/);
    expect(queries[2]).toMatch(/MAX\(epoch\)/);
    expect(mockNuthatchSql.mock.calls.every((c) => c[1] === '/alloc')).toBe(true);
  });

  it('skips the closed read on a first run, exactly like the gateway path', async () => {
    mockNuthatchSql
      .mockResolvedValueOnce(ok([nestRow('0xa1')]))
      .mockResolvedValueOnce(ok([{ epoch: 1371 }]));
    const result = await ingestAllocations(makeSql() as never);
    expect(result.ingested).toBe(1);
    expect(mockNuthatchSql).toHaveBeenCalledTimes(2);
  });

  it('writes the same row shape the gateway path writes, with status folded to open/closed', async () => {
    mockNuthatchSql
      .mockResolvedValueOnce(ok([nestRow('0xa1'), nestRow('0xc1', 'Closed')]))
      .mockResolvedValueOnce(ok([{ epoch: 1371 }]));
    const sql = makeSql();
    await ingestAllocations(sql as never);
    // `sql` is both the tagged template and the row-helper: `sql(batch)` is a separate call whose
    // first argument is the array of rows, which is the thing worth asserting on.
    // A tagged-template call's first argument is also an array (the template strings), so pick
    // the array whose first element is a row rather than a string.
    const helper = sql.mock.calls.find(
      (c) => Array.isArray(c[0]) && typeof c[0][0] === 'object' && c[0][0] !== null && 'id' in c[0][0],
    );
    expect(helper).toBeDefined();
    const rows = helper![0] as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({
      id: '0xa1',
      indexer_address: '0xabcdef0000000000000000000000000000000001',
      deployment_id: '0xdeployment',
      allocated_tokens_grt: 500,
      created_epoch: 1300,
      closed_epoch: null,
      created_at: new Date(1700000000 * 1000).toISOString(),
      closed_at: null,
      signal_at_open: 1000,
      poi: null,
      indexing_rewards_grt: 10,
      query_fees_grt: 5,
      status: 'open',
    });
    expect(rows[1]).toMatchObject({ id: '0xc1', closed_epoch: 1310, poi: '0xpoi', status: 'closed' });
  });

  it('advances the cursor to the epoch the nest reports, not the gateway', async () => {
    mockNuthatchSql
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValueOnce(ok([{ epoch: '1371' }]));
    const sql = makeSql();
    await ingestAllocations(sql as never);
    // Same shape: `updateIngestionState` passes its state through `sql({...})` as a helper call.
    const update = sql.mock.calls.find(
      (c) => c[0] && !Array.isArray(c[0]) && typeof c[0] === 'object' && 'last_epoch' in (c[0] as object),
    );
    expect(update).toBeDefined();
    expect(update![0]).toMatchObject({ last_epoch: 1371 });
  });

  it('refuses a truncated read rather than writing a partial snapshot as complete', async () => {
    mockNuthatchSql.mockResolvedValueOnce(ok([nestRow('0xa1')], { truncated: true }));
    await expect(ingestAllocations(makeSql() as never)).rejects.toThrow(/truncated/);
  });

  it('surfaces an unready nest with its own reason rather than a bare failure', async () => {
    mockNuthatchSql.mockResolvedValueOnce({ ok: false, error: 'nest not ready', reason: 'lag', status: 503 });
    await expect(ingestAllocations(makeSql() as never)).rejects.toThrow('nest not ready');
  });

  it('refuses to advance the cursor when the nest reports no epoch', async () => {
    mockNuthatchSql
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValueOnce(ok([{ epoch: null }]));
    await expect(ingestAllocations(makeSql() as never)).rejects.toThrow(/no current epoch/);
  });

  it('backfills the whole view by id in pages and stops on a short page', async () => {
    const page1 = Array.from({ length: 10000 }, (_, i) => nestRow(`0x${String(i).padStart(6, '0')}`));
    const page2 = [nestRow('0xzz1'), nestRow('0xzz2', 'Closed')];
    mockNuthatchSql
      .mockResolvedValueOnce(ok(page1))
      .mockResolvedValueOnce(ok(page2))
      .mockResolvedValueOnce(ok([{ epoch: 1371 }]));
    const result = await ingestAllocations(makeSql() as never, { backfill: true });
    expect(result.ingested).toBe(10002);
    const queries = mockNuthatchSql.mock.calls.map((c) => String(c[0]));
    expect(queries[0]).not.toMatch(/WHERE id >/);
    expect(queries[1]).toMatch(/WHERE id > '0x009999'/);
    expect(mockSubgraphQuery).not.toHaveBeenCalled();
  });
});
