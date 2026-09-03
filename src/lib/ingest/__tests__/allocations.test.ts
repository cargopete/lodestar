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

const makeAllocation = (id: string, status = 'Active') => ({
  id,
  indexer: { id: '0xIndexer' },
  subgraphDeployment: { id: '0xDeployment', signalledTokens: '1000000000000000000000' },
  allocatedTokens: '500000000000000000000',
  createdAtEpoch: 100,
  closedAtEpoch: status === 'Active' ? null : 110,
  createdAt: 1700000000,
  closedAt: status === 'Active' ? null : 1700100000,
  poi: null,
  indexingRewards: '10000000000000000000',
  queryFeesCollected: '5000000000000000000',
  status,
});

const epochResponse = { graphNetwork: { currentEpoch: 150 } };

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

describe('ingestAllocations (delta mode)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns 0 when no allocations found', async () => {
    // open allocs: empty → stop → no closed allocs query when lastEpoch=0 → network epoch
    mockSubgraphQuery
      .mockResolvedValueOnce({ allocations: [] })  // open allocs
      .mockResolvedValueOnce(epochResponse);       // network epoch
    const result = await ingestAllocations(makeSql() as never);
    expect(result.ingested).toBe(0);
  });

  it('ingests open allocations', async () => {
    const allocs = ['a-1', 'a-2'].map((id) => makeAllocation(id));
    // 2 allocs < 1000 → stops after first page; no closed allocs (lastEpoch=null→0)
    mockSubgraphQuery
      .mockResolvedValueOnce({ allocations: allocs })  // open allocs (< 1000 → breaks)
      .mockResolvedValueOnce(epochResponse);           // network epoch
    const result = await ingestAllocations(makeSql() as never);
    expect(result.ingested).toBe(2);
  });

  it('ingests closed allocations when lastEpoch > 0', async () => {
    const closedAllocs = [makeAllocation('c-1', 'Closed'), makeAllocation('c-2', 'Closed')];
    mockSubgraphQuery
      .mockResolvedValueOnce({ allocations: [] })          // open allocs: empty
      .mockResolvedValueOnce({ allocations: closedAllocs }) // closed allocs (< 1000 → breaks)
      .mockResolvedValueOnce(epochResponse);               // network epoch
    const result = await ingestAllocations(makeSql(100) as never);
    expect(result.ingested).toBe(2);
  });

  it('skips closed allocation query when lastEpoch is 0', async () => {
    mockSubgraphQuery
      .mockResolvedValueOnce({ allocations: [] })  // open allocs
      .mockResolvedValueOnce(epochResponse);       // epoch
    await ingestAllocations(makeSql(0) as never);
    // Only 2 subgraph calls: open allocs + epoch (no closed allocs)
    expect(mockSubgraphQuery).toHaveBeenCalledTimes(2);
  });

  it('paginates open allocations across multiple pages', async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => makeAllocation(`a-${i}`));
    const page2 = [makeAllocation('a-final')]; // < 1000 → stops
    mockSubgraphQuery
      .mockResolvedValueOnce({ allocations: page1 })
      .mockResolvedValueOnce({ allocations: page2 })
      .mockResolvedValueOnce(epochResponse);
    const result = await ingestAllocations(makeSql() as never);
    expect(result.ingested).toBe(1001);
  });

  it('includes both open and closed allocs when lastEpoch > 0', async () => {
    const openAllocs = ['a-1'].map((id) => makeAllocation(id));
    const closedAllocs = ['c-1', 'c-2'].map((id) => makeAllocation(id, 'Closed'));
    mockSubgraphQuery
      .mockResolvedValueOnce({ allocations: openAllocs })    // open
      .mockResolvedValueOnce({ allocations: closedAllocs })  // closed
      .mockResolvedValueOnce(epochResponse);
    const result = await ingestAllocations(makeSql(50) as never);
    expect(result.ingested).toBe(3);
  });
});

describe('ingestAllocations (backfill mode)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns 0 when no allocations in backfill', async () => {
    mockSubgraphQuery
      .mockResolvedValueOnce({ allocations: [] })
      .mockResolvedValueOnce(epochResponse);
    const result = await ingestAllocations(makeSql() as never, { backfill: true });
    expect(result.ingested).toBe(0);
  });

  it('backfills a batch of allocations', async () => {
    const allocs = ['b-1', 'b-2', 'b-3'].map((id) => makeAllocation(id));
    mockSubgraphQuery
      .mockResolvedValueOnce({ allocations: allocs })  // < 1000 → stops
      .mockResolvedValueOnce(epochResponse);
    const result = await ingestAllocations(makeSql() as never, { backfill: true });
    expect(result.ingested).toBe(3);
  });

  it('paginates backfill until partial page', async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => makeAllocation(`b-${i}`));
    const page2 = Array.from({ length: 200 }, (_, i) => makeAllocation(`b-extra-${i}`));
    mockSubgraphQuery
      .mockResolvedValueOnce({ allocations: page1 })
      .mockResolvedValueOnce({ allocations: page2 })  // < 1000 → stops
      .mockResolvedValueOnce(epochResponse);
    const result = await ingestAllocations(makeSql() as never, { backfill: true });
    expect(result.ingested).toBe(1200);
  });

  it('calls subgraphQuery for network epoch at end of backfill', async () => {
    mockSubgraphQuery
      .mockResolvedValueOnce({ allocations: [] })
      .mockResolvedValueOnce(epochResponse);
    await ingestAllocations(makeSql() as never, { backfill: true });
    expect(mockSubgraphQuery).toHaveBeenCalledWith(
      expect.stringContaining('graphNetwork')
    );
  });
});

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

  it('is off by default, so the subgraph path is unchanged until someone opts in', async () => {
    delete process.env.NUTHATCH_ALLOCATIONS;
    mockSubgraphQuery
      .mockResolvedValueOnce({ allocations: [] })
      .mockResolvedValueOnce(epochResponse);
    await ingestAllocations(makeSql() as never);
    expect(mockNuthatchSql).not.toHaveBeenCalled();
    expect(mockSubgraphQuery).toHaveBeenCalled();
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
