'use client';

import { useCallback, useSyncExternalStore } from 'react';

// localStorage fires no events in the tab that wrote it, so dismissals are
// broadcast through a module-level listener set instead. Every mounted banner
// re-reads its own key whenever any of them is dismissed.
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readDismissed(storageKey: string): boolean {
  try {
    return localStorage.getItem(storageKey) !== null;
  } catch {
    // Private browsing or storage disabled. Treat as dismissed rather than
    // nagging someone whose dismissal we have no way of remembering.
    return true;
  }
}

/**
 * Persisted dismiss state for a banner, keyed by localStorage.
 *
 * Reports "dismissed" on the server and through hydration, so a banner only
 * appears once the client has actually read storage. Deriving this from a store
 * rather than setting state inside an effect keeps the reveal on React's own
 * hydration pass instead of triggering a cascading render.
 */
export function useDismissible(storageKey: string) {
  const dismissed = useSyncExternalStore(
    subscribe,
    () => readDismissed(storageKey),
    () => true,
  );

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(storageKey, '1');
    } catch {
      // Nothing to persist to. readDismissed reports dismissed in this case
      // anyway, so the notify below still hides it.
    }
    listeners.forEach((listener) => listener());
  }, [storageKey]);

  return { dismissed, dismiss };
}
