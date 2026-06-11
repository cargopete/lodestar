import type { MetadataRoute } from 'next';

// PWA manifest — makes Lodestar installable to the home screen (standalone,
// no browser chrome) and serves as the base the iOS Capacitor shell builds on.
// Colours track the "Graph Midnight" theme (--bg #141034, --accent #6F4CFF).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Lodestar — The Graph Protocol Analytics',
    short_name: 'Lodestar',
    description:
      'Staking analytics, indexer intelligence, and portfolio tracking for The Graph Protocol.',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#141034',
    theme_color: '#141034',
    categories: ['finance', 'business', 'utilities'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
