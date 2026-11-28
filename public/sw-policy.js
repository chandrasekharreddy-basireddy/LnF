/**
 * What the service worker may keep, and what it must never touch.
 *
 * Kept apart from sw.js so it can be tested: `sw.js` runs only inside a worker,
 * while this file is plain functions over a URL and a method. `tests/unit/offline.test.ts`
 * loads it and asserts every refusal below.
 *
 * The rule it exists to enforce: a lost-and-found board has one thing it cannot
 * do, and that is answer from a cache. "Available" an hour ago is not "available"
 * now, and a person who reads a stale listing walks to the desk for nothing. So
 * no page and no API response is ever served from a cache. The only cached
 * things are immutable build assets, the icons, and the offline page itself.
 */
(function (global) {
  'use strict';

  var CACHE = 'lnf-static-v1';

  // Served from the cache when the network is gone. All same-origin, all static.
  var PRECACHE = ['/offline.html', '/offline-sheet.js', '/icon-192.png', '/icon-512.png'];

  // Nothing under these prefixes is read from or written to a cache, ever.
  var PRIVATE = [
    '/api/',
    '/auth/',
    '/staff',
    '/account',
    '/messages',
    '/claims',
    '/disputes',
    '/admin',
    '/items/',
    '/hand-in',
    '/report/',
    '/sign-in',
  ];

  // Content-hashed or otherwise immutable: safe to serve from cache first.
  var STATIC_PREFIX = ['/_next/static/', '/icon-', '/apple-touch-icon', '/favicon'];

  /**
   * The worker's own origin. Passed in by the tests; read from the worker in a
   * browser. Without it there is no honest way to tell a same-origin request
   * from someone else's, so nothing is cached.
   */
  function selfOrigin() {
    try {
      return global.location && global.location.origin ? String(global.location.origin) : '';
    } catch (err) {
      return '';
    }
  }

  function pathOf(request, origin) {
    var base = origin || selfOrigin();
    var url = request && request.url ? String(request.url) : '';
    if (!base) return '';
    try {
      var parsed = new URL(url, base);
      return parsed.origin === base ? parsed.pathname : '';
    } catch (err) {
      return '';
    }
  }

  function isPrecached(path) {
    return PRECACHE.indexOf(path) !== -1;
  }

  function isPrivate(path) {
    for (var i = 0; i < PRIVATE.length; i++) {
      if (path === PRIVATE[i] || path.indexOf(PRIVATE[i]) === 0) return true;
    }
    return false;
  }

  function isStatic(path) {
    for (var i = 0; i < STATIC_PREFIX.length; i++) {
      if (path.indexOf(STATIC_PREFIX[i]) === 0) return true;
    }
    return false;
  }

  /**
   * 'bypass'     — do not call respondWith; the browser goes to the network.
   * 'static'     — cache-first, from the immutable bucket.
   * 'navigation' — network only; on failure, the offline page. Never a cached page.
   */
  function plan(request, origin) {
    var method = (request && request.method) || 'GET';
    if (String(method).toUpperCase() !== 'GET') return 'bypass';
    var path = pathOf(request, origin);
    if (!path) return 'bypass';
    if (!path || isPrivate(path)) return 'bypass';
    if (isPrecached(path)) return 'static';
    if (isStatic(path)) return 'static';
    if (request.mode === 'navigate') return 'navigation';
    return 'bypass';
  }

  global.LNFPolicy = {
    CACHE: CACHE,
    PRECACHE: PRECACHE,
    PRIVATE: PRIVATE,
    STATIC_PREFIX: STATIC_PREFIX,
    isPrecached: isPrecached,
    isPrivate: isPrivate,
    isStatic: isStatic,
    pathOf: pathOf,
    plan: plan,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
