/**
 * L&F service worker.
 *
 * Two jobs:
 *  1. show a notification when the push service hands it a payload, and open the
 *     page it points at when that notification is tapped;
 *  2. keep the app installable and the counter usable with the network down — a
 *     cache of immutable build assets, the icons and /offline.html, and nothing
 *     else.
 *
 * What it does not do is serve a page or an API response from a cache. A
 * lost-and-found board that answers from a cache answers wrongly: "available"
 * an hour ago is not "available" now, and someone walks to the desk for nothing.
 * Every rule about what may be cached lives in /sw-policy.js, which is plain
 * functions and is unit-tested; this file only applies them.
 *
 * The push payload is shaped by src/lib/push.ts (`pushPayload`): title, body, url,
 * tag. Anything unexpected falls back to a generic notification rather than
 * failing, because a worker that throws shows the person nothing at all.
 */

importScripts('/sw-policy.js');

const POLICY = self.LNFPolicy;
const OFFLINE_URL = '/offline.html';

const FALLBACK = {
  title: 'L&F',
  body: 'Something changed on the board.',
  url: '/',
  tag: 'lnf',
};

self.addEventListener('install', (event) => {
  // Each file is added on its own: one 404 must not leave the worker with no
  // offline page at all, which is what addAll() would do.
  event.waitUntil(
    (async () => {
      const cache = await caches.open(POLICY.CACHE);
      await Promise.all(
        POLICY.PRECACHE.map(async (url) => {
          try {
            const response = await fetch(url, { cache: 'reload' });
            if (response.ok) await cache.put(url, response);
          } catch {
            // offline during install: the next visit tries again
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name.startsWith('lnf-') && name !== POLICY.CACHE).map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

/** Immutable build assets only: a content-hashed file cannot go stale. */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) {
    const cache = await caches.open(POLICY.CACHE);
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

/**
 * Network only, with the offline page as the failure case. There is no cached
 * page to fall back to on purpose.
 */
async function networkOrOffline(request) {
  try {
    return await fetch(request);
  } catch {
    const cached = await caches.match(OFFLINE_URL);
    if (cached) return cached;
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>Offline</title><h1>You are offline</h1><p>The board needs the network. Reload when the signal returns.</p>',
      { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } },
    );
  }
}

self.addEventListener('fetch', (event) => {
  const plan = POLICY.plan(event.request);
  if (plan === 'bypass') return;
  if (plan === 'static') {
    event.respondWith(cacheFirst(event.request));
    return;
  }
  if (plan === 'navigation') event.respondWith(networkOrOffline(event.request));
});

/**
 * A path we are willing to open. `//evil.com` is protocol-relative and would
 * navigate off-site, and a backslash is read as a slash by some parsers — so
 * both are refused rather than normalised.
 */
function safePath(value) {
  if (typeof value !== 'string') return FALLBACK.url;
  if (!value.startsWith('/') || value.startsWith('//')) return FALLBACK.url;
  if (value.includes('\\') || /\s/.test(value)) return FALLBACK.url;
  return value;
}

self.addEventListener('push', (event) => {
  let data = FALLBACK;
  try {
    if (event.data) {
      const parsed = event.data.json();
      data = {
        title: typeof parsed.title === 'string' ? parsed.title : FALLBACK.title,
        body: typeof parsed.body === 'string' ? parsed.body : FALLBACK.body,
        url: safePath(parsed.url),
        tag: typeof parsed.tag === 'string' && parsed.tag ? parsed.tag : FALLBACK.tag,
      };
    }
  } catch {
    // keep the fallback
  }

  event.waitUntil(
    self.registration.showNotification(String(data.title).slice(0, 80), {
      body: String(data.body).slice(0, 200),
      tag: String(data.tag).slice(0, 120),
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = event.notification.data && event.notification.data.url ? event.notification.data.url : '/';
  const target = new URL(path, self.location.origin).href;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if (client.url === target && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
      return undefined;
    })(),
  );
});
