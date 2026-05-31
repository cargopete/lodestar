import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchNetworkStats,
  fetchEpochHistory,
  fetchIndexers,
  fetchEnrichedIndexers,
  fetchGRTPrice,
  fetchIndexerProvisions,
  fetchDelegatorPortfolio,
  fetchCuratorPortfolio,
  fetchSubgraphDeployments,
  fetchManifestAnalysis,
  fetchVotes,
  submitVote,
  fetchTokenMetrics,
  fetchDelegationFlows,
  fetchWithRetry,
} from '@/lib/api';
import type { VoteMessage } from '@/lib/voting';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe('api: URL building', () => {
  it('builds epoch URL with the count query param', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ data: { epochs: [] } }));
    await fetchEpochHistory(42);
    expect(mockFetch).toHaveBeenCalledWith('/api/epochs?count=42');
  });

  it('defaults epoch count to 30', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ data: {} }));
    await fetchEpochHistory();
    expect(mockFetch).toHaveBeenCalledWith('/api/epochs?count=30');
  });

  it('encodes indexer params with defaults applied', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ data: { indexers: [] } }));
    await fetchIndexers({});
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('/api/indexers?');
    expect(url).toContain('first=25');
    expect(url).toContain('skip=0');
    expect(url).toContain('orderBy=stakedTokens');
    expect(url).toContain('orderDirection=desc');
  });

  it('overrides indexer params when provided', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ data: {} }));
    await fetchIndexers({ first: 5, skip: 10, orderBy: 'createdAt', orderDirection: 'asc' });
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('first=5');
    expect(url).toContain('skip=10');
    expect(url).toContain('orderBy=createdAt');
    expect(url).toContain('orderDirection=asc');
  });

  it('URL-encodes addresses to prevent injection', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ data: {} }));
    await fetchIndexerProvisions('0xAbc&evil=1');
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain(encodeURIComponent('0xAbc&evil=1'));
    expect(url).not.toContain('&evil=1');
  });

  it('selects delegator vs curator portfolio via type param', async () => {
    mockFetch.mockImplementation(() => Promise.resolve(jsonResponse({ data: {} })));
    await fetchDelegatorPortfolio('0xdel');
    await fetchCuratorPortfolio('0xcur');
    expect(mockFetch.mock.calls[0][0]).toContain('type=delegator');
    expect(mockFetch.mock.calls[1][0]).toContain('type=curator');
  });

  it('omits empty subgraph-deployment params', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ data: [] }));
    await fetchSubgraphDeployments();
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toBe('/api/subgraph-deployments?');
  });

  it('includes only provided subgraph-deployment params', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ data: [] }));
    await fetchSubgraphDeployments({ first: 3, orderDirection: 'asc' });
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('first=3');
    expect(url).toContain('orderDirection=asc');
    expect(url).not.toContain('skip=');
  });

  it('builds vote URL with period and voter', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ votes: [] }));
    await fetchVotes('2026-05', '0xvoter');
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('period=2026-05');
    expect(url).toContain('voter=0xvoter');
  });

  it('builds delegation-flows URL with compare flag', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ data: [] }));
    await fetchDelegationFlows(7, true);
    expect(mockFetch.mock.calls[0][0]).toBe('/api/delegation-flows?days=7&compare=1');
  });

  it('omits compare flag when false', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ data: [] }));
    await fetchDelegationFlows(7, false);
    expect(mockFetch.mock.calls[0][0]).toBe('/api/delegation-flows?days=7');
  });
});

describe('api: response unwrapping', () => {
  it('unwraps the .data envelope', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ data: { totalSupply: '123' } }));
    const result = await fetchNetworkStats();
    expect(result).toEqual({ totalSupply: '123' });
  });

  it('returns the raw json for enriched indexers (no envelope)', async () => {
    const payload = { indexers: [], computedAt: 1 };
    mockFetch.mockResolvedValue(jsonResponse(payload));
    expect(await fetchEnrichedIndexers()).toEqual(payload);
  });

  it('returns raw json for price endpoint', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ price: 0.1, change24h: -2 }));
    expect(await fetchGRTPrice()).toEqual({ price: 0.1, change24h: -2 });
  });

  it('falls back to [] when token-metrics data is missing', async () => {
    mockFetch.mockResolvedValue(jsonResponse({}));
    expect(await fetchTokenMetrics()).toEqual([]);
  });

  it('falls back to [] when delegation-flows data is missing', async () => {
    mockFetch.mockResolvedValue(jsonResponse({}));
    expect(await fetchDelegationFlows()).toEqual([]);
  });
});

describe('api: error handling (4xx vs 5xx)', () => {
  it('throws with status code on 404', async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, 404));
    await expect(fetchNetworkStats()).rejects.toThrow('Network stats failed: 404');
  });

  it('throws with status code on 500', async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, 500));
    await expect(fetchEpochHistory()).rejects.toThrow('Epoch history failed: 500');
  });

  it('throws static message for enriched indexers on failure', async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, 503));
    await expect(fetchEnrichedIndexers()).rejects.toThrow('Enriched data not available');
  });

  it('throws manifest error with status', async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, 422));
    await expect(fetchManifestAnalysis('Qm')).rejects.toThrow('Manifest analysis failed: 422');
  });
});

describe('api: submitVote', () => {
  const message = { voter: '0x1', indexer: '0x2' } as unknown as VoteMessage;

  it('POSTs JSON body with content-type header', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ success: true, vote: {} }));
    await submitVote(message, '0xsig');
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/vote');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ message, signature: '0xsig' });
  });

  it('throws the server error message on failure', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: 'duplicate vote' }, 409));
    await expect(submitVote(message, '0xsig')).rejects.toThrow('duplicate vote');
  });

  it('falls back to generic message when server omits error', async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, 400));
    await expect(submitVote(message, '0xsig')).rejects.toThrow('Failed to submit vote');
  });
});

describe('api: fetchWithRetry backoff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns immediately on first success without delay', async () => {
    const fetcher = vi.fn().mockResolvedValue('ok');
    await expect(fetchWithRetry(fetcher)).resolves.toBe('ok');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('retries with increasing backoff and eventually succeeds', async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail1'))
      .mockRejectedValueOnce(new Error('fail2'))
      .mockResolvedValue('recovered');

    const promise = fetchWithRetry(fetcher, 3, 100);
    // First attempt fails synchronously-ish; advance through both backoffs.
    await vi.advanceTimersByTimeAsync(100); // delay * 1
    await vi.advanceTimersByTimeAsync(200); // delay * 2
    await expect(promise).resolves.toBe('recovered');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('throws the last error after exhausting retries', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('persistent'));
    const promise = fetchWithRetry(fetcher, 2, 50);
    const assertion = expect(promise).rejects.toThrow('persistent');
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
