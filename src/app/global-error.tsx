'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

// After a deploy, an open tab may ask for JS/CSS chunks whose hashes have
// changed under it. The old ones 404 and React throws a ChunkLoadError — not a
// real bug, just stale HTML. The cure is a hard reload to fetch fresh chunks.
const RELOAD_KEY = 'lodestar:chunk-reload-at';
const RELOAD_COOLDOWN_MS = 10_000;

function isChunkLoadError(error?: Error): boolean {
  if (!error) return false;
  const name = error.name ?? '';
  const msg = error.message ?? '';
  return (
    name === 'ChunkLoadError' ||
    /Loading chunk \d+ failed/i.test(msg) ||
    /Loading CSS chunk/i.test(msg) ||
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg)
  );
}

// Reload once to recover, but bail if we already tried within the cooldown —
// that means the reload didn't help and this is a genuine failure worth showing.
function reloadOnce(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? '0');
    if (Date.now() - last < RELOAD_COOLDOWN_MS) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    /* sessionStorage may be unavailable — fall through and reload anyway */
  }
  window.location.reload();
  return true;
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const chunkError = isChunkLoadError(error);

  useEffect(() => {
    if (chunkError) {
      // A stale chunk isn't a real error — recover silently if we can.
      if (reloadOnce()) return;
      // Reload already attempted and we're still here: report it as genuine.
    }
    Sentry.captureException(error);
  }, [error, chunkError]);

  const onRetry = () => {
    // For a chunk error, reset() just re-renders the same broken reference.
    // A real reload is what actually recovers.
    if (chunkError) {
      window.location.reload();
    } else {
      reset();
    }
  };

  return (
    <html>
      <body>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'system-ui, sans-serif', background: '#0a0a0f', color: '#e0e0e0' }}>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>
            {chunkError ? 'Updating to the latest version…' : 'Something went wrong'}
          </h2>
          <button
            onClick={onRetry}
            style={{ padding: '0.5rem 1.5rem', borderRadius: '0.5rem', background: '#6366f1', color: 'white', border: 'none', cursor: 'pointer', fontSize: '0.875rem' }}
          >
            {chunkError ? 'Reload' : 'Try again'}
          </button>
        </div>
      </body>
    </html>
  );
}
