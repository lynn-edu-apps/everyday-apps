// Remember App - Version 0.1865
// Service Worker for remember-stable (stable deployment)
//
// v0.1865 FAIL LOUDLY fix, per Lynn's request — see remember-service-
// worker's matching header comment for the full explanation. Same fix,
// applied identically here.

const CACHE_VERSION = 'remember-stable-v0.1035';
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
      console.error('[Remember SW: stable] INSTALL FAILED — one or more precache assets could not be fetched:', PRECACHE_ASSETS, err);
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
            return name.startsWith('remember-stable-') && name !== STATIC_CACHE;
          })
          .map(function(name) { return caches.delete(name); })
      );
    }).then(function() {
      return self.clients.claim();
    }).catch(function(err) {
      console.error('[Remember SW: stable] ACTIVATE cache cleanup failed:', err);
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
      // v0.1035 FIX, per Lynn's report of the app appearing "half
      // updated" (version banner/number showed new, but actual
      // behavior was still old, until a full force-quit+reopen) --
      // event.request carried no explicit cache directive, so this
      // fetch, despite the surrounding code's clear network-first
      // INTENT, could still be silently satisfied by the browser's own
      // HTTP cache layer (entirely separate from the Cache API used
      // everywhere else in this file) if GitHub Pages' response headers
      // permitted it. cache:'no-store' guarantees a genuinely fresh
      // network fetch every time, matching what this code already
      // believed it was doing.
      fetch(event.request.url, { cache: 'no-store' })
        .then(function(networkResponse) {
          // FAIL LOUDLY fix (v0.1865-equivalent, see main SW's comment
          // for full explanation): only cache genuinely successful
          // responses; a bad response used to get cached and served
          // forever as if it were good.
          if (networkResponse && networkResponse.ok) {
            var clone = networkResponse.clone();
            caches.open(STATIC_CACHE).then(function(cache) { cache.put(event.request, clone); });
          } else {
            console.error('[Remember SW: stable] Non-OK response NOT cached:', event.request.url, networkResponse && networkResponse.status);
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
        if (networkResponse && networkResponse.ok) {
          var clone = networkResponse.clone();
          caches.open(STATIC_CACHE).then(function(cache) { cache.put(event.request, clone); });
        } else {
          console.error('[Remember SW: stable] Non-OK response NOT cached:', event.request.url, networkResponse && networkResponse.status);
        }
        return networkResponse;
      }).catch(function(err) {
        console.error('[Remember SW: stable] Fetch failed for:', event.request.url, err);
        throw err;
      });
    })
  );
});
