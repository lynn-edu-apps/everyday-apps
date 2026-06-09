// Remember App - Version 0.514
// Service Worker — network-first for HTML, cache-first for static assets

const CACHE_VERSION = 'remember-v0.882';
const STATIC_CACHE  = CACHE_VERSION + '-static';

// Assets to pre-cache on install.
// Include both './' and './index.html' so offline fallback always has a match.
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

// ── Install: pre-cache static assets ────────────────────────────────────────
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(function(cache) {
      // Use individual adds so one missing icon doesn't abort everything
      return Promise.allSettled(
        PRECACHE_ASSETS.map(function(url) {
          return cache.add(url).catch(function(err) {
            console.warn('[SW] Pre-cache failed for:', url, err);
          });
        })
      );
    }).then(function() {
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
            return name.startsWith('remember-') && name !== STATIC_CACHE;
          })
          .map(function(name) {
            return caches.delete(name);
          })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// ── Helpers ──────────────────────────────────────────────────────────────────
// Try several fallback keys to find the cached app shell.
// GitHub Pages may store the response under './', './index.html', or the
// full URL — we try all three so offline always works.
function getAppShellFromCache() {
  var candidates = ['./', './index.html', '/everyday-apps/remember/', '/everyday-apps/remember/index.html'];
  function tryNext(i) {
    if (i >= candidates.length) return Promise.resolve(null);
    return caches.match(candidates[i]).then(function(match) {
      return match || tryNext(i + 1);
    });
  }
  return tryNext(0);
}

// ── Fetch: network-first for HTML, cache-first for everything else ───────────
self.addEventListener('fetch', function(event) {
  var url = new URL(event.request.url);

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
          // Got fresh response — update cache under both the exact URL and './'
          var responseClone = networkResponse.clone();
          caches.open(STATIC_CACHE).then(function(cache) {
            cache.put(event.request, responseClone);
            // Also store under './' and './index.html' as reliable fallback keys
            networkResponse.clone && cache.put('./index.html', networkResponse.clone());
          });
          return networkResponse;
        })
        .catch(function() {
          // Network failed — try exact match first, then app shell fallbacks
          return caches.match(event.request, { ignoreSearch: true })
            .then(function(cached) {
              return cached || getAppShellFromCache();
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
      }).catch(function() {
        // Static asset not cached and network unavailable — fail silently
        return new Response('', { status: 408, statusText: 'Offline' });
      });
    })
  );
});
