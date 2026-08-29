import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock viem so we control readContract without touching the network.
const readContract = vi.fn();
vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>();
  return {
    ...actual,
    createPublicClient: () => ({ readContract }),
    fallback: vi.fn(() => ({})),
    http: vi.fn(() => ({})),
  };
});

import { fetchTotalSupply } from '@/lib/erc20-supply';

beforeEach(() => {
  readContract.mockReset();
});

describe('fetchTotalSupply', () => {
  it('returns decimal-adjusted supply, fetching decimals on-chain when not provided', async () => {
    // 8-decimal token (e.g. WBTC): 21,000,000 tokens
    readContract.mockImplementation(({ functionName }: { functionName: string }) => {
      if (functionName === 'totalSupply') return Promise.resolve(21_000_000n * 10n ** 8n);
      if (functionName === 'decimals') return Promise.resolve(8);
      throw new Error('unexpected fn');
    });
    const res = await fetchTotalSupply('mainnet', '0xNEW1');
    expect(res).toBe(21_000_000);
  });

  it('uses a passed-in decimals value without an on-chain decimals call', async () => {
    readContract.mockResolvedValueOnce(123n * 10n ** 18n);
    const res = await fetchTotalSupply('mainnet', '0xNEW2', 18);
    expect(res).toBe(123);
    // only one readContract call (totalSupply) since decimals was supplied
    expect(readContract).toHaveBeenCalledTimes(1);
  });

  it('preserves the fractional part of supply', async () => {
    // 1.5 tokens at 18 decimals
    readContract.mockResolvedValueOnce(15n * 10n ** 17n);
    const res = await fetchTotalSupply('mainnet', '0xNEW3', 18);
    expect(res).toBeCloseTo(1.5);
  });

  it('returns null when supply is zero', async () => {
    readContract.mockResolvedValueOnce(0n);
    const res = await fetchTotalSupply('mainnet', '0xNEW4', 18);
    expect(res).toBeNull();
  });

  it('returns null on RPC failure and does not cache the failure', async () => {
    readContract.mockRejectedValueOnce(new Error('rpc down'));
    const first = await fetchTotalSupply('mainnet', '0xRETRY', 18);
    expect(first).toBeNull();
    // a subsequent successful call should hit the chain again (not cached)
    readContract.mockResolvedValueOnce(5n * 10n ** 18n);
    const second = await fetchTotalSupply('mainnet', '0xRETRY', 18);
    expect(second).toBe(5);
  });

  it('caches a successful result (no second readContract)', async () => {
    readContract.mockResolvedValueOnce(9n * 10n ** 18n);
    const first = await fetchTotalSupply('mainnet', '0xCACHED', 18);
    expect(first).toBe(9);
    readContract.mockClear();
    const second = await fetchTotalSupply('mainnet', '0xCACHED', 18);
    expect(second).toBe(9);
    expect(readContract).not.toHaveBeenCalled();
  });
});
