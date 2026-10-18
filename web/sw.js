'use strict';

const CACHE_NAME = 'rafeequl-hifz-v4';

const STATIC_ASSETS = [
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
  'js/flashcards.js',
  'js/madinah_page_verses.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-192.png',
  'icons/icon-maskable-512.png',
  'manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Use Promise.allSettled so that if any individual asset fails, the rest are still cached
      return Promise.allSettled(
        STATIC_ASSETS.map((asset) => {
          return cache.add(asset).catch((err) => {
            console.warn('[SW] Could not pre-cache asset:', asset, err);
          });
        })
      );
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
      .catch(async () => {
        const cachedRes = await caches.match(req);
        if (cachedRes) {
          return cachedRes;
        }
        if (req.headers.get('accept') && req.headers.get('accept').includes('text/html')) {
          const fallback = (await caches.match('index.html')) || (await caches.match('dashboard.html'));
          if (fallback) return fallback;
        }
        return new Response('Offline: Network connection failed', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      })
  );
});
