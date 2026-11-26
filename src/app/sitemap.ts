import type { MetadataRoute } from 'next';
import { env } from '@/lib/env';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = env.siteUrl;
  const now = new Date();
  return [
    { url: `${base}/`, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${base}/browse`, lastModified: now, changeFrequency: 'hourly', priority: 0.9 },
    { url: `${base}/report/lost`, lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${base}/report/found`, lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${base}/how-it-works`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${base}/safety`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${base}/legal/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${base}/legal/retention`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${base}/legal/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
  ];
}
