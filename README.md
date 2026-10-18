# rafeequl-hifz-v2
# رفيق الحفظ — Rafeequl Hifz

Quran memorization daily logbook: PHP 8 + MySQL backend (`api/`), RTL web frontend (`web/`), and a mobile PWA wrapper (`mobile/`).

## Requirements

- PHP >= 8.0 with `pdo_mysql`
- MySQL 8 (import `config/schema.sql`, then seed meta via `api/data/seed_madinah_meta.php` or `config/seed_madinah_pages.sql`)
- Any PHP-capable server (Apache/Nginx, or `php -S` for dev)

> **Upgrading an existing v1 database?** Run the idempotent migration once —
> `php config/migrate_v2.php` (CLI) or open
> `https://your-host/config/migrate_v2.php?confirm=1` in a browser. It adds the
> spaced-repetition columns to `mistakes` and creates `mistake_events` without
> touching existing data. Fresh installs get everything from `config/schema.sql`.
>
> **Offline Quran text?** `php api/data/build_quran_text.php` downloads the
> Uthmani text once and writes `web/data/quran-uthmani.json` (the flashcard
> back face + service worker use it offline).

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
service worker the "Install app" option never appears.

### HTTPS on InfinityFree

InfinityFree free subdomains (`*.infy.click`, `*.rf.gd`, `*.wuaze.com`, …)
are protected by a system-wide SSL certificate **automatically** — there is
nothing to request or install (this changed in May 2025). HTTPS just works,
and the force-HTTPS redirect at the top of `.htaccess` is enabled.

Only a `www.` prefix on a free subdomain is *not* covered by the wildcard
certificate — use the bare subdomain (`rafeequlhifz.infy.click`).

### Why a plain `manifest.json` cannot work here

InfinityFree's **Browser Security System** answers requests with a
JavaScript/cookie challenge (`aes.js` → `__test` cookie) until the browser
solves it. For `manifest.json`, `sw.js`, `.html` and `.json` the challenge
is returned with `Content-Type: text/html`. Android Chrome fetches the
manifest in a way that does **not** carry the cookie, receives the challenge
page instead of JSON, and reports the app as not installable
(“Manifest: Line 1, column 1, Syntax error”).

The challenge **cannot be disabled** on free hosting (premium only) and
cannot be exempted per URL — InfinityFree's own knowledge base lists
progressive web apps among the things that do not work with it.

### The workaround (already applied)

`web/js/pwa-manifest.js` builds the manifest in JavaScript and points
`<link rel="manifest">` at a **Blob URL**, so the browser never requests
`manifest.json` and there is nothing for the challenge to intercept. Every
page loads this script from `<head>` instead of linking `manifest.json`.
`sw.js` still loads as a normal file: by the time registration runs the page
has already solved the challenge and the `__test` cookie is present, so
`sw.js` is served as real JavaScript (registration retries once in case it
races the cookie).

Reference: <https://forum.infinityfree.com/t/how-to-make-a-working-progressive-web-app/116505>

### Deploy

Upload the whole project (`api/`, `config/`, `web/`, `index.php`,
`.htaccess`) to `htdocs`. Make sure `.htaccess` actually transfers (dotfiles
are hidden by default in most FTP clients). Then open
`https://rafeequlhifz.infy.click/` on the phone.

Chrome on Android then shows **«تثبيت التطبيق / Install app»** in the
browser menu and the in-app 📲 button triggers the native 1-click install.
On iPhone (Safari) the in-app button shows the «Add to Home Screen» guide.

> Because of the security system, the installed app still needs Internet
> access periodically so the challenge can reissue its 6-hour cookie.

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

The installable PWA is the one served from `web/`. Its manifest is generated
at runtime by `web/js/pwa-manifest.js` (a Blob URL — see the hosting section
above) and uses the real icons in `web/icons/` (192/512, plus maskable).

`mobile/` also carries a `manifest.json` + meta tags for the Capacitor
wrapper (standalone display, RTL, theme color `#0f766e`). Its icons
(`mobile/icon-192.png`, `mobile/icon-512.png`) are placeholders — replace
them with final artwork before shipping an APK.

## Spaced repetition & the mistake model (v2)

The mistake log is now a small **spaced-repetition system** instead of a plain
list:

**Logging**
- Logging the *same* mistake again does **not** add a duplicate row — it bumps
  `occurrence_count`, raises `severity` to the max, resets the schedule (a
  lapse) and writes a `LOGGED` event.
- Each mistake can carry `severity` (بسيط/متوسط/شديد), a `source_task`, and for
  متشابهات a `confused_with_surah` / `confused_with_ayah` pairing.
- Mistakes can be edited from the history page (`update_mistake.php`), which
  records an `EDITED` event with the previous snapshot.

**Scheduling (SM-2 lite)** — `api/mistakes/_srs.php`
- Grades: **أخطأت / صعب / جيد / سهل** (AGAIN/HARD/GOOD/EASY).
- Interval ladder grows 1 → 3 → 7 → … capped at 365 days; `AGAIN` resets to
  1 day and increments `lapses`; ease starts at 2.50 (range 1.30–2.80).
- A card graduates (ARCHIVED) after **3 consecutive GOOD/EASY** reviews that
  reach a ≥ 30-day interval; it can be reactivated from history.
- Every transition is recorded in `mistake_events` (append-only audit trail),
  which also powers the review **streak** and undo.

**Endpoints**
| File | Purpose |
| --- | --- |
| `record_mistake.php` | log / de-duplicate a mistake (returns `merged`) |
| `review_mistake.php` | apply a grade and reschedule |
| `undo_review.php` | revert the last review (within 30 min) |
| `get_flashcards.php` | due-first deck: `mode` (`due`/`all`), filters, shuffle, counters |
| `update_mistake.php` | edit type / severity / notes / mutashabihat pairing |
| `clear_mistake.php` | MASTERED / REACTIVATE / KEEP_PRACTICING / DELETE |
| `get_history.php` | log + type distribution + per-juz heatmap + due summary + streak |

**Flashcards page** (`web/flashcards.html` + `web/js/flashcards.js`)
- Due/new/active counters and a session progress bar.
- Card **back** now shows the actual **ayah text** (offline bundle) and a
  **recitation play** button (per-ayah audio, cached by the service worker).
- Grade with the buttons, keys **1–4**, or **ف** to reveal; swipe or tap flips.
- Filters (type / surah / juz), shuffle, and **undo**; ends with a session
  summary (cards reviewed, recall rate, graduated).

## Gesture notes

- Page cards (recitation): horizontal swipe moves between pages of the active task.
- Flashcards: tap or swipe flips the card; grade with the four buttons or keys
  **1 = أخطأت, 2 = صعب, 3 = جيد, 4 = سهل**. **↩ تراجع** reverts the last grade.
- Gestures are implemented natively in `web/js/app.js` and `web/js/flashcards.js`;
  `mobile/index.html` only provides a fallback bridge for stale bundles.
