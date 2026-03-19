'use client';

import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'lodestar-wallets';

export interface WatchedWallet {
  address: string;
  label: string;
  addedAt: number;
}

/**
 * Hook for managing multiple watched wallet addresses
 * Persists to localStorage for cross-session tracking
 */
export function useWalletStore() {
  const [wallets, setWallets] = useState<WatchedWallet[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setWallets(parsed);
        }
      }
    } catch (error) {
      console.error('Failed to load wallets from storage:', error);
    }
    setIsLoaded(true);
  }, []);

  // Save to localStorage on change
  useEffect(() => {
    if (isLoaded) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(wallets));
      } catch (error) {
        console.error('Failed to save wallets to storage:', error);
      }
    }
  }, [wallets, isLoaded]);

  const addWallet = useCallback((address: string, label?: string) => {
    const normalized = address.toLowerCase();

    setWallets((prev) => {
      // Don't add duplicates
      if (prev.some((w) => w.address.toLowerCase() === normalized)) {
        return prev;
      }

      return [
        ...prev,
        {
          address: normalized,
          label: label || `Wallet ${prev.length + 1}`,
          addedAt: Date.now(),
        },
      ];
    });
  }, []);

  const removeWallet = useCallback((address: string) => {
    const normalized = address.toLowerCase();
    setWallets((prev) => prev.filter((w) => w.address.toLowerCase() !== normalized));
  }, []);

  const updateLabel = useCallback((address: string, label: string) => {
    const normalized = address.toLowerCase();
    setWallets((prev) =>
      prev.map((w) =>
        w.address.toLowerCase() === normalized ? { ...w, label } : w
      )
    );
  }, []);

  const hasWallet = useCallback(
    (address: string) => {
      const normalized = address.toLowerCase();
      return wallets.some((w) => w.address.toLowerCase() === normalized);
    },
    [wallets]
  );

  const getWallet = useCallback(
    (address: string) => {
      const normalized = address.toLowerCase();
      return wallets.find((w) => w.address.toLowerCase() === normalized);
    },
    [wallets]
  );

  return {
    wallets,
    isLoaded,
    addWallet,
    removeWallet,
    updateLabel,
    hasWallet,
    getWallet,
  };
}
