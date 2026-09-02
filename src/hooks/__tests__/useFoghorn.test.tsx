// @vitest-environment jsdom
/**
 * The Foghorn hooks are thin react-query wrappers, so the things worth asserting are the three
 * that a wrapper can still get wrong:
 *
 *  - the `enabled` gate. Every address-keyed hook writes `fetchX(address!)`, and a missing gate
 *    turns a null address into a request for `/indexer/undefined/…`, which the API answers with a
 *    perfectly ordinary empty result. A panel showing nothing is indistinguishable from an indexer
 *    with nothing to show.
 *  - the query key. Two calls with different arguments sharing a key serve the first one's answer
 *    to the second, which is a stale panel that never corrects itself.
 *  - the Map folding in `useDeploymentQos`, `useIndexerAllocationsQos` and `useFoghornGrades`.
 *    Foghorn returns indexer addresses in mixed case; the callers look them up by a lowercased
 *    address. A fold that forgets to lowercase produces a Map that is fully populated and never
 *    hits, which reads as "no Foghorn data" rather than as a bug.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/foghorn', () => ({
  fetchFoghornStats: vi.fn(),
  fetchFoghornIndexers: vi.fn(),
  fetchFoghornScorecard: vi.fn(),
  fetchNeedsAttention: vi.fn(),
  fetchDeploymentNames: vi.fn(),
  fetchVerdicts: vi.fn(),
  fetchSybilClusters: vi.fn(),
  fetchNonDeterministic: vi.fn(),
  fetchDeploymentQos: vi.fn(),
  fetchIndexerAllocationsQos: vi.fn(),
  fetchFoghornFeed: vi.fn(),
  fetchIndexerQuality: vi.fn(),
  fetchQosStatus: vi.fn(),
  fetchQosBuckets: vi.fn(),
  fetchQosCompare: vi.fn(),
}));

import * as foghorn from '@/lib/foghorn';
import {
  useFoghornStats,
  useFoghornIndexers,
  useFoghornScorecard,
  useNeedsAttention,
  useDeploymentNames,
  useVerdicts,
  useSybilClusters,
  useNonDeterministic,
  useIndexerAllocationsQos,
  useDeploymentQos,
  useFoghornFeed,
  useIndexerQuality,
  useFoghornGrades,
  useQosStatus,
  useQosBuckets,
  useQosCompare,
} from '../useFoghorn';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // eslint-disable-next-line react/display-name
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

/** Render a hook and wait for its query to settle successfully. */
async function settled<T>(hook: () => { isSuccess: boolean; data?: T }) {
  const { result } = renderHook(hook, { wrapper: wrapper() });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the no-argument feeds', () => {
  it('each calls its own fetcher and returns its payload', async () => {
    const cases: [() => unknown, ReturnType<typeof vi.fn>, unknown][] = [
      [useFoghornStats, vi.mocked(foghorn.fetchFoghornStats), { indexers: 1 }],
      [useSybilClusters, vi.mocked(foghorn.fetchSybilClusters), { clusters: [] }],
      [useNonDeterministic, vi.mocked(foghorn.fetchNonDeterministic), { deployments: [] }],
      [useQosStatus, vi.mocked(foghorn.fetchQosStatus), { sources: [] }],
    ];

    for (const [hook, fetcher, payload] of cases) {
      fetcher.mockResolvedValue(payload);
      const result = await settled(hook as never);
      expect(result.current.data).toEqual(payload);
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });

  it('surfaces a fetcher rejection rather than an empty success', async () => {
    vi.mocked(foghorn.fetchFoghornStats).mockRejectedValue(new Error('foghorn down'));
    const { result } = renderHook(() => useFoghornStats(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe('foghorn down');
  });
});

describe('useFoghornIndexers', () => {
  it('defaults to the 30-day window, descending', async () => {
    vi.mocked(foghorn.fetchFoghornIndexers).mockResolvedValue({ indexers: [] } as never);
    await settled(() => useFoghornIndexers());
    expect(foghorn.fetchFoghornIndexers).toHaveBeenCalledWith(30, 'desc');
  });

  it('forwards an explicit window and order', async () => {
    vi.mocked(foghorn.fetchFoghornIndexers).mockResolvedValue({ indexers: [] } as never);
    await settled(() => useFoghornIndexers(7, 'asc'));
    expect(foghorn.fetchFoghornIndexers).toHaveBeenCalledWith(7, 'asc');
  });

  it('does not serve the 7-day answer to a 30-day caller', async () => {
    // Same QueryClient, two windows: distinct keys or the second render is a lie.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const shared = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    vi.mocked(foghorn.fetchFoghornIndexers).mockImplementation(
      (window?: number) => Promise.resolve({ indexers: [], window } as never)
    );

    const seven = renderHook(() => useFoghornIndexers(7), { wrapper: shared });
    await waitFor(() => expect(seven.result.current.isSuccess).toBe(true));
    const thirty = renderHook(() => useFoghornIndexers(30), { wrapper: shared });
    await waitFor(() => expect(thirty.result.current.isSuccess).toBe(true));

    expect((seven.result.current.data as unknown as { window: number }).window).toBe(7);
    expect((thirty.result.current.data as unknown as { window: number }).window).toBe(30);
  });
});

describe('the address-gated hooks', () => {
  const gated: [string, (a: string | null) => unknown, ReturnType<typeof vi.fn>][] = [
    ['useFoghornScorecard', useFoghornScorecard, vi.mocked(foghorn.fetchFoghornScorecard)],
    ['useIndexerQuality', useIndexerQuality, vi.mocked(foghorn.fetchIndexerQuality)],
    ['useIndexerAllocationsQos', useIndexerAllocationsQos, vi.mocked(foghorn.fetchIndexerAllocationsQos)],
  ];

  for (const [name, hook, fetcher] of gated) {
    it(`${name} does not fetch for a null address`, () => {
      const { result } = renderHook(() => hook(null) as { fetchStatus: string }, {
        wrapper: wrapper(),
      });
      expect(result.current.fetchStatus).toBe('idle');
      expect(fetcher).not.toHaveBeenCalled();
    });
  }

  it('useDeploymentQos does not fetch for a null hash', () => {
    const { result } = renderHook(() => useDeploymentQos(null), { wrapper: wrapper() });
    expect(result.current.fetchStatus).toBe('idle');
    expect(foghorn.fetchDeploymentQos).not.toHaveBeenCalled();
  });

  it('useFoghornScorecard fetches once an address arrives', async () => {
    vi.mocked(foghorn.fetchFoghornScorecard).mockResolvedValue({ grade: 'A' } as never);
    await settled(() => useFoghornScorecard('0xabc'));
    expect(foghorn.fetchFoghornScorecard).toHaveBeenCalledWith('0xabc');
  });

  it('useIndexerQuality fetches once an address arrives', async () => {
    vi.mocked(foghorn.fetchIndexerQuality).mockResolvedValue({ indexer_address: '0xabc' } as never);
    await settled(() => useIndexerQuality('0xabc'));
    expect(foghorn.fetchIndexerQuality).toHaveBeenCalledWith('0xabc');
  });
});

describe('useDeploymentNames', () => {
  it('does not fetch for an empty list', () => {
    const { result } = renderHook(() => useDeploymentNames([]), { wrapper: wrapper() });
    expect(result.current.fetchStatus).toBe('idle');
    expect(foghorn.fetchDeploymentNames).not.toHaveBeenCalled();
  });

  it('deduplicates and sorts before asking, so one set of hashes is one cache entry', async () => {
    vi.mocked(foghorn.fetchDeploymentNames).mockResolvedValue({} as never);
    await settled(() => useDeploymentNames(['Qmb', 'Qma', 'Qmb']));
    expect(foghorn.fetchDeploymentNames).toHaveBeenCalledWith(['Qma', 'Qmb']);
  });
});

describe('useVerdicts', () => {
  it('passes the params object straight through', async () => {
    vi.mocked(foghorn.fetchVerdicts).mockResolvedValue({ verdicts: [] } as never);
    const params = { kind: 'poi', severity: 'high', limit: 10 };
    await settled(() => useVerdicts(params));
    expect(foghorn.fetchVerdicts).toHaveBeenCalledWith(params);
  });

  it('defaults to an empty filter', async () => {
    vi.mocked(foghorn.fetchVerdicts).mockResolvedValue({ verdicts: [] } as never);
    await settled(() => useVerdicts());
    expect(foghorn.fetchVerdicts).toHaveBeenCalledWith({});
  });
});

describe('useNeedsAttention', () => {
  it('forwards an undefined kind rather than inventing one', async () => {
    vi.mocked(foghorn.fetchNeedsAttention).mockResolvedValue({ items: [] } as never);
    await settled(() => useNeedsAttention());
    expect(foghorn.fetchNeedsAttention).toHaveBeenCalledWith(undefined);
  });

  it('forwards a kind when given one', async () => {
    vi.mocked(foghorn.fetchNeedsAttention).mockResolvedValue({ items: [] } as never);
    await settled(() => useNeedsAttention('stalled'));
    expect(foghorn.fetchNeedsAttention).toHaveBeenCalledWith('stalled');
  });
});

describe('useIndexerAllocationsQos', () => {
  it('folds the rows into a Map keyed by deployment id', async () => {
    vi.mocked(foghorn.fetchIndexerAllocationsQos).mockResolvedValue({
      indexer_address: '0xabc',
      deployments: [
        { deployment_id: 'Qma', success_rate: 0.99, blocks_behind: 2, query_count: 100 },
        { deployment_id: 'Qmb', success_rate: null, blocks_behind: null, query_count: null },
      ],
    } as never);

    const result = await settled(() => useIndexerAllocationsQos('0xabc'));
    const map = result.current.data as Map<string, unknown>;

    expect(map.size).toBe(2);
    expect(map.get('Qma')).toEqual({ successRate: 0.99, blocksBehind: 2, queryCount: 100 });
    // Nulls survive as nulls: "not measured" must not become a confident zero.
    expect(map.get('Qmb')).toEqual({ successRate: null, blocksBehind: null, queryCount: null });
  });

  it('returns an empty Map rather than throwing when there are no allocations', async () => {
    vi.mocked(foghorn.fetchIndexerAllocationsQos).mockResolvedValue({
      indexer_address: '0xabc',
      deployments: [],
    } as never);
    const result = await settled(() => useIndexerAllocationsQos('0xabc'));
    expect((result.current.data as Map<string, unknown>).size).toBe(0);
  });
});

describe('useDeploymentQos', () => {
  it('lowercases the indexer address it keys on', async () => {
    // Foghorn returns checksummed addresses; every caller looks up a lowercased one.
    vi.mocked(foghorn.fetchDeploymentQos).mockResolvedValue({
      deployment_id: 'Qma',
      indexers: [
        { indexer_address: '0xAbCdEf0000000000000000000000000000000001', success_rate: 0.5, blocks_behind: 9, query_count: 7 },
      ],
    } as never);

    const result = await settled(() => useDeploymentQos('Qma'));
    const map = result.current.data as Map<string, unknown>;

    expect(map.has('0xabcdef0000000000000000000000000000000001')).toBe(true);
    expect(map.get('0xabcdef0000000000000000000000000000000001')).toEqual({
      successRate: 0.5,
      blocksBehind: 9,
      queryCount: 7,
    });
  });
});

describe('useFoghornGrades', () => {
  it('folds the 30-day leaderboard into a Map keyed by lowercased address', async () => {
    vi.mocked(foghorn.fetchFoghornIndexers).mockResolvedValue({
      indexers: [
        {
          indexer_address: '0xAAAA000000000000000000000000000000000001',
          grade: 'B',
          rated: true,
          composite: 71.5,
          verdict_count: 3,
          needs_attention: false,
          sybil_flag: false,
        },
      ],
    } as never);

    const result = await settled(() => useFoghornGrades());
    const map = result.current.data as Map<string, unknown>;

    expect(foghorn.fetchFoghornIndexers).toHaveBeenCalledWith(30, 'desc');
    expect(map.get('0xaaaa000000000000000000000000000000000001')).toEqual({
      grade: 'B',
      rated: true,
      composite: 71.5,
      verdictCount: 3,
      needsAttention: false,
      sybilFlag: false,
    });
  });

  it('keeps an unrated indexer in the map rather than dropping it', async () => {
    // A missing entry renders as "no Foghorn data"; `rated: false` renders as "not enough
    // queries to grade", which is the true statement.
    vi.mocked(foghorn.fetchFoghornIndexers).mockResolvedValue({
      indexers: [
        {
          indexer_address: '0xbbbb000000000000000000000000000000000002',
          grade: '—',
          rated: false,
          composite: 0,
          verdict_count: 0,
          needs_attention: false,
          sybil_flag: false,
        },
      ],
    } as never);

    const result = await settled(() => useFoghornGrades());
    const map = result.current.data as Map<string, { rated: boolean }>;
    expect(map.get('0xbbbb000000000000000000000000000000000002')?.rated).toBe(false);
  });
});

describe('the paged feeds', () => {
  it('useFoghornFeed defaults to 50 and forwards an override', async () => {
    vi.mocked(foghorn.fetchFoghornFeed).mockResolvedValue({ events: [], count: 0 } as never);
    await settled(() => useFoghornFeed());
    expect(foghorn.fetchFoghornFeed).toHaveBeenCalledWith(50);

    vi.mocked(foghorn.fetchFoghornFeed).mockClear();
    await settled(() => useFoghornFeed(5));
    expect(foghorn.fetchFoghornFeed).toHaveBeenCalledWith(5);
  });

  it('useQosBuckets defaults to 24 hours and 500 rows', async () => {
    vi.mocked(foghorn.fetchQosBuckets).mockResolvedValue({ buckets: [] } as never);
    await settled(() => useQosBuckets());
    expect(foghorn.fetchQosBuckets).toHaveBeenCalledWith(24, 500);
  });

  it('useQosBuckets forwards an explicit range', async () => {
    vi.mocked(foghorn.fetchQosBuckets).mockResolvedValue({ buckets: [] } as never);
    await settled(() => useQosBuckets(1, 10));
    expect(foghorn.fetchQosBuckets).toHaveBeenCalledWith(1, 10);
  });

  it('useQosCompare defaults to 3 days and forwards an override', async () => {
    vi.mocked(foghorn.fetchQosCompare).mockResolvedValue({ pairs: [] } as never);
    await settled(() => useQosCompare());
    expect(foghorn.fetchQosCompare).toHaveBeenCalledWith(3);

    vi.mocked(foghorn.fetchQosCompare).mockClear();
    await settled(() => useQosCompare(30));
    expect(foghorn.fetchQosCompare).toHaveBeenCalledWith(30);
  });
});
