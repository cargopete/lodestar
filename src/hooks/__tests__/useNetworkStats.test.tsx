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
  useGRTPrice,
  useTVL,
  useIndexers,
  useSubgraphDeployments30d,
  useNetworksRegistry,
  useManifestAnalysis,
  usePOIOverview,
  usePOIDeployment,
  useIndexingStatus,
  useSubgraphCuration,
  useDelegatorPortfolio,
  useCuratorPortfolio,
  useRewardsHistory,
  useIndexerStatus,
  usePayments,
  useIndexerPayments,
  useIndexerTrends,
  useIndexerQoS,
  useIndexerStakeHistory,
  useDelegationFlows,
  useTokenMetrics,
  useSubgraphSchema,
  useCuratorLeaderboard,
  useREOStatus,
  useENSName,
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

describe('always-on (un-gated) query hooks', () => {
  it('useGRTPrice returns price data from the fetcher', async () => {
    vi.mocked(api.fetchGRTPrice).mockResolvedValue({ price: 0.2, change24h: 1 } as never);
    const { result } = renderHook(() => useGRTPrice(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ price: 0.2, change24h: 1 });
  });

  it('useTVL surfaces a fetcher error', async () => {
    vi.mocked(api.fetchTVL).mockRejectedValue(new Error('tvl-down'));
    const { result } = renderHook(() => useTVL(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe('tvl-down');
  });

  it('useIndexers forwards params to the fetcher', async () => {
    vi.mocked(api.fetchIndexers).mockResolvedValue({ indexers: [] } as never);
    const params = { first: 10, orderBy: 'score', orderDirection: 'asc' as const };
    const { result } = renderHook(() => useIndexers(params), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.fetchIndexers).toHaveBeenCalledWith(params);
  });

  it('useNetworksRegistry returns the registry payload', async () => {
    vi.mocked(api.fetchNetworksRegistry).mockResolvedValue({ networks: [{ chainId: 1 }] } as never);
    const { result } = renderHook(() => useNetworksRegistry(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ networks: [{ chainId: 1 }] });
  });

  it('usePOIOverview returns overview data', async () => {
    vi.mocked(api.fetchPOIOverview).mockResolvedValue({ deployments: [] } as never);
    const { result } = renderHook(() => usePOIOverview(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ deployments: [] });
  });

  it('usePayments returns payment data', async () => {
    vi.mocked(api.fetchPayments).mockResolvedValue({ escrow: '1' } as never);
    const { result } = renderHook(() => usePayments(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ escrow: '1' });
  });

  it('useDelegationFlows forwards days+compare to the fetcher', async () => {
    vi.mocked(api.fetchDelegationFlows).mockResolvedValue([] as never);
    const { result } = renderHook(() => useDelegationFlows(7, true), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.fetchDelegationFlows).toHaveBeenCalledWith(7, true);
  });

  it('useTokenMetrics passes the default count of 100', async () => {
    vi.mocked(api.fetchTokenMetrics).mockResolvedValue([] as never);
    const { result } = renderHook(() => useTokenMetrics(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.fetchTokenMetrics).toHaveBeenCalledWith(100);
  });

  it('useSubgraphDeployments30d is gated off when enabled=false', () => {
    const { result } = renderHook(() => useSubgraphDeployments30d(false), { wrapper: wrapper() });
    expect(result.current.fetchStatus).toBe('idle');
    expect(api.fetchSubgraphDeployments30d).not.toHaveBeenCalled();
  });

  it('useSubgraphDeployments30d runs when enabled (the default)', async () => {
    vi.mocked(api.fetchSubgraphDeployments30d).mockResolvedValue([] as never);
    const { result } = renderHook(() => useSubgraphDeployments30d(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.fetchSubgraphDeployments30d).toHaveBeenCalledTimes(1);
  });

  it('useCuratorLeaderboard forwards params', async () => {
    vi.mocked(api.fetchCuratorLeaderboard).mockResolvedValue([] as never);
    const { result } = renderHook(() => useCuratorLeaderboard({ first: 5 }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.fetchCuratorLeaderboard).toHaveBeenCalledWith({ first: 5 });
  });
});

describe('enabled-gated query hooks (no arg → idle, arg → fetch)', () => {
  it('useManifestAnalysis stays idle when hash is null and runs with a hash', async () => {
    const off = renderHook(() => useManifestAnalysis(null), { wrapper: wrapper() });
    expect(off.result.current.fetchStatus).toBe('idle');
    expect(api.fetchManifestAnalysis).not.toHaveBeenCalled();

    vi.mocked(api.fetchManifestAnalysis).mockResolvedValue({ complexity: 'Light' } as never);
    const on = renderHook(() => useManifestAnalysis('QmX'), { wrapper: wrapper() });
    await waitFor(() => expect(on.result.current.isSuccess).toBe(true));
    expect(api.fetchManifestAnalysis).toHaveBeenCalledWith('QmX');
  });

  it('usePOIDeployment is idle for null and fetches for a deployment id', async () => {
    const off = renderHook(() => usePOIDeployment(null), { wrapper: wrapper() });
    expect(off.result.current.fetchStatus).toBe('idle');

    vi.mocked(api.fetchPOIDeployment).mockResolvedValue({ id: 'd' } as never);
    const on = renderHook(() => usePOIDeployment('Qm'), { wrapper: wrapper() });
    await waitFor(() => expect(on.result.current.isSuccess).toBe(true));
    expect(api.fetchPOIDeployment).toHaveBeenCalledWith('Qm');
  });

  it('useIndexingStatus is idle for null and fetches for a hash', async () => {
    const off = renderHook(() => useIndexingStatus(null), { wrapper: wrapper() });
    expect(off.result.current.fetchStatus).toBe('idle');

    vi.mocked(api.fetchIndexingStatus).mockResolvedValue({ status: 'synced' } as never);
    const on = renderHook(() => useIndexingStatus('Qm'), { wrapper: wrapper() });
    await waitFor(() => expect(on.result.current.isSuccess).toBe(true));
    expect(api.fetchIndexingStatus).toHaveBeenCalledWith('Qm');
  });

  it('useSubgraphCuration is idle for null and fetches for a hash', async () => {
    const off = renderHook(() => useSubgraphCuration(null), { wrapper: wrapper() });
    expect(off.result.current.fetchStatus).toBe('idle');

    vi.mocked(api.fetchSubgraphCuration).mockResolvedValue({ signals: [] } as never);
    const on = renderHook(() => useSubgraphCuration('Qm'), { wrapper: wrapper() });
    await waitFor(() => expect(on.result.current.isSuccess).toBe(true));
    expect(api.fetchSubgraphCuration).toHaveBeenCalledWith('Qm');
  });

  it('useDelegatorPortfolio is idle for undefined and fetches for an address', async () => {
    const off = renderHook(() => useDelegatorPortfolio(undefined), { wrapper: wrapper() });
    expect(off.result.current.fetchStatus).toBe('idle');

    vi.mocked(api.fetchDelegatorPortfolio).mockResolvedValue({ positions: [] } as never);
    const on = renderHook(() => useDelegatorPortfolio('0xdel'), { wrapper: wrapper() });
    await waitFor(() => expect(on.result.current.isSuccess).toBe(true));
    expect(api.fetchDelegatorPortfolio).toHaveBeenCalledWith('0xdel');
  });

  it('useCuratorPortfolio is idle for undefined and fetches for an address', async () => {
    const off = renderHook(() => useCuratorPortfolio(undefined), { wrapper: wrapper() });
    expect(off.result.current.fetchStatus).toBe('idle');

    vi.mocked(api.fetchCuratorPortfolio).mockResolvedValue({ positions: [] } as never);
    const on = renderHook(() => useCuratorPortfolio('0xcur'), { wrapper: wrapper() });
    await waitFor(() => expect(on.result.current.isSuccess).toBe(true));
    expect(api.fetchCuratorPortfolio).toHaveBeenCalledWith('0xcur');
  });

  it('useRewardsHistory is idle for undefined and forwards address+days', async () => {
    const off = renderHook(() => useRewardsHistory(undefined), { wrapper: wrapper() });
    expect(off.result.current.fetchStatus).toBe('idle');

    vi.mocked(api.fetchRewardsHistory).mockResolvedValue({ history: [] } as never);
    const on = renderHook(() => useRewardsHistory('0xr', 30), { wrapper: wrapper() });
    await waitFor(() => expect(on.result.current.isSuccess).toBe(true));
    expect(api.fetchRewardsHistory).toHaveBeenCalledWith('0xr', 30);
  });

  it('useIndexerStatus is idle for null and fetches for an address', async () => {
    const off = renderHook(() => useIndexerStatus(null), { wrapper: wrapper() });
    expect(off.result.current.fetchStatus).toBe('idle');

    vi.mocked(api.fetchIndexerStatus).mockResolvedValue({ totalAllocations: 0 } as never);
    const on = renderHook(() => useIndexerStatus('0xidx'), { wrapper: wrapper() });
    await waitFor(() => expect(on.result.current.isSuccess).toBe(true));
    expect(api.fetchIndexerStatus).toHaveBeenCalledWith('0xidx');
  });

  it('useIndexerPayments is idle for empty receiver and fetches otherwise', async () => {
    const off = renderHook(() => useIndexerPayments(''), { wrapper: wrapper() });
    expect(off.result.current.fetchStatus).toBe('idle');

    vi.mocked(api.fetchIndexerPayments).mockResolvedValue({ escrow: '1' } as never);
    const on = renderHook(() => useIndexerPayments('0xrecv'), { wrapper: wrapper() });
    await waitFor(() => expect(on.result.current.isSuccess).toBe(true));
    expect(api.fetchIndexerPayments).toHaveBeenCalledWith('0xrecv');
  });

  it('useIndexerTrends is idle for null and forwards indexer+days', async () => {
    const off = renderHook(() => useIndexerTrends(null), { wrapper: wrapper() });
    expect(off.result.current.fetchStatus).toBe('idle');

    vi.mocked(api.fetchIndexerTrends).mockResolvedValue({ points: [] } as never);
    const on = renderHook(() => useIndexerTrends('0xidx', 14), { wrapper: wrapper() });
    await waitFor(() => expect(on.result.current.isSuccess).toBe(true));
    expect(api.fetchIndexerTrends).toHaveBeenCalledWith('0xidx', 14);
  });

  it('useIndexerQoS is idle for null and fetches for an address', async () => {
    const off = renderHook(() => useIndexerQoS(null), { wrapper: wrapper() });
    expect(off.result.current.fetchStatus).toBe('idle');

    vi.mocked(api.fetchIndexerQoS).mockResolvedValue({ qos: [] } as never);
    const on = renderHook(() => useIndexerQoS('0xqos'), { wrapper: wrapper() });
    await waitFor(() => expect(on.result.current.isSuccess).toBe(true));
    expect(api.fetchIndexerQoS).toHaveBeenCalledWith('0xqos');
  });

  it('useIndexerStakeHistory is idle for null and fetches for an address', async () => {
    const off = renderHook(() => useIndexerStakeHistory(null), { wrapper: wrapper() });
    expect(off.result.current.fetchStatus).toBe('idle');

    vi.mocked(api.fetchIndexerStakeHistory).mockResolvedValue({ history: [] } as never);
    const on = renderHook(() => useIndexerStakeHistory('0xstk'), { wrapper: wrapper() });
    await waitFor(() => expect(on.result.current.isSuccess).toBe(true));
    expect(api.fetchIndexerStakeHistory).toHaveBeenCalledWith('0xstk');
  });

  it('useSubgraphSchema is idle for null and fetches for a hash', async () => {
    const off = renderHook(() => useSubgraphSchema(null), { wrapper: wrapper() });
    expect(off.result.current.fetchStatus).toBe('idle');

    vi.mocked(api.fetchSubgraphSchema).mockResolvedValue({ schemaText: 't', schemaHash: 'h' } as never);
    const on = renderHook(() => useSubgraphSchema('Qm'), { wrapper: wrapper() });
    await waitFor(() => expect(on.result.current.isSuccess).toBe(true));
    expect(api.fetchSubgraphSchema).toHaveBeenCalledWith('Qm');
  });

  it('useIndexerProvisions fetches once an indexer is supplied', async () => {
    vi.mocked(api.fetchIndexerProvisions).mockResolvedValue({ provisions: [] } as never);
    const { result } = renderHook(() => useIndexerProvisions('0xprov'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.fetchIndexerProvisions).toHaveBeenCalledWith('0xprov');
  });
});

describe('raw-fetch enabled-gated hooks', () => {
  it('useREOStatus is idle for empty address and unwraps json on fetch', async () => {
    const off = renderHook(() => useREOStatus(''), { wrapper: wrapper() });
    expect(off.result.current.fetchStatus).toBe('idle');
    expect(mockFetch).not.toHaveBeenCalled();

    mockFetch.mockResolvedValue(new Response(JSON.stringify({ status: 'eligible' }), { status: 200 }));
    const on = renderHook(() => useREOStatus('0xreo'), { wrapper: wrapper() });
    await waitFor(() => expect(on.result.current.isSuccess).toBe(true));
    expect(on.result.current.data).toEqual({ status: 'eligible' });
    expect(mockFetch).toHaveBeenCalledWith('/api/reo?address=0xreo');
  });

  it('useREOStatus throws on a non-ok response', async () => {
    mockFetch.mockResolvedValue(new Response('nope', { status: 500 }));
    const { result } = renderHook(() => useREOStatus('0xreo'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('useENSName returns { ensName: null } on a non-ok response (no throw)', async () => {
    mockFetch.mockResolvedValue(new Response('nope', { status: 404 }));
    const { result } = renderHook(() => useENSName('0xens'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ ensName: null });
  });

  it('useENSName returns the resolved name on success', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ ensName: 'foo.eth' }), { status: 200 }));
    const { result } = renderHook(() => useENSName('0xens'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ ensName: 'foo.eth' });
  });

  it('useNetworkDelegations omits the indexer param when none is given', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ data: { delegationEvents: [] } }), { status: 200 }),
    );
    const { result } = renderHook(() => useNetworkDelegations(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('first=50');
    expect(url).not.toContain('indexer=');
  });
});
