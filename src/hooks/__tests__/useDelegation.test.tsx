// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { parseEther } from 'viem';

const useAccount = vi.fn();
vi.mock('wagmi', () => ({ useAccount: () => useAccount() }));

const writeContract = vi.fn();
const waitForTransactionReceipt = vi.fn();
vi.mock('wagmi/actions', () => ({
  writeContract: (...a: unknown[]) => writeContract(...a),
  waitForTransactionReceipt: (...a: unknown[]) => waitForTransactionReceipt(...a),
}));

const refetchBalance = vi.fn();
const grtBalanceState = { rawAllowance: 0n, refetch: refetchBalance };
vi.mock('../useGRTBalance', () => ({
  useGRTBalance: () => grtBalanceState,
}));

vi.mock('@/lib/wallet', () => ({
  config: {},
  CONTRACTS: {
    grt: '0xGRT',
    staking: '0xStaking',
    subgraphService: '0xService',
  },
}));
vi.mock('@/lib/staking-abi', () => ({ STAKING_ABI: [], GRT_ABI: [] }));

import { useDelegation } from '../useDelegation';

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
  // eslint-disable-next-line react/display-name
  const W = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, invalidateSpy, W };
}

beforeEach(() => {
  vi.clearAllMocks();
  useAccount.mockReturnValue({ address: '0xUser' });
  grtBalanceState.rawAllowance = 0n;
  grtBalanceState.refetch = refetchBalance;
  waitForTransactionReceipt.mockResolvedValue({ status: 'success' });
});

describe('useDelegation', () => {
  it('starts idle with no error', () => {
    const { W } = makeWrapper();
    const { result } = renderHook(() => useDelegation(), { wrapper: W });
    expect(result.current.step).toBe('idle');
    expect(result.current.error).toBeNull();
  });

  it('errors out when the wallet is not connected', async () => {
    useAccount.mockReturnValue({ address: undefined });
    const { W } = makeWrapper();
    const { result } = renderHook(() => useDelegation(), { wrapper: W });

    await act(async () => {
      await result.current.delegate('0xIndexer', 100);
    });

    expect(result.current.step).toBe('error');
    expect(result.current.error).toBe('Wallet not connected');
    expect(writeContract).not.toHaveBeenCalled();
  });

  it('approves then delegates when allowance is insufficient', async () => {
    grtBalanceState.rawAllowance = 0n;
    writeContract
      .mockResolvedValueOnce('0xApproveHash')
      .mockResolvedValueOnce('0xDelegateHash');

    const { invalidateSpy, W } = makeWrapper();
    const { result } = renderHook(() => useDelegation(), { wrapper: W });

    await act(async () => {
      await result.current.delegate('0xIndexer', 50);
    });

    await waitFor(() => expect(result.current.step).toBe('confirmed'));

    // First write is the approval, second is the delegate.
    expect(writeContract).toHaveBeenCalledTimes(2);
    expect(writeContract.mock.calls[0][1]).toMatchObject({ functionName: 'approve' });
    expect(writeContract.mock.calls[1][1]).toMatchObject({
      functionName: 'delegate',
      args: ['0xIndexer', '0xService', parseEther('50'), 0n],
    });
    expect(result.current.approveTxHash).toBe('0xApproveHash');
    expect(result.current.delegateTxHash).toBe('0xDelegateHash');
    expect(result.current.txHash).toBe('0xDelegateHash');
    expect(invalidateSpy).toHaveBeenCalled();
  });

  it('skips approval when allowance already covers the amount', async () => {
    grtBalanceState.rawAllowance = parseEther('1000');
    writeContract.mockResolvedValueOnce('0xDelegateHash');

    const { W } = makeWrapper();
    const { result } = renderHook(() => useDelegation(), { wrapper: W });

    await act(async () => {
      await result.current.delegate('0xIndexer', 10);
    });
    await waitFor(() => expect(result.current.step).toBe('confirmed'));

    expect(writeContract).toHaveBeenCalledTimes(1);
    expect(writeContract.mock.calls[0][1]).toMatchObject({ functionName: 'delegate' });
    expect(result.current.approveTxHash).toBeUndefined();
  });

  it('uses max approval when requested', async () => {
    grtBalanceState.rawAllowance = 0n;
    writeContract.mockResolvedValueOnce('0xApprove').mockResolvedValueOnce('0xDelegate');
    const { W } = makeWrapper();
    const { result } = renderHook(() => useDelegation(), { wrapper: W });

    await act(async () => {
      await result.current.delegate('0xIndexer', 5, true);
    });
    await waitFor(() => expect(result.current.step).toBe('confirmed'));

    const maxUint = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
    expect(writeContract.mock.calls[0][1].args[1]).toBe(maxUint);
  });

  it('maps a user rejection to a friendly message', async () => {
    grtBalanceState.rawAllowance = parseEther('1000');
    writeContract.mockRejectedValue(new Error('User rejected the request'));
    const { W } = makeWrapper();
    const { result } = renderHook(() => useDelegation(), { wrapper: W });

    await act(async () => {
      await result.current.delegate('0xIndexer', 10);
    });
    await waitFor(() => expect(result.current.step).toBe('error'));
    expect(result.current.error).toBe('Transaction rejected');
  });

  it('truncates long error messages to 120 chars + ellipsis', async () => {
    grtBalanceState.rawAllowance = parseEther('1000');
    const long = 'x'.repeat(300);
    writeContract.mockRejectedValue(new Error(long));
    const { W } = makeWrapper();
    const { result } = renderHook(() => useDelegation(), { wrapper: W });

    await act(async () => {
      await result.current.delegate('0xIndexer', 10);
    });
    await waitFor(() => expect(result.current.step).toBe('error'));
    expect(result.current.error).toBe('x'.repeat(120) + '...');
  });

  it('reset() returns the hook to its initial state', async () => {
    useAccount.mockReturnValue({ address: undefined });
    const { W } = makeWrapper();
    const { result } = renderHook(() => useDelegation(), { wrapper: W });

    await act(async () => {
      await result.current.delegate('0xIndexer', 10);
    });
    expect(result.current.step).toBe('error');

    act(() => result.current.reset());
    expect(result.current.step).toBe('idle');
    expect(result.current.error).toBeNull();
    expect(result.current.txHash).toBeUndefined();
  });
});
