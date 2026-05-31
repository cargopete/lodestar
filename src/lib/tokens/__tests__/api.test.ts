import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// api.ts records deficiencies (which would touch the filesystem) — mock that
// boundary entirely. The module keeps a process-scoped token bucket, so we
// reset modules between tests to start each one with a full burst.

const recordDeficiency = vi.fn();
vi.mock('../deficiencies', () => ({ recordDeficiency: (...a: unknown[]) => recordDeficiency(...a) }));

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  recordDeficiency.mockReset();
  mockFetch = vi.fn();
  vi.stubGlobal('fetch', mockFetch);
  process.env.TOKEN_API_KEY = 'test-key';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete process.env.TOKEN_API_KEY;
});

function ok(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

async function importFresh() {
  return await import('../api');
}

describe('tokenApiGet', () => {
  it('throws when TOKEN_API_KEY is not set', async () => {
    delete process.env.TOKEN_API_KEY;
    const { tokenApiGet } = await importFresh();
    await expect(tokenApiGet('/v1/evm/tokens', {})).rejects.toThrow('TOKEN_API_KEY not set');
  });

  it('builds the URL with the base, path, and query string and sends the api key header', async () => {
    mockFetch.mockResolvedValue(ok({ data: [] }));
    const { tokenApiGet } = await importFresh();
    await tokenApiGet('/v1/evm/tokens', { network: 'mainnet', contract: '0xabc', limit: 5 });
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('https://token-api.thegraph.com/v1/evm/tokens?network=mainnet&contract=0xabc&limit=5');
    expect((opts.headers as Record<string, string>)['X-Api-Key']).toBe('test-key');
  });

  it('returns the parsed envelope on a 200', async () => {
    mockFetch.mockResolvedValue(ok({ data: [{ x: 1 }], duration_ms: 10 }));
    const { tokenApiGet } = await importFresh();
    const env = await tokenApiGet<{ x: number }>('/v1/evm/tokens', {});
    expect(env.data).toEqual([{ x: 1 }]);
    expect(env.duration_ms).toBe(10);
  });

  it('retries on a 5xx then succeeds', async () => {
    vi.useFakeTimers();
    mockFetch
      .mockResolvedValueOnce(new Response('err', { status: 502 }))
      .mockResolvedValueOnce(ok({ data: ['ok'] }));
    const { tokenApiGet } = await importFresh();
    const p = tokenApiGet('/v1/evm/tokens', {});
    await vi.runAllTimersAsync();
    const env = await p;
    expect(env.data).toEqual(['ok']);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('retries on a 429 then succeeds', async () => {
    vi.useFakeTimers();
    mockFetch
      .mockResolvedValueOnce(new Response('slow down', { status: 429 }))
      .mockResolvedValueOnce(ok({ data: ['ok'] }));
    const { tokenApiGet } = await importFresh();
    const p = tokenApiGet('/v1/evm/tokens', {});
    await vi.runAllTimersAsync();
    await p;
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('throws with status and body snippet on a non-retryable 4xx', async () => {
    mockFetch.mockResolvedValue(new Response('bad request body', { status: 400 }));
    const { tokenApiGet } = await importFresh();
    await expect(tokenApiGet('/v1/evm/tokens', {})).rejects.toThrow(/Token API 400 \/v1\/evm\/tokens: bad request body/);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('gives up after 3 attempts on sustained 5xx', async () => {
    vi.useFakeTimers();
    mockFetch.mockResolvedValue(new Response('down', { status: 503 }));
    const { tokenApiGet } = await importFresh();
    const p = tokenApiGet('/v1/evm/tokens', {});
    const assertion = expect(p).rejects.toThrow(/Token API 503/);
    await vi.runAllTimersAsync();
    await assertion;
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});

describe('fetchTokenMetadata', () => {
  it('returns the first token row when present', async () => {
    mockFetch.mockResolvedValue(ok({ data: [{ contract: '0x1', symbol: 'FOO', total_supply: 100, icon: { web3icon: 'foo' } }] }));
    const { fetchTokenMetadata } = await importFresh();
    const t = await fetchTokenMetadata('mainnet', '0x1');
    expect(t?.symbol).toBe('FOO');
    expect(recordDeficiency).not.toHaveBeenCalled();
  });

  it('records TOKEN_API_TOKENS_EMPTY and returns null on empty data', async () => {
    mockFetch.mockResolvedValue(ok({ data: [] }));
    const { fetchTokenMetadata } = await importFresh();
    const t = await fetchTokenMetadata('mainnet', '0xabc');
    expect(t).toBeNull();
    expect(recordDeficiency).toHaveBeenCalledWith('TOKEN_API_TOKENS_EMPTY', expect.stringContaining('0xabc'));
  });

  it('records missing total_supply and missing icon deficiencies', async () => {
    mockFetch.mockResolvedValue(ok({ data: [{ contract: '0x1', symbol: 'BAR', total_supply: null, icon: null }] }));
    const { fetchTokenMetadata } = await importFresh();
    await fetchTokenMetadata('mainnet', '0x1');
    const codes = recordDeficiency.mock.calls.map((c) => c[0]);
    expect(codes).toContain('TOKEN_API_NO_TOTAL_SUPPLY');
    expect(codes).toContain('TOKEN_API_MISSING_ICON');
  });
});

describe('fetchPoolOhlc', () => {
  it('de-dupes rows by datetime keeping the highest-transaction bar and sorts ascending', async () => {
    mockFetch.mockResolvedValue(
      ok({
        data: [
          { datetime: '2026-01-02', transactions: 5, close: 2 },
          { datetime: '2026-01-01', transactions: 1, close: 1 },
          { datetime: '2026-01-02', transactions: 9, close: 99 }, // dupe, more txns -> wins
        ],
      }),
    );
    const { fetchPoolOhlc } = await importFresh();
    const out = await fetchPoolOhlc('mainnet', '0xpool');
    expect(out.map((r) => r.datetime)).toEqual(['2026-01-01', '2026-01-02']);
    expect(out[1].close).toBe(99);
    expect(recordDeficiency).toHaveBeenCalledWith('TOKEN_API_OHLC_DUPES', expect.any(String));
  });

  it('does not record a dupes deficiency when datetimes are all distinct', async () => {
    mockFetch.mockResolvedValue(
      ok({ data: [{ datetime: '2026-01-01', transactions: 1 }, { datetime: '2026-01-02', transactions: 1 }] }),
    );
    const { fetchPoolOhlc } = await importFresh();
    const out = await fetchPoolOhlc('mainnet', '0xpool');
    expect(out).toHaveLength(2);
    expect(recordDeficiency).not.toHaveBeenCalled();
  });

  it('adds a page param only when page > 1', async () => {
    mockFetch.mockResolvedValue(ok({ data: [] }));
    const { fetchPoolOhlc } = await importFresh();
    await fetchPoolOhlc('mainnet', '0xpool', '1d', 31, 2);
    expect(mockFetch.mock.calls[0][0]).toContain('page=2');
  });

  it('returns an empty array when data is missing', async () => {
    mockFetch.mockResolvedValue(ok({}));
    const { fetchPoolOhlc } = await importFresh();
    expect(await fetchPoolOhlc('mainnet', '0xpool')).toEqual([]);
  });
});

describe('fetchHolders / fetchPoolsForToken', () => {
  it('returns holder data, defaulting to empty', async () => {
    mockFetch.mockResolvedValueOnce(ok({ data: [{ address: '0xh', amount: '5' }] }));
    const { fetchHolders } = await importFresh();
    expect(await fetchHolders('mainnet', '0xc')).toEqual([{ address: '0xh', amount: '5' }]);
  });

  it('returns [] when holder data is absent', async () => {
    mockFetch.mockResolvedValue(ok({}));
    const { fetchHolders } = await importFresh();
    expect(await fetchHolders('mainnet', '0xc')).toEqual([]);
  });

  it('returns pools, defaulting to empty', async () => {
    mockFetch.mockResolvedValue(ok({}));
    const { fetchPoolsForToken } = await importFresh();
    expect(await fetchPoolsForToken('mainnet', '0xc')).toEqual([]);
  });
});

describe('fetchSwapsForToken', () => {
  it('merges input-side and output-side swaps, sorts newest-first, and caps at limit', async () => {
    // Two parallel calls: as input, as output.
    mockFetch
      .mockResolvedValueOnce(ok({ data: [{ transaction_id: 'a', timestamp: 100 }, { transaction_id: 'b', timestamp: 300 }] }))
      .mockResolvedValueOnce(ok({ data: [{ transaction_id: 'c', timestamp: 200 }] }));
    const { fetchSwapsForToken } = await importFresh();
    const out = await fetchSwapsForToken('mainnet', '0xc', 2);
    expect(out.map((s) => s.transaction_id)).toEqual(['b', 'c']);
  });

  it('tolerates one side returning no data array', async () => {
    mockFetch
      .mockResolvedValueOnce(ok({ data: [{ transaction_id: 'a', timestamp: 100 }] }))
      .mockResolvedValueOnce(ok({}));
    const { fetchSwapsForToken } = await importFresh();
    const out = await fetchSwapsForToken('mainnet', '0xc', 10);
    expect(out).toHaveLength(1);
  });
});
