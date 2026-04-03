import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSubgraphQuery = vi.fn();
vi.mock('@/lib/subgraph', () => ({
  subgraphQuery: (...args: unknown[]) => mockSubgraphQuery(...args),
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
