// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const useAccount = vi.fn();
const signTypedDataAsync = vi.fn();
vi.mock('wagmi', () => ({
  useAccount: () => useAccount(),
  useSignTypedData: () => ({ signTypedDataAsync }),
}));

vi.mock('@/lib/api', () => ({
  fetchVotes: vi.fn(),
  submitVote: vi.fn(),
}));

import * as api from '@/lib/api';
import { getCurrentPeriod } from '@/lib/voting';
import { useVotes, useSubmitVote } from '../useVoting';

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // eslint-disable-next-line react/display-name
  const W = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, W };
}

beforeEach(() => {
  vi.clearAllMocks();
  useAccount.mockReturnValue({ address: '0xVOTER' });
});

describe('useVotes', () => {
  it('fetches the current period and lowercased voter when none is given', async () => {
    vi.mocked(api.fetchVotes).mockResolvedValue({ period: '2026-05', tallies: [], voters: [], userVote: null });
    const { W } = makeWrapper();
    const { result } = renderHook(() => useVotes(), { wrapper: W });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.fetchVotes).toHaveBeenCalledWith(getCurrentPeriod(), '0xvoter');
  });

  it('honours an explicit period', async () => {
    vi.mocked(api.fetchVotes).mockResolvedValue({ period: '2025-01', tallies: [], voters: [], userVote: null });
    const { W } = makeWrapper();
    const { result } = renderHook(() => useVotes('2025-01'), { wrapper: W });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.fetchVotes).toHaveBeenCalledWith('2025-01', '0xvoter');
  });

  it('passes an undefined voter when no wallet is connected', async () => {
    useAccount.mockReturnValue({ address: undefined });
    vi.mocked(api.fetchVotes).mockResolvedValue({ period: '2026-05', tallies: [], voters: [], userVote: null });
    const { W } = makeWrapper();
    const { result } = renderHook(() => useVotes(), { wrapper: W });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.fetchVotes).toHaveBeenCalledWith(getCurrentPeriod(), undefined);
  });
});

describe('useSubmitVote', () => {
  it('rejects when no wallet is connected', async () => {
    useAccount.mockReturnValue({ address: undefined });
    const { W } = makeWrapper();
    const { result } = renderHook(() => useSubmitVote(), { wrapper: W });

    await act(async () => {
      await expect(result.current.mutateAsync('0xIndexer')).rejects.toThrow('Wallet not connected');
    });
    expect(signTypedDataAsync).not.toHaveBeenCalled();
  });

  it('signs an EIP-712 vote and submits the message + signature', async () => {
    signTypedDataAsync.mockResolvedValue('0xsig');
    vi.mocked(api.submitVote).mockResolvedValue({ ok: true } as never);
    const { W } = makeWrapper();
    const { result } = renderHook(() => useSubmitVote(), { wrapper: W });

    await act(async () => {
      await result.current.mutateAsync('0xINDEXER');
    });

    expect(signTypedDataAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        primaryType: 'Vote',
        message: expect.objectContaining({
          indexer: '0xindexer',
          voter: '0xvoter',
          period: getCurrentPeriod(),
        }),
      }),
    );
    const [msgArg, sigArg] = vi.mocked(api.submitVote).mock.calls[0];
    expect(msgArg).toMatchObject({ indexer: '0xindexer', voter: '0xvoter' });
    expect(sigArg).toBe('0xsig');
  });

  it('optimistically writes userVote into the votes cache on success', async () => {
    signTypedDataAsync.mockResolvedValue('0xsig');
    vi.mocked(api.submitVote).mockResolvedValue({ ok: true } as never);
    const { client, W } = makeWrapper();

    const period = getCurrentPeriod();
    const key = ['votes', period, '0xvoter'];
    client.setQueryData(key, { period, tallies: [], voters: [], userVote: null });

    const { result } = renderHook(() => useSubmitVote(), { wrapper: W });
    await act(async () => {
      await result.current.mutateAsync('0xWINNER');
    });

    const cached = client.getQueryData(key) as { userVote: string };
    expect(cached.userVote).toBe('0xwinner');
  });

  it('propagates a signing rejection as a mutation error', async () => {
    signTypedDataAsync.mockRejectedValue(new Error('User rejected'));
    const { W } = makeWrapper();
    const { result } = renderHook(() => useSubmitVote(), { wrapper: W });

    await act(async () => {
      await expect(result.current.mutateAsync('0xIndexer')).rejects.toThrow('User rejected');
    });
    expect(api.submitVote).not.toHaveBeenCalled();
  });
});
