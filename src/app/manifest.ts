import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'L&F — lost and found',
    short_name: 'L&F',
    description: 'Report what you lost, log what you found, collect it at the desk.',
    start_url: '/',
    display: 'standalone',
    background_color: '#fbfbf8',
    theme_color: '#14524b',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
