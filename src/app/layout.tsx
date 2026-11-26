import type { Metadata, Viewport } from 'next';
import './globals.css';
import { SiteFooter, SiteHeader } from '@/components/site-header';
import { currentUser } from '@/lib/data';
import { env } from '@/lib/env';

export const metadata: Metadata = {
  title: {
    default: 'L&F — lost and found',
    template: '%s · L&F',
  },
  description:
    'Report what you lost, log what you found, and collect it from a staffed desk. No payments, no meeting strangers.',
  applicationName: 'L&F',
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

  return (
    <html lang="en-IN">
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        <SiteHeader user={user} />
        <main id="main">
          <div className="wrap">{children}</div>
        </main>
        <SiteFooter />
        <span className="sr-only">{env.campusName} lost and found, built for fast connections and slow ones.</span>
      </body>
    </html>
  );
}
