// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTokenDirectory, useTokenDetail } from '../useTokens';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // eslint-disable-next-line react/display-name
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mockFetch);
});
afterEach(() => vi.unstubAllGlobals());

describe('useTokenDirectory', () => {
  it('unwraps json.data into the directory list', async () => {
    const tokens = [{ symbol: 'GRT', chain: 'arbitrum' }];
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ data: tokens }), { status: 200 }));

    const { result } = renderHook(() => useTokenDirectory(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(tokens);
    expect(mockFetch).toHaveBeenCalledWith('/api/tokens');
  });

  it('throws with the status code on a non-ok response', async () => {
    mockFetch.mockResolvedValue(new Response('err', { status: 503 }));
    const { result } = renderHook(() => useTokenDirectory(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toContain('503');
  });
});

describe('useTokenDetail', () => {
  it('is disabled when chain or address is empty', () => {
    const { result } = renderHook(() => useTokenDetail('', ''), { wrapper: wrapper() });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('builds the detail URL from chain + address and returns json.data', async () => {
    const detail = { symbol: 'GRT', address: '0xabc' };
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ data: detail }), { status: 200 }));

    const { result } = renderHook(() => useTokenDetail('arbitrum', '0xABCdef'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(detail);
    expect(mockFetch).toHaveBeenCalledWith('/api/tokens/arbitrum/0xABCdef');
  });

  it('throws with the status code on failure', async () => {
    mockFetch.mockResolvedValue(new Response('', { status: 404 }));
    const { result } = renderHook(() => useTokenDetail('arbitrum', '0xabc'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toContain('404');
  });
});
