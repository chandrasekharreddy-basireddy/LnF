'use client';

import { useTransition } from 'react';
import { setTheme } from '@/lib/actions/theme';

type Mode = 'light' | 'dark';

function effectiveTheme(): Mode {
  const explicit = document.documentElement.getAttribute('data-theme');
  if (explicit === 'light' || explicit === 'dark') return explicit;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * One tap flips light/dark, the way Telegram's header button does. The icon is
 * chosen by CSS from the rendered theme, so there is nothing to hydrate wrong;
 * the choice is written through the server action so the next page load is
 * already correct in its first byte.
 */
export function ThemeFlip() {
  const [pending, startTransition] = useTransition();

  const flip = () => {
    const next: Mode = effectiveTheme() === 'dark' ? 'light' : 'dark';

    // paint immediately, persist in the background
    document.documentElement.setAttribute('data-theme', next);

    const data = new FormData();
    data.set('theme', next);
    startTransition(() => {
      void setTheme(data);
    });
  };

  return (
    <button
      type="button"
      className="theme-flip"
      onClick={flip}
      disabled={pending}
      aria-label="Switch between light and dark theme"
      title="Light / dark"
    >
      <svg className="flip-icon flip-icon-sun" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
      <svg className="flip-icon flip-icon-moon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.6 6.6 0 0 0 9.8 9.8Z" />
      </svg>
    </button>
  );
}
