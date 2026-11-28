import type { Metadata, Viewport } from 'next';
import './globals.css';
import { cookies } from 'next/headers';
import { SiteFooter, SiteHeader } from '@/components/site-header';
import { currentUser, unreadMessages } from '@/lib/data';
import { ServiceWorker } from '@/components/sw-register';
import { env } from '@/lib/env';

export const metadata: Metadata = {
  metadataBase: new URL(env.siteUrl),
  title: {
    default: 'L&F — lost and found',
    template: '%s · L&F',
  },
  description:
    'Report what you lost, log what you found, and collect it from a staffed desk. No payments, no meeting strangers.',
  applicationName: 'L&F',
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
  },
  formatDetection: { telephone: false, address: false, email: false },
  robots: { index: true, follow: true },
  openGraph: {
    title: 'L&F — lost and found',
    description: 'Find it. Verify it. Collect it at the desk.',
    type: 'website',
    siteName: 'L&F',
  },
};

export const viewport: Viewport = {
  themeColor: '#14524b',
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  const stored = (await cookies()).get('lnf-theme')?.value;
  const theme = stored === 'light' || stored === 'dark' ? stored : null;

  return (
    <html lang="en-IN" data-theme={theme ?? undefined}>
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        <SiteHeader user={user} unread={user ? await unreadMessages() : 0} />
        <main id="main">
          <div className="wrap">{children}</div>
        </main>
        <SiteFooter />
        <ServiceWorker />
        <span className="sr-only">{env.campusName} lost and found, built for fast connections and slow ones.</span>
      </body>
    </html>
  );
}
