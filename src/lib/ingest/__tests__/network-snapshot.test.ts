import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSubgraphQuery = vi.fn();
vi.mock('@/lib/subgraph', () => ({
  subgraphQuery: (...args: unknown[]) => mockSubgraphQuery(...args),
}));
let nuthatchConfigured = false;
vi.mock('@/lib/nuthatch', () => ({
  hasNuthatch: () => nuthatchConfigured,
  nuthatchEnabled: (flag: string) => nuthatchConfigured && process.env[flag] === 'true',
}));
const networkFromNest = vi.fn();
vi.mock('@/app/api/network-stats/route', () => ({ networkFromNest: (...a: unknown[]) => networkFromNest(...a) }));

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

  it('behind NUTHATCH_NETWORK the figures come off the nest and the gateway is not asked (nuthatch#1160)', async () => {
    nuthatchConfigured = true;
    process.env.NUTHATCH_NETWORK = 'true';
    try {
      networkFromNest.mockResolvedValue({ graphNetwork: {
        totalTokensStaked: '7000000000000000000', totalDelegatedTokens: '3000000000000000000', totalTokensSignalled: '2000000000000000000', totalTokensAllocated: '1000000000000000000',
        totalSupply: '10000000000000000000', indexerCount: 20, stakedIndexersCount: 18, delegatorCount: 500, activeDelegatorCount: 420, curatorCount: 30, activeCuratorCount: 25,
        subgraphCount: 150, activeSubgraphCount: 80, currentEpoch: 1372,
      } });
      const sql = vi.fn(() => Promise.resolve([]));
      await writeNetworkSnapshot(sql as never, { grtPriceUsd: 0.1 });
      expect(mockSubgraphQuery).not.toHaveBeenCalled();
      expect(networkFromNest).toHaveBeenCalledTimes(1);
      const values = (sql.mock.calls[0] as unknown[]).slice(1);
      expect(values.slice(0, 5)).toEqual([7, 3, 2, 1, 10]);
      expect(values.slice(5, 14)).toEqual([20, 18, 500, 420, 30, 25, 150, 80, 1372]);
      expect(values[14]).toBe(0.1);
    } finally {
      nuthatchConfigured = false;
      delete process.env.NUTHATCH_NETWORK;
    }
  });
});
