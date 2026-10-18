'use strict';

const CACHE_NAME = 'rafeequl-hifz-v1';

const STATIC_ASSETS = [
  './',
  'index.html',
  'dashboard.html',
  'hifz.html',
  'tikrar.html',
  'rabt.html',
  'murajaah.html',
  'flashcards.html',
  'history.html',
  'css/style.css',
  'js/i18n.js',
  'js/app.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[SW] Cache addAll failed for some assets:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // API calls and non-GET requests must always go to the network directly
  if (req.method !== 'GET' || url.pathname.includes('/api/')) {
    return;
  }

  // Network-first with Cache fallback for app shell & static assets
  event.respondWith(
    fetch(req)
      .then((networkRes) => {
        if (networkRes && networkRes.status === 200) {
          const resClone = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(req, resClone);
          });
        }
        return networkRes;
      })
      .catch(() => {
        return caches.match(req).then((cachedRes) => {
          if (cachedRes) {
            return cachedRes;
          }
          if (req.headers.get('accept') && req.headers.get('accept').includes('text/html')) {
            return caches.match('dashboard.html') || caches.match('index.html');
          }
        });
      })
  );
});
