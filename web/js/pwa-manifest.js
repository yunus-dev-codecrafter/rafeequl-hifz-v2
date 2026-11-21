'use strict';

/**
 * PWA Manifest & Mobile Installation Setup.
 *
 * Ensures the Web App Manifest is linked with crossorigin="use-credentials"
 * so browsers (especially Android Chrome) pass cookies with the manifest
 * request, enabling PWA installability on hosted environments.
 * Also configures iOS Apple Touch headers.
 */
(function () {
  try {
    // 1. Remove any old blob: manifest link
    var existingLinks = document.querySelectorAll('link[rel="manifest"]');
    existingLinks.forEach(function (el) {
      if (el.href && el.href.indexOf('blob:') === 0) {
        el.parentNode.removeChild(el);
      }
    });

    // 2. Ensure manifest.json is linked with credentials
    var manifestLink = document.querySelector('link[rel="manifest"]');
    if (!manifestLink) {
      manifestLink = document.createElement('link');
      manifestLink.rel = 'manifest';
      manifestLink.href = 'manifest.json';
      manifestLink.setAttribute('crossorigin', 'use-credentials');
      document.head.appendChild(manifestLink);
    } else if (!manifestLink.getAttribute('crossorigin')) {
      manifestLink.setAttribute('crossorigin', 'use-credentials');
    }

    // 3. Ensure iOS Apple Mobile Web App tags
    var metaCapable = document.querySelector('meta[name="apple-mobile-web-app-capable"]');
    if (!metaCapable) {
      metaCapable = document.createElement('meta');
      metaCapable.name = 'apple-mobile-web-app-capable';
      metaCapable.content = 'yes';
      document.head.appendChild(metaCapable);
    }

    var metaStatus = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    if (!metaStatus) {
      metaStatus = document.createElement('meta');
      metaStatus.name = 'apple-mobile-web-app-status-bar-style';
      metaStatus.content = 'default';
      document.head.appendChild(metaStatus);
    }

    var metaTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    if (!metaTitle) {
      metaTitle = document.createElement('meta');
      metaTitle.name = 'apple-mobile-web-app-title';
      metaTitle.content = 'رفيق الحفظ';
      document.head.appendChild(metaTitle);
    }

    var appleTouchIcon = document.querySelector('link[rel="apple-touch-icon"]');
    if (!appleTouchIcon) {
      appleTouchIcon = document.createElement('link');
      appleTouchIcon.rel = 'apple-touch-icon';
      appleTouchIcon.sizes = '180x180';
      appleTouchIcon.href = 'icons/icon-192.png';
      document.head.appendChild(appleTouchIcon);
    }
  } catch (e) {
    // Non-fatal fallback
  }
})();
