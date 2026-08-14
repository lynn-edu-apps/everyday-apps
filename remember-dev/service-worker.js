// Remember App - Version 0.1865
// Service Worker for remember-dev — separate cache from stable and main deployments
//
// v0.1865 FAIL LOUDLY fix, per Lynn's request — see remember-service-
// worker's matching header comment for the full explanation. Same fix,
// applied identically here.

const CACHE_VERSION = 'remember-dev-v0.1064';
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
      console.error('[Remember SW: dev] INSTALL FAILED — one or more precache assets could not be fetched:', PRECACHE_ASSETS, err);
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
            // Only delete remember-dev- caches, never touch remember-v or remember-stable caches
            return name.startsWith('remember-dev-') && name !== STATIC_CACHE;
          })
          .map(function(name) { return caches.delete(name); })
      );
    }).then(function() {
      return self.clients.claim();
    }).catch(function(err) {
      console.error('[Remember SW: dev] ACTIVATE cache cleanup failed:', err);
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
      // v0.1064 FIX, per Lynn's report -- see the stable service
      // worker's matching comment for the full explanation.
      fetch(event.request.url, { cache: 'no-store' })
        .then(function(networkResponse) {
          // FAIL LOUDLY fix (v0.1865-equivalent, see main SW's comment
          // for full explanation): only cache genuinely successful
          // responses; a bad response used to get cached and served
          // forever as if it were good -- this was the root cause of
          // the Playwrite font bug this fix directly addresses.
          if (networkResponse && networkResponse.ok) {
            var clone = networkResponse.clone();
            caches.open(STATIC_CACHE).then(function(cache) { cache.put(event.request, clone); });
          } else {
            console.error('[Remember SW: dev] Non-OK response NOT cached:', event.request.url, networkResponse && networkResponse.status);
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
          console.error('[Remember SW: dev] Non-OK response NOT cached:', event.request.url, networkResponse && networkResponse.status);
        }
        return networkResponse;
      }).catch(function(err) {
        console.error('[Remember SW: dev] Fetch failed for:', event.request.url, err);
        throw err;
      });
    })
  );
});
