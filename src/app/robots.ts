import type { MetadataRoute } from 'next';
import { env } from '@/lib/env';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/browse', '/items/', '/safety', '/how-it-works'],
        disallow: ['/staff', '/admin', '/account', '/claims', '/sign-in', '/api', '/auth'],
      },
    ],
    sitemap: `${env.siteUrl}/sitemap.xml`,
  };
}
