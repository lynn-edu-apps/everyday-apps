// Remember App - Version 0.1865
// Service Worker for remember (main/latest deployment)
//
// v0.1865 FAIL LOUDLY fix, per Lynn's request after tracing the Playwrite
// font caching bug: bad HTTP responses (404/500) were previously cached as
// if they were successes, and several async failure paths were completely
// silent (no console output, no thrown error). See inline comments at each
// fix site. No behavior change for the success path.

const CACHE_VERSION = 'remember-v0.1867';
const STATIC_CACHE  = CACHE_VERSION + '-static';

const PRECACHE_ASSETS = [
  './',
  './manifest.json',
  './icon192.png',
  './icon512.png',
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(function(cache) {
      return cache.addAll(PRECACHE_ASSETS);
    }).then(function() {
      return self.skipWaiting();
    }).catch(function(err) {
      // FAIL LOUDLY (Core Instructions, protected caveat #4): a precache
      // failure here used to be totally silent -- the SW install would
      // just fail with nothing visible anywhere except a browser console
      // most users never open. Logging clearly here at least makes it
      // findable in DevTools; re-thrown so the install genuinely still
      // fails (correct browser behavior -- an incomplete precache should
      // not be treated as a successful install).
      console.error('[Remember SW] INSTALL FAILED — one or more precache assets could not be fetched:', PRECACHE_ASSETS, err);
      throw err;
    })
  );
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames
          .filter(function(name) {
            return name.startsWith('remember-v') && name !== STATIC_CACHE;
          })
          .map(function(name) { return caches.delete(name); })
      );
    }).then(function() {
      return self.clients.claim();
    }).catch(function(err) {
      console.error('[Remember SW] ACTIVATE cache cleanup failed:', err);
      throw err;
    })
  );
});

self.addEventListener('fetch', function(event) {
  if (event.request.method !== 'GET') return;

  var isHTML = (event.request.headers.get('accept') || '').includes('text/html');
  var url = new URL(event.request.url);
  var isIndex = url.pathname.endsWith('/') || url.pathname.endsWith('.html');

  if (isHTML || isIndex) {
    event.respondWith(
      // FIX, per Lynn's report -- see the stable/dev service workers'
      // matching comment for the full explanation.
      fetch(event.request.url, { cache: 'no-store' })
        .then(function(networkResponse) {
          // FAIL LOUDLY fix: previously ANY response (including a 404/500)
          // was cached here as if it were a success, permanently serving
          // that failure from cache forever afterward (caches.match never
          // re-checks a URL once something is cached for it). This was the
          // root cause of a real bug: two Playwrite font files got stuck
          // showing the fallback font in an installed PWA because an early
          // failed (404) request for them got cached exactly like a
          // success would. Only cache genuinely successful responses now;
          // log anything else loudly so it's visible in DevTools instead
          // of silently poisoning the cache.
          if (networkResponse && networkResponse.ok) {
            var clone = networkResponse.clone();
            caches.open(STATIC_CACHE).then(function(cache) { cache.put(event.request, clone); });
          } else {
            console.error('[Remember SW] Non-OK response NOT cached:', event.request.url, networkResponse && networkResponse.status);
          }
          return networkResponse;
        })
        .catch(function() {
          return caches.match(event.request).then(function(cached) {
            return cached || caches.match('./');
          });
        })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(function(cached) {
      if (cached) return cached;
      return fetch(event.request).then(function(networkResponse) {
        // Same FAIL LOUDLY fix as the HTML branch above -- see that
        // comment for the full explanation of why this matters.
        if (networkResponse && networkResponse.ok) {
          var clone = networkResponse.clone();
          caches.open(STATIC_CACHE).then(function(cache) { cache.put(event.request, clone); });
        } else {
          console.error('[Remember SW] Non-OK response NOT cached:', event.request.url, networkResponse && networkResponse.status);
        }
        return networkResponse;
      }).catch(function(err) {
        // Previously uncaught -- a network-level failure here (offline,
        // DNS, etc.) was a silent unhandled rejection with nothing logged
        // anywhere. Now at least visible in DevTools.
        console.error('[Remember SW] Fetch failed for:', event.request.url, err);
        throw err;
      });
    })
  );
});
