'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker for every visitor, not only the ones who turn push
 * on. It is what makes the app installable and what serves /offline.html when the
 * network is gone.
 *
 * Deliberately quiet: production only (a worker in dev caches the build you are
 * editing), after the page is interactive (registration competes with the first
 * paint on a slow campus connection), and a failure is swallowed — a browser
 * without workers, or a private window, loses nothing but the offline page.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    const timer = window.setTimeout(() => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // no offline page, no install prompt; everything else works
      });
    }, 1500);

    return () => window.clearTimeout(timer);
  }, []);

  return null;
}
