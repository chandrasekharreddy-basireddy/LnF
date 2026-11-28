import type { MetadataRoute } from 'next';

/**
 * The installable app. It was already installable; what changed with item 9 is
 * that the worker behind it now has something to show when the network is gone
 * (`/offline.html`), so `id` and `scope` are pinned rather than left to the
 * browser's guess — an id that drifts turns one installed app into two.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'L&F — lost and found',
    short_name: 'L&F',
    description: 'Report what you lost, log what you found, collect it at the desk.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    lang: 'en-IN',
    dir: 'ltr',
    background_color: '#fbfbf8',
    theme_color: '#14524b',
    categories: ['education', 'utilities'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
    shortcuts: [
      { name: 'Browse the board', short_name: 'Browse', url: '/browse' },
      { name: 'Hand something in', short_name: 'Hand in', url: '/hand-in' },
      { name: 'Report something lost', short_name: 'Lost', url: '/report/lost' },
    ],
  };
}
