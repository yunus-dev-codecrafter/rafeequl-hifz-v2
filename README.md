# rafeequl-hifz-v2
# رفيق الحفظ — Rafeequl Hifz

Quran memorization daily logbook: PHP 8 + MySQL backend (`api/`), RTL web frontend (`web/`), and a mobile PWA wrapper (`mobile/`).

## Requirements

- PHP >= 8.0 with `pdo_mysql`
- MySQL 8 (import `config/schema.sql`, then seed meta via `api/data/seed_madinah_meta.php` or `config/seed_madinah_pages.sql`)
- Any PHP-capable server (Apache/Nginx, or `php -S` for dev)

## Local dev

```powershell
# from project root — serve project over http (web/ + api/ share relative paths)
php -S localhost:8000
# open http://localhost:8000/web/index.html
```

DB credentials/env overrides live in `config/database.php` (`DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASS`).

---

## Hosting & HTTPS (required for app installation)

**The app can only be installed on phones when it is served over HTTPS.**
Browsers refuse to register the service worker on plain `http://` origins
(only `https://` or `http://localhost` count as secure), and without the
service worker the "Install app" option never appears — this is why users
on phones could not install the app before.

### Enable free SSL on InfinityFree

1. The free `*.unaux.com` subdomains **do not support SSL** — you need a
   custom domain attached to your InfinityFree account (free domains from
   Freenom / a cheap registrar both work).
2. In the InfinityFree Client Area → **Control Panel** → **SSL/TLS** →
   choose **Let's Encrypt** and issue the certificate for your domain.
   (If the panel shows "Custom SSL", you can paste a certificate there too.)
3. Wait for the certificate to activate (up to a few hours), then confirm
   `https://your-domain.tld` loads the site in a mobile browser.
4. Uncomment the HTTPS-redirect block at the top of `.htaccess` (project
   root) so every `http://` visit is permanently redirected to `https://`.
5. Upload the whole project (`api/`, `config/`, `web/`, `index.php`,
   `.htaccess`) to `htdocs`. Make sure `.htaccess` actually transfers
   (dotfiles are hidden by default in most FTP clients).

After that, Chrome on Android shows **«تثبيت التطبيق / Install app»** in the
browser menu and the in-app 📲 button triggers the native 1-click install.
On iPhone (Safari) the in-app button shows the «Add to Home Screen» guide,
which does not require HTTPS to work but is far more reliable with it.

> Install button behaviour: the button only appears for users who have **not**
> installed the app yet. Once installed, it is hidden permanently
> (`localStorage.pwa_installed` + `getInstalledRelatedApps()` detection),
> even when the user later opens the site in a normal browser tab.

---

## Wrapping with Capacitor (APK / iOS build)

### 1. Prerequisites

- Node.js 18+
- Android Studio (Android SDK + Gradle) for APK
- Xcode (macOS only) for iOS

### 2. Init

```powershell
cd C:\Users\YUNUS\Desktop\rafeequl_hifz
npm init -y
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap init "Rafeequl Hifz" com.rafeequl.hifz --web-dir=mobile
```

`capacitor.config.ts` (created by init) — point the WebView at your running PHP
server so the API is reachable (the backend is **not** bundled into the app):

```ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.rafeequl.hifz',
  appName: 'رفيق الحفظ',
  webDir: 'mobile',
  server: {
    // Your machine's LAN IP running the PHP server, e.g. http://192.168.1.10:8000
    url: 'http://YOUR_LAN_IP:8000/mobile/index.html',
    cleartext: true, // needed for plain-http LAN dev only; drop it behind HTTPS
  },
};

export default config;
```

> Alternative: keep `server.url` unset and copy `api/` onto a PHP host; the app
> then uses relative paths (`../api/...`) against that host.

### 3. Add platform & build

```powershell
npx cap add android          # once (creates android/)
npx cap sync android         # copy web assets after any change to mobile/ or web/
npx cap open android         # open in Android Studio -> Build > Build APK(s)
```

APK output: `android/app/build/outputs/apk/debug/app-debug.apk`.

iOS (macOS): `npx cap add ios && npx cap sync ios && npx cap open ios`.

### 4. PWA / Add-to-Home-Screen

`mobile/manifest.json` + meta tags are already configured (standalone display,
RTL, theme color `#0f766e`). In a normal mobile browser the site offers
"Add to Home Screen"; icons are placeholders (`mobile/icon-192.png`,
`mobile/icon-512.png`) — replace them with final artwork before release.

## Gesture notes

- Page cards (recitation): horizontal swipe moves between pages of the active task.
- Flashcards: tap or swipe flips the card; actions are **✅ أتقنتها** (archives)
  and **🔄 مواصلة التدريب** (rotates card to end of deck).
- Gestures are implemented natively in `web/js/app.js` and `web/js/flashcards.js`;
  `mobile/index.html` only provides a fallback bridge for stale bundles.
