'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Theme = 'system' | 'light' | 'dark';

const LABEL: Record<Theme, string> = { system: 'Auto', light: 'Light', dark: 'Dark' };
const NEXT: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };

/**
 * The choice is a cookie, not localStorage, so the server can put data-theme on
 * <html> before the first paint. A theme that flashes is worse than no toggle.
 */
export function ThemeToggle({ initial }: { initial: Theme }) {
  const router = useRouter();
  const [theme, setTheme] = useState<Theme>(initial);

  const cycle = () => {
    const next = NEXT[theme];
    setTheme(next);
    if (next === 'system') {
      document.cookie = 'lnf-theme=; path=/; max-age=0; samesite=lax';
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.cookie = `lnf-theme=${next}; path=/; max-age=31536000; samesite=lax`;
      document.documentElement.setAttribute('data-theme', next);
    }
    router.refresh();
  };

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={cycle}
      aria-label={`Theme: ${LABEL[theme]}. Activate to switch to ${LABEL[NEXT[theme]]}.`}
      title={`Theme: ${LABEL[theme]}`}
    >
      {LABEL[theme]}
    </button>
  );
}
