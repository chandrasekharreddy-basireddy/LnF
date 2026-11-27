/**
 * L&F service worker.
 *
 * It does one job: when the push service hands it a payload, show a
 * notification; when that notification is tapped, open the page it points at.
 * It caches nothing — there is no offline board here (that is a separate item),
 * and a stale cache on a lost-and-found board is a wrong answer.
 *
 * The payload is shaped by src/lib/push.ts (`pushPayload`): title, body, url,
 * tag. Anything unexpected falls back to a generic notification rather than
 * failing, because a worker that throws shows the person nothing at all.
 */

const FALLBACK = {
  title: 'L&F',
  body: 'Something changed on the board.',
  url: '/',
  tag: 'lnf',
};

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = FALLBACK;
  try {
    if (event.data) {
      const parsed = event.data.json();
      data = {
        title: typeof parsed.title === 'string' ? parsed.title : FALLBACK.title,
        body: typeof parsed.body === 'string' ? parsed.body : FALLBACK.body,
        url: typeof parsed.url === 'string' && parsed.url.startsWith('/') ? parsed.url : FALLBACK.url,
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
