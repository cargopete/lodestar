// Lodestar service worker — deliberately conservative for a live dashboard.
//
//  - HTML / navigations: network-first, fall back to the offline page. Content
//    is never served stale.
//  - Immutable build assets (/_next/static, icons): cache-first (safe, hashed).
//  - Everything else: network, fall back to cache if present.
//
// skipWaiting + clients.claim mean a new SW version takes over promptly, so the
// cache can't get "stuck" on an old release.

const CACHE = 'lodestar-v1';
const PRECACHE = ['/offline.html', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Only handle our own origin; let API/cross-origin (RPC, subgraph) pass through.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // Navigations: network-first, offline page as the safety net.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/offline.html').then((r) => r || Response.error())),
    );
    return;
  }

  // Hashed, immutable assets: cache-first.
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
            return res;
          }),
      ),
    );
    return;
  }

  // Default: network, fall back to any cached copy.
  event.respondWith(fetch(request).catch(() => caches.match(request).then((r) => r || Response.error())));
});
