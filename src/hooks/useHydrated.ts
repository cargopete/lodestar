'use client';

import { useSyncExternalStore } from 'react';

// Hydration happens exactly once and never reverts, so the store has nothing to
// notify about — subscribe is a no-op that returns a no-op unsubscribe.
const neverChanges = () => () => {};

/**
 * True once React has hydrated on the client, false during SSR and through the
 * hydration pass itself.
 *
 * Gates browser-only APIs (localStorage, Capacitor) without the usual
 * `useState(false)` + `useEffect(() => setMounted(true))` pair, which schedules
 * a second render from inside an effect and trips React's cascading-render rule.
 * React drives the server → client snapshot switch itself here.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    neverChanges,
    () => true,
    () => false,
  );
}
