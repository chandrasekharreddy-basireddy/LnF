import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    serverActions: {
      // Matches Vercel's 4.5 MB serverless cap; client-side compression keeps photos <= 3.8 MB
      bodySizeLimit: '4mb',
    },
  },
  reactStrictMode: true,
  serverExternalPackages: ['sharp', 'web-push'],
  async headers() {
    return [
      {
        source: '/:path*.xml',
        headers: [{ key: 'Content-Security-Policy', value: "default-src 'none'; style-src 'unsafe-inline'" }],
      },
      {
        // the page served when there is no network: it never gets the nonce policy
        // (see the matcher in src/proxy.ts), so it carries its own, with no inline
        // script allowed at all — its one script is /offline-sheet.js, same-origin
        source: '/offline.html',
        headers: [
          {
            key: 'Content-Security-Policy',
            value:
              "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
          },
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
        ],
      },
      {
        source: '/:path*.txt',
        headers: [{ key: 'Content-Security-Policy', value: "default-src 'none'" }],
      },
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Content-Security-Policy', value: "default-src 'self'" },
        ],
      },
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          // camera is deliberately not denied here: a global camera=() and the
          // scanner's camera=(self) are combined by the browser into the
          // intersection, which disabled the counter scanner.
          { key: 'Permissions-Policy', value: 'microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        ],
      },
      {
        source: '/staff/scan',
        headers: [{ key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' }],
      },
      {
        source: '/staff/scan/:path*',
        headers: [{ key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' }],
      },
    ];
  },
};

export default nextConfig;
