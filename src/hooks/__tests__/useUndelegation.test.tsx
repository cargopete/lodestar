// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const useAccount = vi.fn();
vi.mock('wagmi', () => ({ useAccount: () => useAccount() }));

const writeContract = vi.fn();
const waitForTransactionReceipt = vi.fn();
vi.mock('wagmi/actions', () => ({
  writeContract: (...a: unknown[]) => writeContract(...a),
  waitForTransactionReceipt: (...a: unknown[]) => waitForTransactionReceipt(...a),
}));

vi.mock('@/lib/wallet', () => ({
  config: {},
  CONTRACTS: { staking: '0xStaking', subgraphService: '0xService' },
}));
vi.mock('@/lib/staking-abi', () => ({ STAKING_ABI: [] }));

import { useUndelegation } from '../useUndelegation';

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
  // eslint-disable-next-line react/display-name
  const W = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { invalidateSpy, W };
}

beforeEach(() => {
  vi.clearAllMocks();
  useAccount.mockReturnValue({ address: '0xUser' });
  waitForTransactionReceipt.mockResolvedValue({ status: 'success' });
});

describe('useUndelegation', () => {
  it('starts idle', () => {
    const { W } = makeWrapper();
    const { result } = renderHook(() => useUndelegation(), { wrapper: W });
    expect(result.current.step).toBe('idle');
    expect(result.current.error).toBeNull();
    expect(result.current.txHash).toBeUndefined();
  });

  it('startUndelegate errors when wallet not connected', async () => {
    useAccount.mockReturnValue({ address: undefined });
    const { W } = makeWrapper();
    const { result } = renderHook(() => useUndelegation(), { wrapper: W });

    await act(async () => {
      await result.current.startUndelegate('0xIndexer', 5n);
    });
    expect(result.current.step).toBe('error');
    expect(result.current.error).toBe('Wallet not connected');
    expect(writeContract).not.toHaveBeenCalled();
  });

  it('startUndelegate calls undelegate and confirms', async () => {
    writeContract.mockResolvedValue('0xUndelegateHash');
    const { invalidateSpy, W } = makeWrapper();
    const { result } = renderHook(() => useUndelegation(), { wrapper: W });

    await act(async () => {
      await result.current.startUndelegate('0xIndexer', 123n);
    });
    await waitFor(() => expect(result.current.step).toBe('confirmed'));

    expect(writeContract.mock.calls[0][1]).toMatchObject({
      functionName: 'undelegate',
      args: ['0xIndexer', '0xService', 123n],
    });
    expect(result.current.txHash).toBe('0xUndelegateHash');
    expect(invalidateSpy).toHaveBeenCalledTimes(3);
  });

  it('withdraw calls withdrawDelegated with nThawRequests=0', async () => {
    writeContract.mockResolvedValue('0xWithdrawHash');
    const { W } = makeWrapper();
    const { result } = renderHook(() => useUndelegation(), { wrapper: W });

    await act(async () => {
      await result.current.withdraw('0xIndexer');
    });
    await waitFor(() => expect(result.current.step).toBe('confirmed'));

    expect(writeContract.mock.calls[0][1]).toMatchObject({
      functionName: 'withdrawDelegated',
      args: ['0xIndexer', '0xService', 0n],
    });
    expect(result.current.txHash).toBe('0xWithdrawHash');
  });

  it('withdraw errors when wallet not connected', async () => {
    useAccount.mockReturnValue({ address: undefined });
    const { W } = makeWrapper();
    const { result } = renderHook(() => useUndelegation(), { wrapper: W });

    await act(async () => {
      await result.current.withdraw('0xIndexer');
    });
    expect(result.current.step).toBe('error');
    expect(result.current.error).toBe('Wallet not connected');
  });

  it('maps a user rejection to a friendly message', async () => {
    writeContract.mockRejectedValue(new Error('user rejected'));
    const { W } = makeWrapper();
    const { result } = renderHook(() => useUndelegation(), { wrapper: W });

    await act(async () => {
      await result.current.startUndelegate('0xIndexer', 1n);
    });
    await waitFor(() => expect(result.current.step).toBe('error'));
    expect(result.current.error).toBe('Transaction rejected');
  });

  it('truncates long errors', async () => {
    writeContract.mockRejectedValue(new Error('y'.repeat(200)));
    const { W } = makeWrapper();
    const { result } = renderHook(() => useUndelegation(), { wrapper: W });

    await act(async () => {
      await result.current.withdraw('0xIndexer');
    });
    await waitFor(() => expect(result.current.step).toBe('error'));
    expect(result.current.error).toBe('y'.repeat(120) + '...');
  });

  it('reset() clears state', async () => {
    useAccount.mockReturnValue({ address: undefined });
    const { W } = makeWrapper();
    const { result } = renderHook(() => useUndelegation(), { wrapper: W });

    await act(async () => {
      await result.current.withdraw('0xIndexer');
    });
    expect(result.current.step).toBe('error');

    act(() => result.current.reset());
    expect(result.current.step).toBe('idle');
    expect(result.current.error).toBeNull();
    expect(result.current.txHash).toBeUndefined();
  });
});
