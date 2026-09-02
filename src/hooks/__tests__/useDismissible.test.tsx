// @vitest-environment jsdom
/**
 * `useDismissible` — a banner's "I have seen this" bit, kept in localStorage.
 *
 * Two things make this more than a `useState`, and both are the reason it is worth testing.
 *
 * localStorage fires no `storage` event in the tab that wrote it, so a second banner sharing a
 * key would never learn it had been dismissed. Hence the module-level listener set: a dismissal
 * notifies every mounted banner, not just the one that was clicked.
 *
 * And the server snapshot is `true`. A banner must render as dismissed until the client has
 * actually read storage, or the first paint shows a banner the reader already dismissed and it
 * vanishes a frame later, which is worse than never showing it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useDismissible } from '../useDismissible';

const KEY = 'lodestar:banner:test';

/**
 * A localStorage stand-in, as the other hook tests here install one. `throwOn` turns a call into
 * the failure a private window or a disabled-storage browser produces.
 */
function installLocalStorage(throwOn: { get?: boolean; set?: boolean } = {}) {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => {
      if (throwOn.get) throw new Error('SecurityError');
      return store.has(k) ? store.get(k)! : null;
    },
    setItem: (k: string, v: string) => {
      if (throwOn.set) throw new Error('QuotaExceededError');
      store.set(k, String(v));
    },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  installLocalStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('reading the stored bit', () => {
  it('is not dismissed when nothing is stored', () => {
    const { result } = renderHook(() => useDismissible(KEY));
    expect(result.current.dismissed).toBe(false);
  });

  it('is dismissed when the key is present, whatever its value', () => {
    // Presence is the signal; an older build may have written something other than '1'.
    localStorage.setItem(KEY, 'anything');
    const { result } = renderHook(() => useDismissible(KEY));
    expect(result.current.dismissed).toBe(true);
  });

  it('reads its own key, not a neighbour\'s', () => {
    localStorage.setItem('lodestar:banner:other', '1');
    const { result } = renderHook(() => useDismissible(KEY));
    expect(result.current.dismissed).toBe(false);
  });

  it('reports dismissed when storage throws', () => {
    // Private browsing, or storage disabled entirely. There is no way to remember a dismissal
    // here, so nagging on every page load is the worse of the two failures.
    installLocalStorage({ get: true });
    const { result } = renderHook(() => useDismissible(KEY));
    expect(result.current.dismissed).toBe(true);
  });
});

describe('dismissing', () => {
  it('persists the key and flips the flag', () => {
    const { result } = renderHook(() => useDismissible(KEY));

    act(() => result.current.dismiss());

    expect(localStorage.getItem(KEY)).toBe('1');
    expect(result.current.dismissed).toBe(true);
  });

  it('notifies a second banner on the same key in the same tab', () => {
    // The whole reason for the module-level listener set: no `storage` event fires here.
    const a = renderHook(() => useDismissible(KEY));
    const b = renderHook(() => useDismissible(KEY));

    act(() => a.result.current.dismiss());

    expect(b.result.current.dismissed).toBe(true);
  });

  it('leaves a banner on a different key alone', () => {
    const a = renderHook(() => useDismissible(KEY));
    const other = renderHook(() => useDismissible('lodestar:banner:other'));

    act(() => a.result.current.dismiss());

    expect(other.result.current.dismissed).toBe(false);
  });

  it('still hides the banner when the write fails', () => {
    // Nothing to persist to, so the read reports dismissed anyway; the notify is what matters.
    installLocalStorage({ get: true, set: true });

    const { result } = renderHook(() => useDismissible(KEY));
    act(() => result.current.dismiss());

    expect(result.current.dismissed).toBe(true);
  });

  it('unsubscribes on unmount, so a dismissal does not update a gone component', () => {
    const a = renderHook(() => useDismissible(KEY));
    const b = renderHook(() => useDismissible(KEY));
    b.unmount();

    expect(() => act(() => a.result.current.dismiss())).not.toThrow();
    expect(a.result.current.dismissed).toBe(true);
  });

  it('keeps a stable dismiss identity across renders of the same key', () => {
    // It is passed to memoised banner components; a new function each render defeats them.
    const { result, rerender } = renderHook(({ k }) => useDismissible(k), {
      initialProps: { k: KEY },
    });
    const first = result.current.dismiss;
    rerender({ k: KEY });
    expect(result.current.dismiss).toBe(first);

    rerender({ k: 'lodestar:banner:other' });
    expect(result.current.dismiss).not.toBe(first);
  });
});
