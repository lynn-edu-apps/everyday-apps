// Melodies by Ear — service worker for melodies-by-ear/ (template v2)
// Adapted from Remember's service worker (v0.1865), keeping its fail-loudly fixes:
// only successful responses are cached, and failures are logged, never silent.
//
// What it does: keeps a copy of the app so it opens offline, and always tries
// the network first for EVERY file (page, manifest, icons), using the cached
// copy only when the network fails. deploy.yml rewrites CACHE_VERSION on every
// deploy, so each version gets a fresh cache and the old one is removed.
//
// v2 (2026-11-02): v1 served manifest.json and icons from the cache first, so a
// phone that had cached an old manifest kept showing it to the browser until the
// next version, which made Android Chrome say a never-installed app was "already
// installed" (the old manifest's app id). v2 also downloads the precache with
// cache: 'reload', bypassing the browser's HTTP cache (GitHub Pages lets files be
// reused for up to 10 minutes), so a fresh install never stores a stale copy.
//
// All apps on lynn-edu-apps.github.io share ONE Cache Storage (it's per origin),
// so the cleanup below deletes only caches named with this folder's own prefix,
// never Remember's or the other Melodies by Ear deployments'.

const CACHE_PREFIX  = 'melodies-by-ear-v';
const CACHE_VERSION = 'melodies-by-ear-v0.56';
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
      return cache.addAll(PRECACHE_ASSETS.map(function(url) { return new Request(url, { cache: 'reload' }); }));
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

  // Network first for everything: the newest file when online, the cached copy
  // only when offline. (The page asks with cache: 'no-store' so a new deploy
  // shows on the next open; other files may use the browser's normal caching.)
  var isHTML = (event.request.headers.get('accept') || '').includes('text/html');
  var isIndex = url.pathname.endsWith('/') || url.pathname.endsWith('.html');
  var networkRequest = (isHTML || isIndex) ? fetch(event.request.url, { cache: 'no-store' }) : fetch(event.request, { cache: 'no-cache' });

  event.respondWith(
    networkRequest
      .then(function(networkResponse) { return cacheIfOk(event.request, networkResponse); })
      .catch(function(err) {
        return caches.match(event.request).then(function(cached) {
          if (cached) return cached;
          if (isHTML || isIndex) return caches.match('./');
          console.error(LOG, 'Offline and not cached:', event.request.url, err);
          throw err;
        });
      })
  );
});
