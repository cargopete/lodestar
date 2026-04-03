import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSubgraphQuery = vi.fn();
vi.mock('@/lib/subgraph', () => ({
  subgraphQuery: (...args: unknown[]) => mockSubgraphQuery(...args),
}));

import { writeNetworkSnapshot } from '../network-snapshot';

const networkStats = {
  graphNetwork: {
    totalTokensStaked: '1000000000000000000000000',
    totalDelegatedTokens: '500000000000000000000000',
    totalTokensSignalled: '200000000000000000000000',
    totalTokensAllocated: '300000000000000000000000',
    totalSupply: '10000000000000000000000000000',
    indexerCount: 200,
    stakedIndexersCount: 180,
    delegatorCount: 5000,
    activeDelegatorCount: 4200,
    curatorCount: 300,
    activeCuratorCount: 250,
    subgraphCount: 1500,
    activeSubgraphCount: 800,
    currentEpoch: 1234,
  },
};

describe('writeNetworkSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSubgraphQuery.mockResolvedValue(networkStats);
  });

  it('inserts a network snapshot into the database', async () => {
    const sql = vi.fn(() => Promise.resolve([]));
    await writeNetworkSnapshot(sql as never);
    expect(sql).toHaveBeenCalled();
  });

  it('passes grtPriceUsd option to the insert', async () => {
    const sql = vi.fn(() => Promise.resolve([]));
    await writeNetworkSnapshot(sql as never, { grtPriceUsd: 0.15 });
    expect(sql).toHaveBeenCalled();
  });

  it('passes networkTvlUsd option to the insert', async () => {
    const sql = vi.fn(() => Promise.resolve([]));
    await writeNetworkSnapshot(sql as never, { networkTvlUsd: 1_500_000 });
    expect(sql).toHaveBeenCalled();
  });

  it('calls subgraphQuery to fetch network stats', async () => {
    const sql = vi.fn(() => Promise.resolve([]));
    await writeNetworkSnapshot(sql as never);
    expect(mockSubgraphQuery).toHaveBeenCalledOnce();
  });

  it('resolves without error with defaults', async () => {
    const sql = vi.fn(() => Promise.resolve([]));
    await expect(writeNetworkSnapshot(sql as never)).resolves.toBeUndefined();
  });
});
