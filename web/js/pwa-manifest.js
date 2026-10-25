'use strict';

/**
 * InfinityFree-safe Web App Manifest.
 *
 * InfinityFree's "Browser Security System" intercepts requests for
 * `manifest.json` (and `sw.js`) and answers them with a JavaScript
 * challenge page (`text/html`) until the `__test` cookie is set. Android
 * Chrome fetches the manifest in a way that does not carry that cookie, so
 * a linked `manifest.json` fails to parse ("Manifest: Line 1, column 1,
 * Syntax error") and the app is reported as not installable.
 *
 * To avoid that request entirely we build the manifest in JavaScript and
 * point `<link rel="manifest">` at a Blob URL. The browser never fetches a
 * file, so the challenge has nothing to intercept. See:
 * https://forum.infinityfree.com/t/how-to-make-a-working-progressive-web-app/116505
 */
(function () {
  try {
    // Absolute base of the web/ directory, e.g. https://host/web/
    var base = new URL('./', location.href).href;

    var manifest = {
      name: 'رفيق الحفظ — دفتر متابعة حفظ القرآن الكريم',
      short_name: 'رفيق الحفظ',
      description: 'تطبيق متكامل لمتابعة الحفظ الجديد، تكرار الأمس، الربط والمراجعة وتثبيت القرآن الكريم وفق منهجية علمية راسخة.',
      id: base,
      start_url: base + 'index.html',
      scope: base,
      display: 'standalone',
      orientation: 'portrait-primary',
      background_color: '#0d9488',
      theme_color: '#0f766e',
      lang: 'ar',
      dir: 'rtl',
      shortcuts: [
        { name: 'تثبيت الربع', short_name: 'الربع', url: base + 'rub.html', icons: [{ src: base + 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
        { name: 'مركز المراجعة', short_name: 'المراجعة', url: base + 'review.html', icons: [{ src: base + 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }] }
      ],
      icons: [
        { src: base + 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: base + 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: base + 'icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
        { src: base + 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
      ]
    };

    var blob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });

    // Drop any static manifest link first so the (intercepted) file is never
    // requested while we are on InfinityFree's free hosting.
    var stale = document.querySelector('link[rel="manifest"]');
    if (stale && stale.parentNode) stale.parentNode.removeChild(stale);

    var link = document.createElement('link');
    link.rel = 'manifest';
    link.href = URL.createObjectURL(blob);
    document.head.appendChild(link);
  } catch (e) {
    // Non-fatal: the app itself does not depend on the manifest.
  }
})();
