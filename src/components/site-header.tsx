import Link from 'next/link';
import type { SessionUser } from '@/lib/types';
import { env } from '@/lib/env';
import { isStaff } from '@/lib/data';
import { ThemeFlip } from './theme-flip';
import { CommandPalette } from './command-palette';

export function SiteHeader({ user, unread = 0 }: { user: SessionUser | null; unread?: number }) {
  return (
    <header className="site-header">
      <div className="wrap header-row">
        <Link className="brand" href="/">
          <span className="brand-mark" aria-hidden="true">
            L&amp;F
          </span>
          <span className="brand-text">
            <span className="brand-name">L&amp;F</span>
            <span className="brand-sub">Lost &amp; Found</span>
          </span>
        </Link>

        <nav className="nav" aria-label="Main">
          <Link href="/browse">Browse</Link>
          <Link href="/report/lost">I lost something</Link>
          <Link href="/report/found">I found something</Link>
          <Link href="/safety">Safety</Link>
          {user ? (
            <Link href="/messages">
              Messages
              {unread > 0 ? <span className="chip chip-ok" style={{ marginLeft: 6 }}>{unread}</span> : null}
            </Link>
          ) : null}
          {user ? <Link href="/disputes">Disputes</Link> : null}
          {isStaff(user) ? <Link href="/staff">Desk</Link> : null}
          {user?.roles.includes('admin') ? <Link href="/admin">Admin</Link> : null}
          {user ? (
            <Link href="/account">Account</Link>
          ) : (
            <Link href="/sign-in" className="btn btn-sm">
              Sign in
            </Link>
          )}
          <CommandPalette staff={isStaff(user)} />
          <ThemeFlip />
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="wrap footer-grid">
        <div>
          <p style={{ marginBottom: 6 }}>
            <strong style={{ color: 'var(--ink)' }}>L&amp;F</strong> — {env.campusName} lost and found.
          </p>
          <p className="small">
            Handovers at {env.deskLabel}. Never pay to get an item back; anything asking for money is a scam.
          </p>
          <p className="stamp" style={{ marginTop: 10 }}>
            build {env.buildStamp}
          </p>
        </div>
        <nav aria-label="Footer">
          <Link href="/browse">Browse</Link>
          <Link href="/how-it-works">How it works</Link>
          <Link href="/safety">Safety</Link>
          <Link href="/legal/privacy">Privacy</Link>
          <Link href="/legal/retention">Retention</Link>
          <Link href="/legal/terms">Terms</Link>
        </nav>
      </div>
    </footer>
  );
}
