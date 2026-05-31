import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchSpotPrices, fetchSpotPrice } from '@/lib/tokens/spot-price';

vi.mock('@/lib/tokens/deficiencies', () => ({
  recordDeficiency: vi.fn(),
}));

describe('fetchSpotPrices', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
    process.env.GRAPH_API_KEY = 'test-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GRAPH_API_KEY;
  });

  it('returns empty map and records deficiency when API key is missing', async () => {
    const { recordDeficiency } = await import('@/lib/tokens/deficiencies');
    delete process.env.GRAPH_API_KEY;
    const res = await fetchSpotPrices(['0xabc']);
    expect(res.size).toBe(0);
    expect(recordDeficiency).toHaveBeenCalledWith('GRAPH_API_KEY_MISSING', expect.any(String));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns empty map for an empty contract list (no fetch)', async () => {
    const res = await fetchSpotPrices([]);
    expect(res.size).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('computes USD price as derivedETH * ethPriceUSD, keyed lowercase', async () => {
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            bundle: { ethPriceUSD: '2000' },
            tokens: [
              { id: '0xAAA', derivedETH: '0.5' }, // -> 1000
              { id: '0xBBB', derivedETH: '1' }, // -> 2000
            ],
          },
        }),
        { status: 200 }
      )
    );
    const res = await fetchSpotPrices(['0xAAA', '0xBBB']);
    expect(res.get('0xaaa')).toBe(1000);
    expect(res.get('0xbbb')).toBe(2000);
  });

  it('omits tokens without positive derivedETH', async () => {
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            bundle: { ethPriceUSD: '2000' },
            tokens: [
              { id: '0xAAA', derivedETH: '0' },
              { id: '0xBBB', derivedETH: null },
              { id: '0xCCC', derivedETH: '0.1' },
            ],
          },
        }),
        { status: 200 }
      )
    );
    const res = await fetchSpotPrices(['0xAAA', '0xBBB', '0xCCC']);
    expect(res.has('0xaaa')).toBe(false);
    expect(res.has('0xbbb')).toBe(false);
    expect(res.get('0xccc')).toBe(200);
  });

  it('returns empty map when ethPriceUSD is not positive', async () => {
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({ data: { bundle: { ethPriceUSD: '0' }, tokens: [{ id: '0xa', derivedETH: '1' }] } }),
        { status: 200 }
      )
    );
    const res = await fetchSpotPrices(['0xa']);
    expect(res.size).toBe(0);
  });

  it('returns empty map and records deficiency on a non-ok response', async () => {
    const { recordDeficiency } = await import('@/lib/tokens/deficiencies');
    mockFetch.mockResolvedValue(new Response('err', { status: 500 }));
    const res = await fetchSpotPrices(['0xa']);
    expect(res.size).toBe(0);
    expect(recordDeficiency).toHaveBeenCalledWith('SPOT_PRICE_QUERY_FAILED', expect.any(String));
  });

  it('returns empty map on a GraphQL errors body', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ errors: [{ message: 'nope' }] }), { status: 200 })
    );
    const res = await fetchSpotPrices(['0xa']);
    expect(res.size).toBe(0);
  });
});

describe('fetchSpotPrice', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
    process.env.GRAPH_API_KEY = 'test-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GRAPH_API_KEY;
  });

  it('returns the single price for a contract', async () => {
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({ data: { bundle: { ethPriceUSD: '2000' }, tokens: [{ id: '0xAaA', derivedETH: '0.5' }] } }),
        { status: 200 }
      )
    );
    const res = await fetchSpotPrice('0xAAA');
    expect(res).toBe(1000);
  });

  it('returns null when the contract is absent from the result', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ data: { bundle: { ethPriceUSD: '2000' }, tokens: [] } }), { status: 200 })
    );
    const res = await fetchSpotPrice('0xAAA');
    expect(res).toBeNull();
  });
});
