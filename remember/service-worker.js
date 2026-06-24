// Remember App - Version 0.1034
// Service Worker for remember (dev deployment)

const CACHE_VERSION = 'remember-v0.1407';
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
      fetch(event.request)
        .then(function(networkResponse) {
          var clone = networkResponse.clone();
          caches.open(STATIC_CACHE).then(function(cache) { cache.put(event.request, clone); });
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
        var clone = networkResponse.clone();
        caches.open(STATIC_CACHE).then(function(cache) { cache.put(event.request, clone); });
        return networkResponse;
      });
    })
  );
});
