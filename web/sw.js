'use strict';

const CACHE_NAME = 'rafeequl-hifz-v7';
const AUDIO_CACHE = 'rafeequl-hifz-audio-v1';

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
  'js/page-notes.js',
  'js/pwa-manifest.js',
  'js/flashcards.js',
  'js/madinah_page_verses.json',
  'data/quran-uthmani.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-192.png',
  'icons/icon-maskable-512.png'
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
          if (key !== CACHE_NAME && key !== AUDIO_CACHE) {
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

  // Recitation audio (cross-origin): cache-first so repeats play offline.
  if (url.pathname.endsWith('.mp3')) {
    event.respondWith(
      caches.open(AUDIO_CACHE).then((cache) =>
        cache.match(req).then((cached) => {
          if (cached) return cached;
          return fetch(req)
            .then((res) => {
              if (res && (res.ok || res.type === 'opaque')) {
                cache.put(req, res.clone());
              }
              return res;
            })
            .catch(() => new Response('', { status: 504, statusText: 'Audio unavailable offline' }));
        })
      )
    );
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
