// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useProtocolsDirectory, useProtocolDetail } from '../useProtocols';

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

describe('useProtocolsDirectory', () => {
  it('hits /api/protocols and unwraps json.data', async () => {
    const dir = { uniswap: { slug: 'uniswap' }, missing: null };
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ data: dir }), { status: 200 }));

    const { result } = renderHook(() => useProtocolsDirectory(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(dir);
    expect(mockFetch).toHaveBeenCalledWith('/api/protocols');
  });

  it('throws with the status code on failure', async () => {
    mockFetch.mockResolvedValue(new Response('', { status: 502 }));
    const { result } = renderHook(() => useProtocolsDirectory(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toContain('502');
  });
});

describe('useProtocolDetail', () => {
  it('is disabled (idle) when slug is empty', () => {
    const { result } = renderHook(() => useProtocolDetail(''), { wrapper: wrapper() });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('builds the detail URL from the slug and returns json.data', async () => {
    const detail = { slug: 'aave', tvl: 100 };
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ data: detail }), { status: 200 }));

    const { result } = renderHook(() => useProtocolDetail('aave'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(detail);
    expect(mockFetch).toHaveBeenCalledWith('/api/protocols/aave');
  });

  it('throws with the status code on a non-ok detail response', async () => {
    mockFetch.mockResolvedValue(new Response('', { status: 404 }));
    const { result } = renderHook(() => useProtocolDetail('ghost'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toContain('404');
  });
});
