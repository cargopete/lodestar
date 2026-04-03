import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSubgraphQuery = vi.fn();
vi.mock('@/lib/subgraph', () => ({
  subgraphQuery: (...args: unknown[]) => mockSubgraphQuery(...args),
}));
vi.mock('@/lib/logger', () => ({
  log: { ingest: { info: vi.fn() } },
  default: {},
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
