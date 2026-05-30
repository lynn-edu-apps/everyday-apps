// Remember App - Version 0.450
// Service Worker — network-first for HTML, cache-first for static assets

const CACHE_VERSION = 'remember-v0.450';
const STATIC_CACHE  = CACHE_VERSION + '-static';

// Assets to pre-cache on install (fonts, icons — rarely change)
const PRECACHE_ASSETS = [
  './',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

// ── Install: pre-cache static assets ────────────────────────────────────────
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(function(cache) {
      return cache.addAll(PRECACHE_ASSETS);
    }).then(function() {
      // Take control immediately without waiting for old SW to finish
      return self.skipWaiting();
    })
  );
});

// ── Activate: delete all old caches from previous versions ──────────────────
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames
          .filter(function(name) {
            // Delete any cache that doesn't match current version
            return name.startsWith('remember-') && name !== STATIC_CACHE;
          })
          .map(function(name) {
            return caches.delete(name);
          })
      );
    }).then(function() {
      // Take control of all open pages immediately
      return self.clients.claim();
    })
  );
});

// ── Fetch: network-first for HTML, cache-first for everything else ───────────
self.addEventListener('fetch', function(event) {
  var url = new URL(event.request.url);

  // Only handle same-origin and GitHub Pages requests
  if (event.request.method !== 'GET') return;

  // Network-first strategy for HTML (the main app file)
  var isHTML = event.request.headers.get('accept') &&
               event.request.headers.get('accept').includes('text/html');
  var isIndex = url.pathname.endsWith('/') ||
                url.pathname.endsWith('.html');

  if (isHTML || isIndex) {
    event.respondWith(
      fetch(event.request)
        .then(function(networkResponse) {
          // Got fresh response — update cache and return it
          var responseClone = networkResponse.clone();
          caches.open(STATIC_CACHE).then(function(cache) {
            cache.put(event.request, responseClone);
          });
          return networkResponse;
        })
        .catch(function() {
          // Network failed — serve from cache (offline fallback)
          return caches.match(event.request).then(function(cached) {
            return cached || caches.match('./');
          });
        })
    );
    return;
  }

  // Cache-first strategy for fonts, icons, and other static assets
  event.respondWith(
    caches.match(event.request).then(function(cached) {
      if (cached) return cached;
      return fetch(event.request).then(function(networkResponse) {
        var responseClone = networkResponse.clone();
        caches.open(STATIC_CACHE).then(function(cache) {
          cache.put(event.request, responseClone);
        });
        return networkResponse;
      });
    })
  );
});
