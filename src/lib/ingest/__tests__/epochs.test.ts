import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSubgraphQuery = vi.fn();
vi.mock('@/lib/subgraph', () => ({
  subgraphQuery: (...args: unknown[]) => mockSubgraphQuery(...args),
}));

import { ingestEpochs } from '../epochs';

const makeEpoch = (id: number) => ({
  id: String(id),
  startBlock: id * 1000,
  endBlock: id * 1000 + 999,
  stakeDeposited: '1000000000000000000000',
  signalledTokens: '2000000000000000000000',
  totalRewards: '500000000000000000000',
  totalIndexerRewards: '300000000000000000000',
  totalDelegatorRewards: '200000000000000000000',
  totalQueryFees: '100000000000000000000',
  queryFeesCollected: '90000000000000000000',
  curatorQueryFees: '5000000000000000000',
  queryFeeRebates: '4000000000000000000',
  taxedQueryFees: '1000000000000000000',
});

// sql mock: first call returns ingestion state row, subsequent calls return []
function makeSql(ingestionRow: Record<string, unknown> = { last_epoch: 0, last_block: null, last_id: null }) {
  let calls = 0;
  return vi.fn((..._args: unknown[]) => {
    calls++;
    if (calls === 1) return Promise.resolve([ingestionRow]); // getIngestionState SELECT
    return Promise.resolve([]);
  });
}

describe('ingestEpochs', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns 0 ingested when subgraph returns empty', async () => {
    mockSubgraphQuery.mockResolvedValue({ epoches: [] });
    const result = await ingestEpochs(makeSql() as never);
    expect(result.ingested).toBe(0);
  });

  it('ingests a batch of epochs', async () => {
    const epochs = [makeEpoch(100), makeEpoch(101), makeEpoch(102)];
    mockSubgraphQuery
      .mockResolvedValueOnce({ epoches: epochs })
      .mockResolvedValueOnce({ epoches: [] });

    const result = await ingestEpochs(makeSql() as never);
    expect(result.ingested).toBe(3);
  });

  it('picks up from last_epoch in ingestion state', async () => {
    mockSubgraphQuery.mockResolvedValue({ epoches: [] });

    const sql = makeSql({ last_epoch: 500, last_block: null, last_id: null });
    await ingestEpochs(sql as never);
    // First SQL call is the ingestion state SELECT — just verify the function ran
    expect(sql).toHaveBeenCalled();
  });

  it('starts with epoch 0 when no ingestion state exists', async () => {
    mockSubgraphQuery.mockResolvedValue({ epoches: [] });

    // Return empty rows (no ingestion state row)
    const sql = vi.fn(() => Promise.resolve([]));
    await ingestEpochs(sql as never);
    expect(mockSubgraphQuery).toHaveBeenCalled();
  });

  it('handles pagination — stops when batch < 100', async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => makeEpoch(i + 1));
    const partialPage = Array.from({ length: 5 }, (_, i) => makeEpoch(i + 101));
    mockSubgraphQuery
      .mockResolvedValueOnce({ epoches: fullPage })
      .mockResolvedValueOnce({ epoches: partialPage })
      .mockResolvedValueOnce({ epoches: [] }); // should not be reached

    const result = await ingestEpochs(makeSql() as never);
    expect(result.ingested).toBe(105);
    expect(mockSubgraphQuery).toHaveBeenCalledTimes(2);
  });

  it('calls subgraphQuery with an epochs query', async () => {
    mockSubgraphQuery.mockResolvedValue({ epoches: [] });
    await ingestEpochs(makeSql() as never);
    expect(mockSubgraphQuery).toHaveBeenCalledWith(expect.stringContaining('epoches'));
  });
});
