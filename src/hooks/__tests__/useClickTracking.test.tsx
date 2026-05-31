// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const useWalletStore = vi.fn();
vi.mock('../useWalletStore', () => ({
  useWalletStore: () => useWalletStore(),
}));

import { useClickTracking, type TradeClickEvent } from '../useClickTracking';

const sampleEvent: TradeClickEvent = {
  event_type: 'trade_click',
  token_address: '0xtoken',
  token_symbol: 'GRT',
  venue: 'uniswap',
  pool_address: '0xpool',
  chain: 'arbitrum',
  destination_url: 'https://app.uniswap.org',
};

const mockSendBeacon = vi.fn();
const mockFetch = vi.fn();

function installLocalStorage() {
  const store = new Map<string, string>();
  const mock = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
  };
  vi.stubGlobal('localStorage', mock);
}

beforeEach(() => {
  vi.clearAllMocks();
  installLocalStorage();
  useWalletStore.mockReturnValue({ wallets: [{ address: '0xWALLET' }] });
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockResolvedValue(new Response('', { status: 200 }));
});
afterEach(() => vi.unstubAllGlobals());

describe('useClickTracking', () => {
  it('uses sendBeacon with the wallet, a session id, and the event payload', () => {
    Object.defineProperty(navigator, 'sendBeacon', { value: mockSendBeacon, configurable: true });

    const { result } = renderHook(() => useClickTracking());
    act(() => result.current.track(sampleEvent));

    expect(mockSendBeacon).toHaveBeenCalledTimes(1);
    const [url, blob] = mockSendBeacon.mock.calls[0] as [string, Blob];
    expect(url).toBe('/api/analytics/clickthrough');
    expect(blob).toBeInstanceOf(Blob);
    // a session id should have been persisted to localStorage
    expect(localStorage.getItem('lodestar:session')).toBeTruthy();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('reuses an existing session id from localStorage', async () => {
    localStorage.setItem('lodestar:session', 'fixed-session');
    let captured = '';
    Object.defineProperty(navigator, 'sendBeacon', {
      value: vi.fn((_u: string, b: Blob) => { void b.text().then((t) => (captured = t)); return true; }),
      configurable: true,
    });

    const { result } = renderHook(() => useClickTracking());
    act(() => result.current.track(sampleEvent));

    await Promise.resolve();
    expect(localStorage.getItem('lodestar:session')).toBe('fixed-session');
    expect(captured).toContain('fixed-session');
    expect(captured).toContain('0xWALLET');
  });

  it('falls back to fetch when sendBeacon is unavailable', () => {
    Object.defineProperty(navigator, 'sendBeacon', { value: undefined, configurable: true });

    const { result } = renderHook(() => useClickTracking());
    act(() => result.current.track(sampleEvent));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/analytics/clickthrough');
    expect(opts.method).toBe('POST');
    expect(opts.keepalive).toBe(true);
  });

  it('sends a null wallet when no wallets are watched', () => {
    useWalletStore.mockReturnValue({ wallets: [] });
    let captured = '';
    Object.defineProperty(navigator, 'sendBeacon', {
      value: vi.fn((_u: string, b: Blob) => { void b.text().then((t) => (captured = t)); return true; }),
      configurable: true,
    });

    const { result } = renderHook(() => useClickTracking());
    act(() => result.current.track(sampleEvent));

    return Promise.resolve().then(() => {
      expect(captured).toContain('"wallet":null');
    });
  });

  it('never throws even if the transport blows up', () => {
    Object.defineProperty(navigator, 'sendBeacon', {
      value: vi.fn(() => { throw new Error('boom'); }),
      configurable: true,
    });
    const { result } = renderHook(() => useClickTracking());
    expect(() => act(() => result.current.track(sampleEvent))).not.toThrow();
  });
});
