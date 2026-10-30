'use strict';

const CACHE_NAME = 'rafeequl-hifz-v25';
const AUDIO_CACHE = 'rafeequl-hifz-audio-v1';
const PRECACHE_TIMEOUT_MS = 12000;

const STATIC_ASSETS = [
  'index.html',
  'dashboard.html',
  'hifz.html',
  'tikrar.html',
  'rabt.html',
  'murajaah.html',
  'rub.html',
  'review.html',
  'flashcards.html',
  'kalimaat.html',
  'history.html',
  'admin.html',
  'change-password.html',
  'css/style.css',
  'css/kalimaat.css',
  'js/i18n.js',
  'js/app.js',
  'js/entry-gate.js',
  'js/kalimaat.js',
  'js/hifz.js',
  'js/page-notes.js',
  'js/mutashabihat.js',
  'js/rub.js',
  'js/rub-recitation.js',
  'js/review.js',
  'js/nav.js',
  'js/pwa-manifest.js',
  'js/flashcards.js',
  'js/admin.js',
  'js/change-password.js',
  'js/madinah_page_verses.json',
  'data/mutashabihat.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-192.png',
  'icons/icon-maskable-512.png'
];

// The 1.3 MB Qur'an text file is deliberately NOT pre-cached here. It is
// fetched on demand by the recitation screens and then cached by the
// network-first handler below. Pre-caching it made installation slow and
// fragile on mobile connections.
function cacheAssetWithTimeout(cache, asset) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok, err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!ok) console.warn('[SW] Could not pre-cache asset:', asset, err);
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false, 'timeout'), PRECACHE_TIMEOUT_MS);
    cache.add(asset).then(() => finish(true)).catch((err) => finish(false, err));
  });
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.all(
        STATIC_ASSETS.map((asset) => cacheAssetWithTimeout(cache, asset))
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
