// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const useAccount = vi.fn();
const useReadContract = vi.fn();
vi.mock('wagmi', () => ({
  useAccount: () => useAccount(),
  useReadContract: (cfg: unknown) => useReadContract(cfg),
}));

// Avoid pulling in wagmi/createConfig via the real wallet module.
vi.mock('@/lib/wallet', () => ({
  CONTRACTS: { grt: '0xGRT', staking: '0xSTAKING' },
}));

import { useGRTBalance } from '../useGRTBalance';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // eslint-disable-next-line react/display-name
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useGRTBalance', () => {
  it('converts raw wei bigints into GRT numbers for balance and allowance', () => {
    useAccount.mockReturnValue({ address: '0xABC' });
    // First call -> balanceOf, second call -> allowance
    useReadContract
      .mockReturnValueOnce({ data: BigInt('2000000000000000000'), isLoading: false, refetch: vi.fn() })
      .mockReturnValueOnce({ data: BigInt('500000000000000000'), isLoading: false, refetch: vi.fn() });

    const { result } = renderHook(() => useGRTBalance(), { wrapper: wrapper() });

    expect(result.current.balance).toBe(2);
    expect(result.current.allowance).toBe(0.5);
    expect(result.current.rawBalance).toBe(BigInt('2000000000000000000'));
    expect(result.current.rawAllowance).toBe(BigInt('500000000000000000'));
    expect(result.current.isLoading).toBe(false);
  });

  it('defaults to zero balances and BigInt(0) raws when data is undefined', () => {
    useAccount.mockReturnValue({ address: undefined });
    useReadContract.mockReturnValue({ data: undefined, isLoading: false, refetch: vi.fn() });

    const { result } = renderHook(() => useGRTBalance(), { wrapper: wrapper() });

    expect(result.current.balance).toBe(0);
    expect(result.current.allowance).toBe(0);
    expect(result.current.rawBalance).toBe(BigInt(0));
    expect(result.current.rawAllowance).toBe(BigInt(0));
  });

  it('reports loading if either underlying query is loading', () => {
    useAccount.mockReturnValue({ address: '0xABC' });
    useReadContract
      .mockReturnValueOnce({ data: undefined, isLoading: true, refetch: vi.fn() })
      .mockReturnValueOnce({ data: undefined, isLoading: false, refetch: vi.fn() });

    const { result } = renderHook(() => useGRTBalance(), { wrapper: wrapper() });
    expect(result.current.isLoading).toBe(true);
  });

  it('refetch() triggers both underlying refetches', () => {
    const balRefetch = vi.fn();
    const allowRefetch = vi.fn();
    useAccount.mockReturnValue({ address: '0xABC' });
    useReadContract
      .mockReturnValueOnce({ data: BigInt(0), isLoading: false, refetch: balRefetch })
      .mockReturnValueOnce({ data: BigInt(0), isLoading: false, refetch: allowRefetch });

    const { result } = renderHook(() => useGRTBalance(), { wrapper: wrapper() });
    result.current.refetch();
    expect(balRefetch).toHaveBeenCalledTimes(1);
    expect(allowRefetch).toHaveBeenCalledTimes(1);
  });

  it('passes args only when an address is connected (query enabled gating)', () => {
    useAccount.mockReturnValue({ address: '0xDEAD' });
    useReadContract.mockReturnValue({ data: undefined, isLoading: false, refetch: vi.fn() });

    renderHook(() => useGRTBalance(), { wrapper: wrapper() });

    const firstCfg = useReadContract.mock.calls[0][0] as { args?: unknown[]; query: { enabled: boolean } };
    expect(firstCfg.query.enabled).toBe(true);
    expect(firstCfg.args).toEqual(['0xDEAD']);
  });
});
