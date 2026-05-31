// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock the API boundary — the hooks are thin react-query wrappers around these.
vi.mock('@/lib/api', () => ({
  fetchNetworkStats: vi.fn(),
  fetchEpochHistory: vi.fn(),
  fetchIndexers: vi.fn(),
  fetchGRTPrice: vi.fn(),
  fetchTVL: vi.fn(),
  fetchIndexerProvisions: vi.fn(),
  fetchEnrichedIndexers: vi.fn(),
  fetchSubgraphDeployments: vi.fn(),
  fetchSubgraphDeployments30d: vi.fn(),
  fetchManifestAnalysis: vi.fn(),
  fetchPOIOverview: vi.fn(),
  fetchPOIDeployment: vi.fn(),
  fetchIndexingStatus: vi.fn(),
  fetchIndexerStatus: vi.fn(),
  fetchNetworksRegistry: vi.fn(),
  fetchDelegatorPortfolio: vi.fn(),
  fetchCuratorPortfolio: vi.fn(),
  fetchRewardsHistory: vi.fn(),
  fetchPayments: vi.fn(),
  fetchIndexerPayments: vi.fn(),
  fetchIndexerTrends: vi.fn(),
  fetchIndexerQoS: vi.fn(),
  fetchIndexerStakeHistory: vi.fn(),
  fetchDelegationFlows: vi.fn(),
  fetchTokenMetrics: vi.fn(),
  fetchParameterHistory: vi.fn(),
  fetchSubgraphCuration: vi.fn(),
  fetchSubgraphSchema: vi.fn(),
  fetchCuratorLeaderboard: vi.fn(),
}));

import * as api from '@/lib/api';
import {
  useNetworkStats,
  useEpochHistory,
  useEpochInfo,
  useSubgraphDeployments,
  useParameterHistory,
  useEnrichedIndexers,
  useIndexerProvisions,
  useRecentDelegations,
  useNetworkDelegations,
  useIndexerDisputes,
} from '../useNetworkStats';

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // eslint-disable-next-line react/display-name
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useNetworkStats', () => {
  it('returns data from fetchNetworkStats', async () => {
    const payload = { graphNetwork: { currentEpoch: 100 } };
    vi.mocked(api.fetchNetworkStats).mockResolvedValue(payload as never);

    const { result } = renderHook(() => useNetworkStats(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(payload);
    expect(api.fetchNetworkStats).toHaveBeenCalledTimes(1);
  });

  it('surfaces errors from the fetcher', async () => {
    vi.mocked(api.fetchNetworkStats).mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useNetworkStats(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe('boom');
  });
});

describe('useEpochHistory', () => {
  it('passes the default count of 30 to the fetcher', async () => {
    vi.mocked(api.fetchEpochHistory).mockResolvedValue({ epoches: [] } as never);
    const { result } = renderHook(() => useEpochHistory(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.fetchEpochHistory).toHaveBeenCalledWith(30);
  });

  it('forwards a custom count', async () => {
    vi.mocked(api.fetchEpochHistory).mockResolvedValue({ epoches: [] } as never);
    const { result } = renderHook(() => useEpochHistory(7), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.fetchEpochHistory).toHaveBeenCalledWith(7);
  });
});

describe('useSubgraphDeployments', () => {
  it('passes params through to the fetcher', async () => {
    vi.mocked(api.fetchSubgraphDeployments).mockResolvedValue({ subgraphDeployments: [] } as never);
    const params = { first: 5, skip: 10, orderBy: 'signalAmount', orderDirection: 'desc' as const };
    const { result } = renderHook(() => useSubgraphDeployments(params), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.fetchSubgraphDeployments).toHaveBeenCalledWith(params);
  });
});

describe('useParameterHistory', () => {
  it('is disabled (no fetch) when address is null', async () => {
    const { result } = renderHook(() => useParameterHistory(null), { wrapper: wrapper() });
    // Disabled query: stays in pending/idle and never calls the fetcher.
    expect(result.current.fetchStatus).toBe('idle');
    expect(api.fetchParameterHistory).not.toHaveBeenCalled();
  });

  it('fetches when an address is provided', async () => {
    vi.mocked(api.fetchParameterHistory).mockResolvedValue({ changes: [] } as never);
    const { result } = renderHook(() => useParameterHistory('0xabc'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.fetchParameterHistory).toHaveBeenCalledWith('0xabc');
  });
});

describe('useEnrichedIndexers', () => {
  it('returns the enriched indexer list', async () => {
    vi.mocked(api.fetchEnrichedIndexers).mockResolvedValue([{ id: '0x1' }] as never);
    const { result } = renderHook(() => useEnrichedIndexers(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: '0x1' }]);
  });
});

describe('useIndexerProvisions', () => {
  it('does not run when the indexer string is empty', () => {
    const { result } = renderHook(() => useIndexerProvisions(''), { wrapper: wrapper() });
    expect(result.current.fetchStatus).toBe('idle');
    expect(api.fetchIndexerProvisions).not.toHaveBeenCalled();
  });
});

describe('useEpochInfo (transform logic)', () => {
  it('returns the zero shape when network data is absent', async () => {
    vi.mocked(api.fetchNetworkStats).mockResolvedValue({} as never);
    const { result } = renderHook(() => useEpochInfo(), { wrapper: wrapper() });
    // Early return before the network query resolves.
    expect(result.current).toEqual({ epoch: 0, progress: 0, epochLength: 0 });
  });

  it('derives epoch from the subgraph and a bounded progress fraction', async () => {
    vi.mocked(api.fetchNetworkStats).mockResolvedValue({
      graphNetwork: {
        currentEpoch: 1500,
        epochLength: 6646,
        lastLengthUpdateBlock: 15537393, // == merge block so blocksIntoEpoch is small & positive
      },
    } as never);

    const { result } = renderHook(() => useEpochInfo(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.epoch).toBe(1500));

    expect(result.current.epochLength).toBe(6646);
    expect(result.current.progress).toBeGreaterThanOrEqual(0);
    expect(result.current.progress).toBeLessThanOrEqual(100);
  });

  it('clamps progress to at most 100', async () => {
    vi.mocked(api.fetchNetworkStats).mockResolvedValue({
      graphNetwork: {
        currentEpoch: 42,
        epochLength: 1, // any remainder/1 *100 would exceed 100 -> must clamp
        lastLengthUpdateBlock: 0,
      },
    } as never);

    const { result } = renderHook(() => useEpochInfo(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.epoch).toBe(42));
    expect(result.current.progress).toBeLessThanOrEqual(100);
  });
});

describe('raw-fetch hooks', () => {
  it('useRecentDelegations unwraps json.data.delegationEvents', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ data: { delegationEvents: [{ id: 'e1' }] } }), { status: 200 }),
    );
    const { result } = renderHook(() => useRecentDelegations('0xIndexer'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: 'e1' }]);
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('indexer=0xIndexer'));
  });

  it('useRecentDelegations defaults to [] when data is missing', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    const { result } = renderHook(() => useRecentDelegations('0xabc'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('useRecentDelegations throws on a non-ok response', async () => {
    mockFetch.mockResolvedValue(new Response('nope', { status: 500 }));
    const { result } = renderHook(() => useRecentDelegations('0xabc'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('useNetworkDelegations includes the indexer param only when provided', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ data: { delegationEvents: [] } }), { status: 200 }),
    );
    const { result } = renderHook(() => useNetworkDelegations('0xWithIndexer'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('indexer=0xWithIndexer');
    expect(url).toContain('first=50');
  });

  it('useIndexerDisputes lowercases the address in the URL', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ disputes: [] }), { status: 200 }));
    const { result } = renderHook(() => useIndexerDisputes('0xABCDEF'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch).toHaveBeenCalledWith('/api/indexer-disputes/0xabcdef');
    expect(result.current.data).toEqual({ disputes: [] });
  });
});
