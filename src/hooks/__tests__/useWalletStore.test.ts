// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useWalletStore } from '../useWalletStore';

const STORAGE_KEY = 'lodestar-wallets';

// The Node/jsdom localStorage shim under vitest is inconsistent across versions
// (Node's experimental Storage lacks a usable clear()). Install a deterministic
// in-memory implementation so add/remove/hydrate behaviour is what we assert on.
function installMemoryStorage() {
  let store: Record<string, string> = {};
  const mock: Storage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = String(v);
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      store = {};
    },
    key: (i: number) => Object.keys(store)[i] ?? null,
    get length() {
      return Object.keys(store).length;
    },
  };
  vi.stubGlobal('localStorage', mock);
}

describe('useWalletStore', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    installMemoryStorage();
  });

  it('starts empty and flips isLoaded true after mount', async () => {
    const { result } = renderHook(() => useWalletStore());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.wallets).toEqual([]);
  });

  it('hydrates wallets from localStorage on mount', async () => {
    const seed = [{ address: '0xabc', label: 'Main', addedAt: 1 }];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));

    const { result } = renderHook(() => useWalletStore());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.wallets).toEqual(seed);
  });

  it('ignores non-array stored payloads', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ not: 'an array' }));
    const { result } = renderHook(() => useWalletStore());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.wallets).toEqual([]);
  });

  it('survives corrupt JSON in storage without throwing', async () => {
    localStorage.setItem(STORAGE_KEY, '{ broken json');
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useWalletStore());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.wallets).toEqual([]);
    expect(errSpy).toHaveBeenCalled();
  });

  it('adds a wallet (normalising address to lowercase) and persists it', async () => {
    const { result } = renderHook(() => useWalletStore());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    act(() => result.current.addWallet('0xDEADBEEF', 'My Wallet'));

    expect(result.current.wallets).toHaveLength(1);
    expect(result.current.wallets[0].address).toBe('0xdeadbeef');
    expect(result.current.wallets[0].label).toBe('My Wallet');

    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(persisted[0].address).toBe('0xdeadbeef');
  });

  it('defaults the label when none is given', async () => {
    const { result } = renderHook(() => useWalletStore());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    act(() => result.current.addWallet('0xAaa'));
    expect(result.current.wallets[0].label).toBe('Wallet 1');
  });

  it('does not add duplicate addresses (case-insensitive)', async () => {
    const { result } = renderHook(() => useWalletStore());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    act(() => result.current.addWallet('0xAbC', 'first'));
    act(() => result.current.addWallet('0xabc', 'second'));

    expect(result.current.wallets).toHaveLength(1);
    expect(result.current.wallets[0].label).toBe('first');
  });

  it('removes a wallet (case-insensitive)', async () => {
    const { result } = renderHook(() => useWalletStore());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    act(() => result.current.addWallet('0xAbC'));
    act(() => result.current.removeWallet('0xABC'));

    expect(result.current.wallets).toHaveLength(0);
  });

  it('updates a label by address', async () => {
    const { result } = renderHook(() => useWalletStore());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    act(() => result.current.addWallet('0xabc', 'old'));
    act(() => result.current.updateLabel('0xABC', 'new'));

    expect(result.current.wallets[0].label).toBe('new');
  });

  it('hasWallet and getWallet match case-insensitively', async () => {
    const { result } = renderHook(() => useWalletStore());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    act(() => result.current.addWallet('0xAbC', 'mine'));

    expect(result.current.hasWallet('0xABC')).toBe(true);
    expect(result.current.hasWallet('0xother')).toBe(false);
    expect(result.current.getWallet('0xABC')?.label).toBe('mine');
    expect(result.current.getWallet('0xnope')).toBeUndefined();
  });
});
