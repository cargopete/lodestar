'use client';

import { useEffect } from 'react';

// Registers the PWA service worker (see public/sw.js). Production only — a SW in
// dev fights hot-reload and caches half-built chunks. Renders nothing.
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Best-effort: a failed SW registration must never break the app.
      });
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);

  return null;
}
