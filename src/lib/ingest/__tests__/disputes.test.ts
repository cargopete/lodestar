import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockSubgraphQuery = vi.fn();
vi.mock('@/lib/subgraph', () => ({
  subgraphQuery: (...args: unknown[]) => mockSubgraphQuery(...args),
}));

const mockNuthatchSql = vi.fn();
vi.mock('@/lib/nuthatch', () => ({
  nuthatchEnabled: (flag: string) => process.env[flag] === 'true',
  nuthatchSqlReady: (...args: unknown[]) => mockNuthatchSql(...args),
}));

import { ingestDisputes } from '../disputes';

const makeDispute = (id: string, status = 'undecided') => ({
  id,
  type: 'Indexing',
  indexer: { id: '0xIndexer' },
  fisherman: { id: '0xFisherman' },
  allocation: { id: '0xAlloc' },
  subgraphDeployment: { id: '0xDeployment' },
  status,
  tokensSlashed: '1000000000000000000000',
  tokensBurned: '100000000000000000000',
  createdAt: 1700000000,
  closedAt: 0,
});

// sql mock: first call returns ingestion state, rest return []
function makeSql(lastId = '') {
  let calls = 0;
  return vi.fn((..._args: unknown[]) => {
    calls++;
    if (calls === 1) return Promise.resolve(lastId ? [{ last_epoch: null, last_block: null, last_id: lastId }] : []);
    return Promise.resolve([]);
  });
}

describe('ingestDisputes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns 0 when no disputes', async () => {
    mockSubgraphQuery.mockResolvedValue({ disputes: [] });
    const result = await ingestDisputes(makeSql() as never);
    expect(result.ingested).toBe(0);
  });

  it('ingests a batch of disputes', async () => {
    const disputes = ['d-1', 'd-2', 'd-3'].map((id) => makeDispute(id));
    mockSubgraphQuery
      .mockResolvedValueOnce({ disputes })
      .mockResolvedValueOnce({ disputes: [] });

    const result = await ingestDisputes(makeSql() as never);
    expect(result.ingested).toBe(3);
  });

  it('stops pagination when batch < 1000', async () => {
    const disputes = Array.from({ length: 3 }, (_, i) => makeDispute(`d-${i}`));
    mockSubgraphQuery.mockResolvedValueOnce({ disputes });

    const result = await ingestDisputes(makeSql() as never);
    expect(result.ingested).toBe(3);
    expect(mockSubgraphQuery).toHaveBeenCalledTimes(1);
  });

  it('handles dispute with null allocation', async () => {
    const dispute = { ...makeDispute('d-null'), allocation: null };
    mockSubgraphQuery.mockResolvedValueOnce({ disputes: [dispute] });

    const result = await ingestDisputes(makeSql() as never);
    expect(result.ingested).toBe(1);
  });

  it('handles closed dispute with closedAt timestamp', async () => {
    const dispute = { ...makeDispute('d-closed', 'accepted'), closedAt: 1700001000 };
    mockSubgraphQuery.mockResolvedValueOnce({ disputes: [dispute] });

    const result = await ingestDisputes(makeSql() as never);
    expect(result.ingested).toBe(1);
  });

  it('uses last_id from ingestion state as cursor', async () => {
    mockSubgraphQuery.mockResolvedValue({ disputes: [] });
    const sql = makeSql('d-500');
    await ingestDisputes(sql as never);
    expect(sql).toHaveBeenCalled();
  });

  it('handles dispute with zero createdAt (null created_at)', async () => {
    const dispute = { ...makeDispute('d-zerocreated'), createdAt: 0, closedAt: 0 };
    mockSubgraphQuery.mockResolvedValueOnce({ disputes: [dispute] });

    const result = await ingestDisputes(makeSql() as never);
    expect(result.ingested).toBe(1);
  });

  it('handles dispute with empty tokensSlashed (parseFloat returns NaN → 0)', async () => {
    const dispute = { ...makeDispute('d-empty-tokens'), tokensSlashed: '', tokensBurned: '' };
    mockSubgraphQuery.mockResolvedValueOnce({ disputes: [dispute] });

    const result = await ingestDisputes(makeSql() as never);
    expect(result.ingested).toBe(1);
  });

  it('paginates through exactly 1000 disputes', async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => makeDispute(`d-${i}`));
    const page2 = [makeDispute('d-final')];
    mockSubgraphQuery
      .mockResolvedValueOnce({ disputes: page1 })
      .mockResolvedValueOnce({ disputes: page2 });

    const result = await ingestDisputes(makeSql() as never);
    expect(result.ingested).toBe(1001);
  });
});

/**
 * nightswatchhq/nuthatch#1078 - disputes from the nest.
 *
 * Parity was measured before this was written: at a pinned block the nest and the subgraph hold the
 * same 8 live disputes with identical ids, and all eight comparable fields agree on all eight rows.
 */
describe('ingestDisputes from the nest', () => {
  const nestRow = (over: Record<string, unknown> = {}) => ({
    id: '0xdispute',
    kind: 'Indexing',
    indexer: '0xINDEXER',
    fisherman: '0xFISHERMAN',
    allocation_id: '0xalloc',
    subgraph_deployment: '0xdeployment',
    status: 'Drawn',
    created_at: 1700000000,
    resolved_at: 1700000100,
    ...over,
  });

  beforeEach(() => {
    vi.resetAllMocks();
    process.env.NUTHATCH_DISPUTES = 'true';
  });
  afterEach(() => {
    delete process.env.NUTHATCH_DISPUTES;
  });

  it('is off by default, so the subgraph path is unchanged until someone opts in', async () => {
    delete process.env.NUTHATCH_DISPUTES;
    mockSubgraphQuery.mockResolvedValue({ disputes: [] });
    await ingestDisputes(makeSql() as never);
    expect(mockSubgraphQuery).toHaveBeenCalled();
    expect(mockNuthatchSql).not.toHaveBeenCalled();
  });

  it('reads the nest instead of the gateway when the flag is on', async () => {
    mockNuthatchSql.mockResolvedValue({ ok: true, data: { rows: [nestRow()] } });
    const result = await ingestDisputes(makeSql() as never);
    expect(result.ingested).toBe(1);
    expect(mockSubgraphQuery).not.toHaveBeenCalled();
    // The deployment is not a column on lodestar_disputes; it is joined in from allocations.
    const [query, basePath] = mockNuthatchSql.mock.calls[0] as [string, string];
    expect(query).toContain('lodestar_disputes');
    expect(query).toContain('LEFT JOIN lodestar_allocations');
    expect(basePath).toBe('/alloc');
  });

  it("translates the nest's `Drawn` to the subgraph's `draw`, so the panel sees one vocabulary", async () => {
    mockNuthatchSql.mockResolvedValue({ ok: true, data: { rows: [nestRow()] } });
    const sql = makeSql();
    await ingestDisputes(sql as never);
    const inserted = (sql.mock.calls as unknown[][])
      .flat()
      .find((a) => Array.isArray(a) && a.length && (a[0] as Record<string, unknown>)?.id === '0xdispute') as
      | Record<string, unknown>[]
      | undefined;
    expect(inserted?.[0]).toMatchObject({
      id: '0xdispute',
      dispute_type: 'indexing',
      indexer_address: '0xindexer',
      fisherman: '0xfisherman',
      deployment_id: '0xdeployment',
      status: 'draw',
      tokens_slashed_grt: 0,
      tokens_burned_grt: 0,
    });
  });

  it('refuses an accepted dispute rather than writing a zero burn', async () => {
    // A dispute only slashes when accepted, and none ever has - all eight are Drawn with zero on
    // both sides. The nest cannot compute the burn until StakeSlashed is indexed (nuthatch#1125),
    // so writing zero here would under-report a slash to a panel that renders it.
    mockNuthatchSql.mockResolvedValue({
      ok: true,
      data: { rows: [nestRow({ status: 'Accepted' })] },
    });
    await expect(ingestDisputes(makeSql() as never)).rejects.toThrow(/StakeSlashed/);
    await expect(ingestDisputes(makeSql() as never)).rejects.toThrow(/nuthatch#1125/);
  });

  it('writes nothing and reports zero when the nest holds no disputes', async () => {
    mockNuthatchSql.mockResolvedValue({ ok: true, data: { rows: [] } });
    const sql = makeSql();
    const result = await ingestDisputes(sql as never);
    expect(result.ingested).toBe(0);
    // No INSERT at all - an empty result is a legitimate state, not a reason to write an empty row.
    // Matched on a dispute-shaped row rather than "any array", because `updateIngestionState` passes
    // arrays too and would make this assertion pass for the wrong reason.
    const inserted = (sql.mock.calls as unknown[][])
      .flat()
      .find(
        (a) =>
          Array.isArray(a) &&
          a.some((r) => typeof r === 'object' && r !== null && 'dispute_type' in r),
      );
    expect(inserted).toBeUndefined();
  });

  it('carries the nullable fields through as null rather than inventing values', async () => {
    // A query dispute has no allocation, so no deployment joins in; an unresolved one has no
    // closedAt. Both are real states and neither is a zero.
    mockNuthatchSql.mockResolvedValue({
      ok: true,
      data: {
        rows: [
          nestRow({
            kind: null,
            status: null,
            allocation_id: null,
            subgraph_deployment: null,
            created_at: null,
            resolved_at: null,
          }),
        ],
      },
    });
    const sql = makeSql();
    await ingestDisputes(sql as never);
    const inserted = (sql.mock.calls as unknown[][])
      .flat()
      .find((a) => Array.isArray(a) && a.length && (a[0] as Record<string, unknown>)?.id === '0xdispute') as
      | Record<string, unknown>[]
      | undefined;
    expect(inserted?.[0]).toMatchObject({
      dispute_type: null,
      allocation_id: null,
      deployment_id: null,
      status: null,
      created_at: null,
      closed_at: null,
    });
  });

  it("surfaces the nest's own reason when it is unavailable, rather than a bare failure", async () => {
    mockNuthatchSql.mockResolvedValue({
      ok: false,
      status: 503,
      error: 'nest is not ready',
      reason: 'still backfilling',
    });
    await expect(ingestDisputes(makeSql() as never)).rejects.toThrow('nest is not ready');
    expect(mockSubgraphQuery).not.toHaveBeenCalled();
  });
});
