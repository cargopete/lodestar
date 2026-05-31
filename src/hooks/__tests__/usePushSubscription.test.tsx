// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const useAccount = vi.fn();
const signMessageAsync = vi.fn();
vi.mock('wagmi', () => ({
  useAccount: () => useAccount(),
  useSignMessage: () => ({ signMessageAsync }),
}));

import { usePushStatus, useTogglePushSubscription } from '../usePushSubscription';

const mockFetch = vi.fn();

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
  vi.stubGlobal('fetch', mockFetch);
  useAccount.mockReturnValue({ address: '0xABC' });
});
afterEach(() => vi.unstubAllGlobals());

describe('usePushStatus', () => {
  it('is disabled when no wallet is connected', () => {
    useAccount.mockReturnValue({ address: undefined });
    const { W } = makeWrapper();
    const { result } = renderHook(() => usePushStatus(), { wrapper: W });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('queries the lowercased address and returns the subscribed flag', async () => {
    useAccount.mockReturnValue({ address: '0xABC' });
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ subscribed: true }), { status: 200 }));

    const { W } = makeWrapper();
    const { result } = renderHook(() => usePushStatus(), { wrapper: W });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith('/api/push/subscribe?address=0xabc');
  });

  it('resolves to false on a non-ok response', async () => {
    mockFetch.mockResolvedValue(new Response('', { status: 500 }));
    const { W } = makeWrapper();
    const { result } = renderHook(() => usePushStatus(), { wrapper: W });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(false);
  });
});

describe('useTogglePushSubscription', () => {
  it('rejects when no wallet is connected', async () => {
    useAccount.mockReturnValue({ address: undefined });
    const { W } = makeWrapper();
    const { result } = renderHook(() => useTogglePushSubscription(), { wrapper: W });

    await act(async () => {
      await expect(result.current.mutateAsync(false)).rejects.toThrow('Wallet not connected');
    });
    expect(signMessageAsync).not.toHaveBeenCalled();
  });

  it('subscribes: signs, POSTs the normalised address+signature, returns true', async () => {
    useAccount.mockReturnValue({ address: '0xABC' });
    signMessageAsync.mockResolvedValue('0xsig');
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ subscribed: true }), { status: 200 }));

    const { W } = makeWrapper();
    const { result } = renderHook(() => useTogglePushSubscription(), { wrapper: W });

    let value: boolean | undefined;
    await act(async () => { value = await result.current.mutateAsync(false); });

    expect(value).toBe(true);
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/push/subscribe');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body as string)).toEqual({ address: '0xabc', signature: '0xsig' });
  });

  it('subscribe surfaces the server error message on a non-ok POST', async () => {
    signMessageAsync.mockResolvedValue('0xsig');
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 }));

    const { W } = makeWrapper();
    const { result } = renderHook(() => useTogglePushSubscription(), { wrapper: W });

    await act(async () => {
      await expect(result.current.mutateAsync(false)).rejects.toThrow('rate limited');
    });
  });

  it('unsubscribes: signs then DELETEs and returns false', async () => {
    signMessageAsync.mockResolvedValue('0xsig');
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ subscribed: false }), { status: 200 }));

    const { W } = makeWrapper();
    const { result } = renderHook(() => useTogglePushSubscription(), { wrapper: W });

    let value: boolean | undefined;
    await act(async () => { value = await result.current.mutateAsync(true); });

    expect(value).toBe(false);
    expect(signMessageAsync).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/push/subscribe');
    expect(opts.method).toBe('DELETE');
  });

  it('unsubscribe throws when the DELETE fails', async () => {
    signMessageAsync.mockResolvedValue('0xsig');
    mockFetch.mockResolvedValue(new Response('', { status: 500 }));

    const { W } = makeWrapper();
    const { result } = renderHook(() => useTogglePushSubscription(), { wrapper: W });

    await act(async () => {
      await expect(result.current.mutateAsync(true)).rejects.toThrow('Failed to unsubscribe');
    });
  });
});
