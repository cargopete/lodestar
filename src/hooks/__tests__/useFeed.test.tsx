// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFeed } from '../useFeed';

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

describe('useFeed', () => {
  it('hits /api/feed and unwraps data.items', async () => {
    const items = [{ id: '1', title: 'hello' }];
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ items }), { status: 200 }));

    const { result } = renderHook(() => useFeed(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(items);
    expect(mockFetch).toHaveBeenCalledWith('/api/feed');
  });

  it('throws with the status code on a non-ok response', async () => {
    mockFetch.mockResolvedValue(new Response('boom', { status: 500 }));

    const { result } = renderHook(() => useFeed(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toContain('500');
  });

  it('returns the items array verbatim including an empty list', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ items: [] }), { status: 200 }));

    const { result } = renderHook(() => useFeed(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});
