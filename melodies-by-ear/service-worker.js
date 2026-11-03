// Melodies by Ear — service worker for melodies-by-ear/ (template v1)
// Adapted from Remember's service worker (v0.1865), keeping its fail-loudly fixes:
// only successful responses are cached, and failures are logged, never silent.
//
// What it does: keeps a copy of the app so it opens offline, and fetches the
// newest page whenever the network is available ("network first" for the page).
// deploy.yml rewrites CACHE_VERSION on every deploy, so each version gets a
// fresh cache and the old one is removed.
//
// All apps on lynn-edu-apps.github.io share ONE Cache Storage (it's per origin),
// so the cleanup below deletes only caches named with this folder's own prefix,
// never Remember's or the other Melodies by Ear deployments'.

const CACHE_PREFIX  = 'melodies-by-ear-v';
const CACHE_VERSION = 'melodies-by-ear-v0.44';
const STATIC_CACHE  = CACHE_VERSION + '-static';
const LOG = '[Melodies by Ear SW melodies-by-ear]';

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
      // FAIL LOUDLY: re-thrown so the install really fails (an incomplete
      // precache must not count as installed); the page reports the failure.
      console.error(LOG, 'INSTALL FAILED — one or more precache assets could not be fetched:', PRECACHE_ASSETS, err);
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
            // CACHE_PREFIX ends in "-v", so 'melodies-by-ear-v' never matches
            // 'melodies-by-ear-dev-…' or 'melodies-by-ear-stable-…'.
            return name.startsWith(CACHE_PREFIX) && name !== STATIC_CACHE;
          })
          .map(function(name) { return caches.delete(name); })
      );
    }).then(function() {
      return self.clients.claim();
    }).catch(function(err) {
      console.error(LOG, 'ACTIVATE cache cleanup failed:', err);
      throw err;
    })
  );
});

function cacheIfOk(request, networkResponse) {
  if (networkResponse && networkResponse.ok) {
    var clone = networkResponse.clone();
    caches.open(STATIC_CACHE).then(function(cache) { return cache.put(request, clone); })
      .catch(function(err) { console.error(LOG, 'Could not store in cache:', request.url, err); });
  } else {
    // A 404/500 must never be cached: it would be served forever after.
    console.error(LOG, 'Non-OK response NOT cached:', request.url, networkResponse && networkResponse.status);
  }
  return networkResponse;
}

self.addEventListener('fetch', function(event) {
  if (event.request.method !== 'GET') return;
  var url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;    // nothing outside this site

  var isHTML = (event.request.headers.get('accept') || '').includes('text/html');
  var isIndex = url.pathname.endsWith('/') || url.pathname.endsWith('.html');

  if (isHTML || isIndex) {
    // The page: always try the network first (so a new deploy shows up on the
    // next open), and fall back to the cached copy when offline.
    event.respondWith(
      fetch(event.request.url, { cache: 'no-store' })
        .then(function(networkResponse) { return cacheIfOk(event.request, networkResponse); })
        .catch(function() {
          return caches.match(event.request).then(function(cached) {
            return cached || caches.match('./');
          });
        })
    );
    return;
  }

  // Everything else (icons, manifest): from the cache, else the network.
  event.respondWith(
    caches.match(event.request).then(function(cached) {
      if (cached) return cached;
      return fetch(event.request).then(function(networkResponse) {
        return cacheIfOk(event.request, networkResponse);
      }).catch(function(err) {
        console.error(LOG, 'Fetch failed for:', event.request.url, err);
        throw err;
      });
    })
  );
});
