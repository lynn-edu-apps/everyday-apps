// Remember PWA Service Worker
const CACHE_NAME = 'remember-v0.70';
const ASSETS = [
  './',
  './index.html'
];

// Install: cache core assets
self.addEventListener('install', function(e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(ASSETS);
    })
  );
});

// Activate: clean up old caches
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) {
          return key !== CACHE_NAME;
        }).map(function(key) {
          return caches.delete(key);
        })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// Fetch: serve from cache, fall back to network
self.addEventListener('fetch', function(e) {
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      if (cached) return cached;
      return fetch(e.request).then(function(response) {
        // Cache successful GET requests
        if (e.request.method === 'GET' && response.status === 200) {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(e.request, copy);
          });
        }
        return response;
      }).catch(function() {
        // Offline fallback — return cached index.html
        return caches.match('./index.html');
      });
    })
  );
});
