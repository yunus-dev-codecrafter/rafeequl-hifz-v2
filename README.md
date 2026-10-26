# rafeequl-hifz-v2
# رفيق الحفظ — Rafeequl Hifz

Quran memorization daily logbook: PHP 8 + MySQL backend (`api/`), RTL web frontend (`web/`), and a mobile PWA wrapper (`mobile/`).

## Requirements

- PHP >= 8.0 with `pdo_mysql`, `mbstring`, and `openssl`
- MySQL 8 / MariaDB with InnoDB and utf8mb4
- Any PHP-capable server (Apache/Nginx, or `php -S` for dev)

## Fresh install (recommended)

1. Create an empty MySQL database in your hosting panel. Do **not** import
   `config/schema.sql` with a `CREATE DATABASE` prefix — this repository no
   longer contains one, because shared hosts pre-create the database.
2. Upload the project (`api/`, `config/`, `web/`, `index.php`, `setup.php`,
   `.htaccess`). Make sure dotfiles (`.htaccess`) transfer too.
3. Create an empty file named `config/install.enable` in the File Manager.
   This one-time marker is what allows the installer to run.
4. Open `https://your-host/setup.php` and follow the three steps:
   database connection → fresh install → admin account.
5. The installer writes `config/database.local.php`, imports the schema, seeds
   all 604 Madinah pages, applies migration v7, creates the `SUPER_ADMIN`
   account, then writes `config/installed.lock` and removes the enable marker.
6. **Delete `setup.php` from the server.** Check `api/health.php` returns 200,
   then sign in at `web/index.html`.

To recover a lost administrator later, re-upload `setup.php`, delete
`config/installed.lock`, create `config/install.enable`, open the wizard, and use
the optional admin fields in the upgrade form. Delete `setup.php` again when
done.

`config/database.local.php` and `config/installed.lock` are ignored by git.
You can also configure the app with `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`,
`DB_PASS`, and `APP_TIMEZONE` environment variables. The default timezone is
`Africa/Lagos`; tasks and rollover counters use this calendar day.

On Apache, `config/.htaccess` and `api/data/.htaccess` deny direct web access to
secrets and data files. On Nginx (which ignores `.htaccess`), add the equivalent
server block:

```nginx
location ~ ^/(config|api/data)/ { deny all; return 404; }
```

> **Security notice:** older builds committed live database credentials. If
> your database password has ever been in git history, rotate it in the hosting
> panel and update `config/database.local.php`. Never commit that file.

## Upgrading an existing database

The current release needs **migration v7**. It adds `rollover_count` /
`last_rollover_date` to `daily_task_logs`, adds the pending-task indexes, and
removes the runtime `ALTER TABLE` statements that caused slow requests and 502s
on shared hosting.

- CLI: `php config/migrate_v7.php`
- Web: temporarily create `config/install.enable`, open
  `https://your-host/setup.php`, choose **ترقية قاعدة البيانات**, then delete
  `setup.php` and the enable marker.

The migration is additive and idempotent. If you are upgrading from v1, run
`migrate_v2.php` through `migrate_v6.php` first (CLI, or temporary web access),
then run `setup.php` for v7. `config/` is denied over HTTP by `config/.htaccess`;
do not leave migration scripts publicly reachable.

## Rollover counting

A pending task keeps its original `task_date` until it is completed. Each
calendar day it remains unfinished increments `rollover_count` once and updates
`last_rollover_date`; opening the app twice on the same day never double-counts.
The dashboard badge and task pages show the number of rollover days (for
example, `مُرجَّلة ×2`). The count uses `APP_TIMEZONE` (`Africa/Lagos` by
default), so “today” is consistent for every request.

> **Page recall notes (v3)** creates the `page_notes` table.
>
> **Cleaning old paired verses (v5)** clears stray `confused_with_*` values from
> tawaqquf / tashkeel / lafdh mistakes.
>
> **Rub' consolidation (v6)** adds `RUB_TAMKIN`, the rub' columns, and
> `rub_history`. Migration v7 keeps this working and creates `rub_history` if it
> is missing.
>
> **Offline Quran text?** `php api/data/build_quran_text.php` downloads the
> Uthmani text once and writes `web/data/quran-uthmani.json`. It is fetched on
> demand and cached by the service worker; it is no longer pre-cached during
> installation (that made PWA installs slow and fragile).

## Local dev

```powershell
# from project root — serve project over http (web/ + api/ share relative paths)
php -S localhost:8000
# open http://localhost:8000/web/index.html
```

DB credentials live in `config/database.local.php` (copy it from
`config/database.example.php`) or in `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASS`,
and `APP_TIMEZONE` environment variables. `config/database.php` never contains
credentials itself.

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

Upload the whole project (`api/`, `config/`, `web/`, `index.php`, `setup.php`,
`.htaccess`) to `htdocs`. This includes the committed `api/data/tafsir/` files;
without them the recitation page still works, but the per-verse tafsir is
hidden. Make sure `.htaccess` actually transfers (dotfiles are hidden by default
in most FTP clients). Complete the setup wizard at
`https://your-host/setup.php` first (see **Fresh install** above), then open
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
- **Transition cards** (mistakes whose next verse is attached) never reveal the
  next verse on the front; the back shows it under "الآية التالية" with a
  **▶ الآيتان معاً** button that recites the pair in order.
- Filters (type / surah / juz), shuffle, and **undo**; ends with a session
  summary (cards reviewed, recall rate, graduated).

## Page Recall Board (بطاقة تثبيت الصفحة)

Every recitation task page (new memorization, yesterday's repetition, rabt,
murajaah) carries a **per-page recall board** under the page actions, built to
make a page fast to recall:

- **Verse anchors (رؤوس الآيات)** — the opening words of every ayah on the
  page, taken from the offline Uthmani bundle. Tap one to drop it into your
  note (the classic "page map" that chains ayat together), or hit play to hear
  that ayah's recitation.
- **Your mistakes on this page** — pulled from your mistake log and shown as
  ready-made "focus here" cues (type, severity, recurrence), each with an
  *add to board* action.
- **Your note** — free-form, RTL-aware, autosaved. It is written to the device
  immediately and synced to `page_notes` in the background; if the server is
  unreachable or the table is not migrated yet it stays on the device and
  retries later.
- **Play the page** — recites every ayah on the page in order, highlighting
  each one as it goes (follow-the-recitation), with a per-ayah play button too.
- **Long-press an ayah** (or right-click) to open the mistake log **pre-filled**
  with that surah/ayah — one gesture from noticing a slip to logging it.
- **Link two verses (ربط الآيتين)** — tap the 🔗 button on any anchor to log a
  *transition* mistake (`TRANSITION_FAILURE`) with the **next verse** attached.
  In the mistake modal the pair section is now labelled "الآية التالية التي نسيتها"
  and auto-fills to the following ayah (wrapping to the next surah at a
  boundary), so the row records exactly where the recitation broke. The same
  pair field still powers متشابهات confusion, now shown on the card back.
- **Test page transitions (اختبر الانتقالات)** — walks every ayah boundary on
  the page, shows the current ayah, and asks for the opening of the next one.
  Reveal, then mark ✓ recalled or ✗ missed; each miss is logged automatically as
  a transition mistake tied to the verse that follows, and the drill ends with a
  score.
- **Print / PDF** — exports the page map (note + verse openings + your
  mistakes) via the browser's print dialog.
- A dot marks page chips that already have a note. **N** toggles the board,
  **إخفاء (اختبر نفسك)** blurs the note so you can test recall, and **نسخ**
  copies it out.

## Rub' consolidation — تثبيت الربع (v6)

One random **rub' al-hizb** (ربع) per day, drawn from the pages the user has
already consolidated (`last_tikrar_page`; `COMPLETE` accounts draw from all
240). The same rub' is kept for the whole day, rolls over if unfinished, and
does not repeat until the eligible pool has been used once.

- Every verse is split at the **stop-preferring** waqf signs only: ۘ لازم,
  ۗ قلى, ۛ معانقة (first of the pair) and ۜ سكتة. ۖ صلى, ۙ لا and ۚ ج remain in
  the text as a legend, without splitting.
- Each station must be repeated **3 times, slowly**. A verse without a stop sign
  is one station.
- Progress is the count of completed stations, stored as a JSON key list on the
  task row (`completed_stations`) so retries are idempotent. The page also keeps
  a per-task local copy and an offline queue; the latest state wins.
- The exact 240 boundaries come from Quran.com's `rub_el_hizb_number` field,
  cross-checked against the app's own page map. `verify_rub.php` asserts all
  6,236 verses are covered exactly once (6,872 stations in total).
- Every verse has a collapsible tafsir from **Al-Mukhtasar fi al-Tafsir**
  (المختصر في التفسير). Arabic is shown in the Arabic interface and English in
  the English interface, with a graceful fallback if one language is missing.
  The tafsir is split into 240 small per-rub' files so a recitation request
  never has to parse a multi-megabyte Quran-wide bundle.

| File | Purpose |
| --- | --- |
| `api/data/rub_quarters.json` | committed catalog: boundaries, pages, station counts |
| `api/data/tafsir/*.json` | committed per-rub' Mukhtasar tafsir (Arabic + English) |
| `api/tasks/_rub.php` | splitter, catalog/tafsir loaders, fair random picker, history |
| `api/tasks/get_rub_verses.php` | verses + stations + tafsir for one task/rub' |
| `api/tasks/update_rub.php` | idempotent station progress + completion |
| `web/rub.html`, `web/js/rub.js` | recitation page, local state, offline queue |
| `config/build_rub_quarters.php` | rebuilds the catalog (one-off, cached downloads) |
| `config/build_rub_tafsir.php` | rebuilds the per-rub' tafsir bundle |
| `config/verify_rub.php` | catalog, splitter and tafsir regression checks |

The mobile navigation is now five tabs — الرئيسية / الحفظ / المراجعة / البطاقات /
المزيد — where **المزيد** opens a bottom sheet with تكرار الأمس، الربط، المراجعة،
تثبيت الربع and السجل. The shared markup lives in `web/js/nav.js`.

## Focus mode & sticky actions

- The recitation action bar (**إتمام الصفحة / سجل خطأ / المصحف**) sticks to the
  top of the viewport as you scroll, so it stays reachable while reading the
  board below.
- **وضع التركيز** (or key **F**) hides the header, bottom nav, page chips and
  hint strips and enlarges the recitation text for distraction-free memorizing.
  A floating **إنهاء وضع التركيز** button (bottom-left) exits. The choice is
  remembered across visits.

| File | Purpose |
| --- | --- |
| `api/notes/get_page_notes.php` | read notes for a page or a page range |
| `api/notes/save_page_notes.php` | upsert / clear one page's note |
| `web/js/page-notes.js` | the board: anchors, cues, autosave, offline cache |
| `config/migrate_v3.php` | creates `page_notes` (idempotent) |

## Gesture notes

- Page cards (recitation): horizontal swipe moves between pages of the active task.
- Flashcards: tap or swipe flips the card; grade with the four buttons or keys
  **1 = أخطأت, 2 = صعب, 3 = جيد, 4 = سهل**. **↩ تراجع** reverts the last grade.
- Gestures are implemented natively in `web/js/app.js` and `web/js/flashcards.js`;
  `mobile/index.html` only provides a fallback bridge for stale bundles.

## Owner & administration (v4)

The platform now has an authoritative owner account ("the president") that is
separate from learners. It can see every account, its progress and its usage,
and can activate / suspend / disable accounts.

### 1. Apply the schema (once)

```bash
php config/migrate_v4.php
```

`config/.htaccess` and the root `.htaccess` deny direct browser access to
migration scripts. On a host without CLI, temporarily comment out the
`RewriteRule ^(?:config|api/data)...` line in the root `.htaccess` **and**
rename `config/.htaccess`, open
`https://your-host/config/migrate_v4.php?confirm=1`, then restore both files
immediately. Prefer `setup.php` for v7 and fresh installs.

This is additive and idempotent: it adds `role`, `status`, `status_reason`,
`suspended_at`, `last_login_at`, `last_seen_at`, `login_count` and
`must_change_password` to `users`, and creates `user_activity`, `admin_audit`
and `login_attempts`. Nothing is dropped or rewritten.

### 2. Create the owner

The web installer is the recommended path (see **Fresh install** above). For
CLI, an explicit email is now required; there is no hard-coded owner address:

```bash
php config/seed_admin.php email=owner@example.com
# or set a specific password:
php config/seed_admin.php email=owner@example.com password=YourStrongPassword
```

With no `password=` argument a strong random password is generated and printed
**once** to the operator's console. Either way the account is flagged
`must_change_password = 1`, and the app forces a change on the first login.

`config/seed_admin.php` is CLI-only now. It refuses browser requests so nobody
can reset the administrator through a URL. Re-running is safe: it only
re-ensures `SUPER_ADMIN` / `ACTIVE`. It never silently resets an existing
password — use `reset=1` for that:

```bash
php config/seed_admin.php email=owner@example.com reset=1
```

### 3. Sign in

Open `web/index.html`, sign in with the owner email, set a new password, and
you land on `web/admin.html`. The dashboard dropdown also gains a
**لوحة الإدارة** entry for administrators.

### What the owner can see

- Platform KPIs: learners, new signups, DAU / WAU / MAU, "online in the last
  hour", pages memorized, active / due / graduated mistakes, lifetime reviews.
- A searchable, paginated learner directory (name, email, status, current page,
  active mistakes, due now, active days in the last 30, last seen).
- A per-account drill-down: progress, usage calendar (30 days), day streak,
  login count and timestamps, mistake type distribution, weakest surahs, recent
  review events and recent task logs.
- An append-only **admin action log** (`admin_audit`) of status and role changes.

### Roles & states

| Role | Meaning |
| --- | --- |
| `USER` | Learner (default for every registration) |
| `ADMIN` | Reserved tier; read access to the console |
| `SUPER_ADMIN` | The owner: status + role changes |

| Status | Effect |
| --- | --- |
| `ACTIVE` | Full access |
| `SUSPENDED` | Blocked immediately (even mid-session); reason shown on login |
| `DISABLED` | Same as suspended, for permanent closures |

Safeguards: an owner cannot change their own status or role, and the last
active super admin cannot be suspended or demoted.

### Security hardening included

- **Session is authoritative.** All 14 learner endpoints now derive the user
  from the session; a client-supplied `user_id` is only honoured for
  administrators. This closes the previous IDOR (any visitor could read or wipe
  another account by passing its id).
- **Status is re-checked on every request**, so suspension takes effect at once;
  the session is destroyed server-side.
- **Real logout** (`api/auth/logout.php`): the old button only removed a
  localStorage name while the PHP session stayed valid.
- **Login hardening**: `session_regenerate_id()`, 8 failed attempts / 15 min
  throttle per email, and a generic credential error.
- **Passwords**: `password_hash()` / `password_verify()`, rehash on login when
  the default cost changes. No password is ever stored in the repository.

### Endpoints

| File | Purpose |
| --- | --- |
| `config/auth.php` | guards: `rh_require_login`, `rh_require_admin`, `rh_require_super_admin`, `rh_resolve_user_id`, activity tracking, audit, throttling |
| `api/auth/me.php` | current session user (side-effect free) |
| `api/auth/logout.php` | destroy the session |
| `api/auth/change_password.php` | change own password (forced first change) |
| `api/admin/overview.php` | platform KPIs |
| `api/admin/list_users.php` | paginated, searchable directory |
| `api/admin/get_user.php` | full per-account detail |
| `api/admin/set_status.php` | activate / suspend / disable (super admin) |
| `api/admin/set_role.php` | change role (super admin) |
| `api/admin/audit_log.php` | recent admin actions |
| `web/admin.html`, `web/js/admin.js` | the console |
| `web/change-password.html`, `web/js/change-password.js` | forced / voluntary password change |

### Deploy order

1. Upload `config/` (including `.htaccess`, `database.example.php`, `migrate_v7.php`), `setup.php`, `api/` and the changed `web/` files.
2. Upload `config/database.local.php` separately with the current credentials if you deploy over FTP (it is intentionally ignored by git). If you deploy through git and that file is absent, the app cannot connect until you run `setup.php`; use the wizard to write it, or set `DB_*` environment variables.
3. Create `config/install.enable`, open `https://your-host/setup.php`, choose **ترقية قاعدة البيانات** (upgrade), and optionally set a new admin password.
4. The wizard applies migration v7, seeds page metadata, writes `config/installed.lock`, and removes the enable marker. **Delete `setup.php` from the server.**
5. Open `api/health.php` (expect 200 and `"tafsir_ok": true`), hard-refresh `web/index.html`, and confirm the new service worker cache (`rafeequl-hifz-v17`) is active.

> Back up the database before step 3 on a live site. The migration is additive,
> but a backup is always the right first move. If the host's PHP cannot reach
> MySQL, use its phpMyAdmin/CLI and run `config/migrate_v7.php` there instead.
