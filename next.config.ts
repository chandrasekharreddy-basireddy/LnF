import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    serverActions: {
      // phone photos are 2-4 MB; the default 1 MB rejects them before the
      // action runs, with an error nobody can act on
      bodySizeLimit: '16mb',
    },
  },
  reactStrictMode: true,
  serverExternalPackages: ['sharp'],
  async headers() {
    return [
      {
        // non-HTML responses (sitemap, robots, manifest) get a locked-down
        // baseline; pages get the nonce policy from src/proxy.ts
        source: '/:path*.xml',
        headers: [{ key: 'Content-Security-Policy', value: "default-src 'none'; style-src 'unsafe-inline'" }],
      },
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        ],
      },
    ];
  },
};

export default nextConfig;
