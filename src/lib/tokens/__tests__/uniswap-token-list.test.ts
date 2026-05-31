import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The module caches the fetched list in-process for the lifetime of the
// server. To exercise both the success and failure paths independently we
// reset the module registry before each test and re-import fresh.

const LIST_FIXTURE = {
  tokens: [
    { chainId: 1, address: '0xAaBbCcDdEeFf00112233445566778899AabbCcDd', symbol: 'FOO', logoURI: 'https://logos/foo.png' },
    { chainId: 42161, address: '0x1111111111111111111111111111111111111111', symbol: 'BAR', logoURI: 'https://logos/bar.png' },
    // Entry missing logoURI — must be skipped.
    { chainId: 1, address: '0x2222222222222222222222222222222222222222', symbol: 'NOLOGO' },
    // Entry missing address — must be skipped.
    { chainId: 1, symbol: 'NOADDR', logoURI: 'https://logos/x.png' },
  ],
};

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  mockFetch = vi.fn();
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function importFresh() {
  return await import('../uniswap-token-list');
}

describe('getUniswapLogoUri', () => {
  it('returns the logo URI for a known mainnet token (case-insensitive lookup)', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify(LIST_FIXTURE), { status: 200 }),
    );
    const { getUniswapLogoUri } = await importFresh();
    const uri = await getUniswapLogoUri('mainnet', '0xAABBCCDDEEFF00112233445566778899AABBCCDD');
    expect(uri).toBe('https://logos/foo.png');
  });

  it('keys by chain id so the same address on a different chain does not collide', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify(LIST_FIXTURE), { status: 200 }),
    );
    const { getUniswapLogoUri } = await importFresh();
    expect(await getUniswapLogoUri('arbitrum', '0x1111111111111111111111111111111111111111')).toBe('https://logos/bar.png');
    // Same address on mainnet is not in the list -> null.
    expect(await getUniswapLogoUri('mainnet', '0x1111111111111111111111111111111111111111')).toBeNull();
  });

  it('returns null for an address not in the list', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify(LIST_FIXTURE), { status: 200 }),
    );
    const { getUniswapLogoUri } = await importFresh();
    expect(await getUniswapLogoUri('mainnet', '0xdeadbeef00000000000000000000000000000000')).toBeNull();
  });

  it('skips entries missing logoURI or address', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify(LIST_FIXTURE), { status: 200 }),
    );
    const { getUniswapLogoUri } = await importFresh();
    expect(await getUniswapLogoUri('mainnet', '0x2222222222222222222222222222222222222222')).toBeNull();
  });

  it('defaults unknown chains to chain id 1 (mainnet)', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify(LIST_FIXTURE), { status: 200 }),
    );
    const { getUniswapLogoUri } = await importFresh();
    // 'gnosis' is not in CHAIN_ID, so it falls back to chainId 1, which has FOO.
    expect(await getUniswapLogoUri('gnosis', '0xAABBCCDDEEFF00112233445566778899AABBCCDD')).toBe('https://logos/foo.png');
  });

  it('returns null (empty cached map) when the fetch is not ok', async () => {
    mockFetch.mockResolvedValue(new Response('nope', { status: 503 }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { getUniswapLogoUri } = await importFresh();
    expect(await getUniswapLogoUri('mainnet', '0xAABBCCDDEEFF00112233445566778899AABBCCDD')).toBeNull();
    warn.mockRestore();
  });

  it('returns null when fetch throws (network error swallowed)', async () => {
    mockFetch.mockRejectedValue(new Error('boom'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { getUniswapLogoUri } = await importFresh();
    expect(await getUniswapLogoUri('mainnet', '0xAABBCCDDEEFF00112233445566778899AABBCCDD')).toBeNull();
    warn.mockRestore();
  });

  it('fetches the list only once and serves subsequent lookups from cache', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify(LIST_FIXTURE), { status: 200 }),
    );
    const { getUniswapLogoUri } = await importFresh();
    await getUniswapLogoUri('mainnet', '0xAABBCCDDEEFF00112233445566778899AABBCCDD');
    await getUniswapLogoUri('arbitrum', '0x1111111111111111111111111111111111111111');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('handles a response without a tokens array gracefully', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    const { getUniswapLogoUri } = await importFresh();
    expect(await getUniswapLogoUri('mainnet', '0xAABBCCDDEEFF00112233445566778899AABBCCDD')).toBeNull();
  });
});
