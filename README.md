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
   `migrate.php`, `.htaccess`). Make sure dotfiles (`.htaccess`) transfer too.
3. Create an empty file named `config/install.enable` in the File Manager.
   This one-time marker is what allows the installer to run.
4. Open `https://your-host/setup.php` and follow the three steps:
   database connection → fresh install → admin account.
5. The installer writes `config/database.local.php`, imports the schema, seeds
   all 604 Madinah pages, applies migration v12 (which includes v7-v11),
   creates the `SUPER_ADMIN` account, then writes `config/installed.lock` and
   removes the enable marker.
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

The current release needs **migration v14**. It runs v7–v13 first, then:

- adds `PAGE_TAMKIN` to the task and mistake-source enums;
- creates `consolidation_selections` and `consolidation_pages` for the
  page-by-page consolidation queue and per-page history;
- leaves the legacy Rub' tables and data untouched for safety, while runtime code
  stops using them.

Migration v11 creates the legacy `waqf_flags` table and the
`users.gate_waqf_*` columns. They are kept for compatibility and existing data,
but the flagged-waqf UI and API were removed; the entry gate no longer has a
waqf step. It also hard-deletes existing `ARCHIVED` mistakes, because completed
mistakes are no longer kept (they are deleted automatically at 40/40).

Migration v10 adds `kalimaat_progress` for per-user Qur’anic word meanings and
the original `users.gate_mistake_*` columns.

Migration v9 itself adds `practice_count` / `practice_target` (default 40) to
`mistakes`, narrows `mistake_type` to `AYAH_MISTAKE`, `TRANSITION_FAILURE`, and
`MUTASHABIHAT`, and remaps the old `TAWAQQUF` / `TASHKEEL` / `LAFDH` values.

`setup.php` is intentionally locked after installation. **Do not delete
`config/installed.lock` for a normal upgrade.** Use the admin-only migration
runner instead:

1. Upload the new code, including `migrate.php`, `config/migrate_v12.php`, and
   the earlier `config/migrate_v*.php` files.
2. Sign in at `web/index.html` with an `ADMIN` or `SUPER_ADMIN` account.
3. Open `https://your-host/migrate.php` and press the migration button.
4. Check `api/health.php` returns 200 with `"schema_ok": true`,
   `"kalimaat_ok": true`, and `"tafsir_ok": true`.

Alternative CLI: `php config/migrate_v12.php`.

The installer remains available as a fallback for a lost admin or a fresh
install: re-upload `setup.php`, delete `config/installed.lock`, create
`config/install.enable`, open the wizard, then delete `setup.php` again.

The migration is additive and idempotent except for the intentional cleanup of
old archived mistake rows. If you are upgrading from v1, run `migrate_v2.php`
through `migrate_v6.php` first (CLI, or temporary web access), then run v14.
`config/` is denied over HTTP by `config/.htaccess`; `migrate.php` is the
supported browser entry point and is protected by admin login and CSRF.
The remaining waqf table/columns are never read by the app. Local device data is
not deleted; the page-consolidation queue starts empty and fills as the user
selects weak targets or lets the server pick pages.

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
> single-verse mistakes.
>
> **Rub' consolidation (v6)** adds `RUB_TAMKIN`, the rub' columns, and
> `rub_history`. Migration v8 keeps this working and creates `rub_history` if it
> is missing.
>
> **Practice counter (v9)** narrows `mistake_type` to the three real categories,
> adds `practice_count` / `practice_target` (default 40), and backfills archived
> rows to 40/40. Run `php config/migrate_v9.php`, or sign in as an admin and
> open `migrate.php`.
>
> **Word meanings + entry gate (v10)** creates `kalimaat_progress`, adds the
> gate columns on `users`, and adds `last_test_session`. Run
> `php config/migrate_v10.php` (it also runs v7–v9), or open `migrate.php` as an
> admin.
>
> **Flagged waqf + hard-delete mistakes (v11)** creates the legacy `waqf_flags`
> table and `users.gate_waqf_*` columns, and removes archived mistakes. The
> flagged-waqf feature was later removed from the UI and API, so these objects
> remain only to preserve existing data. Run `php config/migrate_v11.php`
> (it also runs v7–v10), or open `migrate.php` as an admin.
>
> **Rub' consolidation session (v12)** creates `rub_sessions`, `rub_results`,
> `rub_verse_stats`, and `rub_word_misses`. The session adds the five revision
> exercises, first-attempt accuracy, weak-word tracking and simple spaced
> repetition without changing the existing `RUB_TAMKIN` task or arrangement
> progress. Run `php config/migrate_v12.php` (it also runs v7–v11), or open
> `migrate.php` as an admin.

## New memorization (HIFZ_JADID)

The new-memorization room is a single active verse at a time:

1. Recite the current verse alone **20 times**. The counter is mandatory; the
   screen does not advance early.
2. Then recite the **adjacent pair** (the previous verse + the current verse)
   together **20 times**. The first verse of the page has no pair step.
3. After the final verse, recite the **whole page** once from first to last
   verse.
4. Tap **Complete memorization**. The server checks that every verse has 20
   solo repetitions, every pair has 20 linked repetitions, and the page pass is
   done before advancing `current_hifz_page`.

Progress is saved locally after every tap and mirrored with a debounce to
`api/tasks/update_hifz_progress.php`, so a reload resumes where you stopped.
Completion still goes through `api/tasks/update_progress.php`. If the required
migration is not applied yet, local progress and task completion still work, but
the screen warns that server-side verse progress is pending.
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
`migrate.php`, `.htaccess`) to `htdocs`. This includes the committed `api/data/tafsir/` files;
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

## Mistake practice: 3 categories × 40 repetitions (v9)

The mistake log is no longer a spaced-repetition scheduler. It is a **practice
counter**: every active mistake must be recited correctly **40 times**, and at
40 it is **hard-deleted automatically** — the row is not archived. Logging the
same mistake later creates a fresh card.

**The three categories** (`mistake_type`)
| Key | Arabic | Meaning |
| --- | --- | --- |
| `AYAH_MISTAKE` | خطأ في آية | any slip inside one verse (wording, diacritics, pause) |
| `TRANSITION_FAILURE` | نسيان الآية التالية | forgot which verse comes next; pair = next verse |
| `MUTASHABIHAT` | آيات متشابهة | confused with a similar verse; pair = twin verse |

The old `TAWAQQUF` / `TASHKEEL` / `LAFDH` values are remapped to
`AYAH_MISTAKE` by migration v9. A paired verse (`confused_with_*`) is only kept
for the two pair categories.

**Logging**
- Logging the *same* mistake again does **not** add a duplicate row while the
  card is still active: it bumps `occurrence_count` and resets `practice_count`
  to 0. Once the card is deleted at 40/40, logging it again creates a new row.
- For `MUTASHABIHAT`, the modal shows up to six **similar verses** instantly
  from the bundled `web/data/mutashabihat.json` (offline, no API call). Tapping
  a suggestion fills the paired verse and previews its text.
- Each mistake can carry `severity` (بسيط/متوسط/شديد), a `source_task`, notes,
  and for the pair categories a `confused_with_surah` / `confused_with_ayah`.
- Mistakes can be edited from the history page (`update_mistake.php`), which
  records an `EDITED` event with the previous snapshot.

**The counter** — `api/mistakes/_practice.php`
- `practice_count` / `practice_target` (default 40).
- **Correct recitation** → `+1`. **Slip** → no increment (and a `lapses` bump).
- Reaching the target **deletes the card row** (`review_mistake.php` returns
  `completed: true, deleted: true`) and records a `MASTERED` event. The
  `mistake_events` audit row is kept with `mistake_id = NULL` through the
  `ON DELETE SET NULL` foreign key, so the daily streak survives.
- Every action is recorded in `mistake_events` (append-only), which powers the
  review **streak** and undo.

**Endpoints**
| File | Purpose |
| --- | --- |
| `record_mistake.php` | log / de-duplicate a mistake, reset the counter, return practice fields |
| `review_mistake.php` | apply `CORRECT` / `SLIP`, hard-delete at 40 |
| `undo_review.php` | revert the last practice action (within 30 min) |
| `get_flashcards.php` | all ACTIVE cards + remaining repetitions + completed count |
| `update_mistake.php` | edit type / severity / notes / mutashabihat pairing |
| `clear_mistake.php` | MASTERED / REACTIVATE / KEEP_PRACTICING / DELETE |
| `get_history.php` | log + type distribution + per-juz heatmap + practice summary + streak |

**Flashcards page** (`web/flashcards.html` + `web/js/flashcards.js`)
- Every active card is in the deck; there is no due-date filter.
- The card front shows the verse reference and a **progress bar** with
  `count / 40`; the back shows the actual **ayah text** (offline bundle) and a
  **recitation play** button (per-ayah audio, cached by the service worker).
- Two actions: **✓ تلوتها صحيحة (+١)** and **✗ تعثرت**, plus **التالي** to skip.
  Keys: `+`/`1` correct, `-`/`2` slip, `n` next, space flips.
- **Transition / mutashabihat cards** never reveal the paired verse on the
  front; the back shows it with a **▶ الآيتان معاً** button that recites both in
  order.
- Filters (type / surah / juz), shuffle, and **undo**; ends with a session
  summary (attempts, correct repetitions, completed cards).

**Mutashabihat data**
- `web/data/mutashabihat.json` is generated offline by
  `php config/build_mutashabihat.php` from the CC0
  [Waqar144/Quran_Mutashabihat_Data](https://github.com/Waqar144/Quran_Mutashabihat_Data)
  list plus a computed wording-similarity fallback (IDF-weighted content-word
  overlap, top 8 per verse). Attribution is in
  `api/data/mutashabihat/NOTICE.md`.
- Verify it with `php config/verify_mutashabihat.php`; the service worker
  pre-caches the 55 KB file, so suggestions work offline.

## Word meanings + entry gate (v10)

### The blocking entry gate

`web/js/entry-gate.js` is loaded on the dashboard and every main task page, so
a direct bookmark cannot bypass it. It opens **once per browser app session**
(`sessionStorage`) before the daily tasks are usable:

1. **معاني كلمات القرآن** — the currently locked word is shown with its meaning
   and reference. The user must record **25 repetitions** for this entry, or the
   remaining lifetime count if fewer than 25 are left before 500.
2. **بطاقة خطأ** — the mistake card locked in `users.gate_mistake_id` is shown
   with its mistake type. `AYAH_MISTAKE` shows the single ayah;
   `TRANSITION_FAILURE` shows the ayah where the user stopped plus the next ayah;
   `MUTASHABIHAT` shows both the current and the similar ayah. Only **correct**
   recitations count; 10 are required per entry (or the remainder before 40). The
   card is **deleted automatically at 40/40**. If a legacy transition card has no
   stored next-ayah reference, the client derives it from the Quran text.
The gate has **three** steps in this order: page consolidation, word meanings,
then one mistake card. The old flagged-waqf step and its API were removed; the
`waqf_flags` table and `users.gate_waqf_*` columns are retained only for existing
data and are no longer read.

The gate is sequential, cannot be dismissed by clicking the backdrop, and fails
open if the API or catalog is unavailable. If the user must change their
password, the gate steps aside. `sessionStorage` is per tab, so closing the tab
re-arms the gate. The dedicated Kalimaat page remains reachable from **More**.

### Progress model

| Status | Meaning |
| --- | --- |
| `LOCKED` | The one word currently practised; it stays locked until 500 repetitions |
| `READY` | 500 reached; the word is in the test pool |
| `MASTERED` | Three correct answers in three separate app sessions |

- The locked word is chosen randomly from pages `1..current_hifz_page`, or all
  `604` pages for `COMPLETE` users.
- Only one word is locked at a time. When it reaches 500 the next entry (or the
  dedicated page) locks another eligible word.
- The test draws randomly from `READY` words **inside the current zone**.
- A user can browse the whole zone, filter by juz/page/status, and manually lock
  a new word only when nothing is locked.

### Endpoints

| File | Purpose |
| --- | --- |
| `api/kalimaat/get_entry.php` | gate state: locked word, stats, zone, locked mistake |
| `api/kalimaat/repeat.php` | add 1–50 repetitions to the locked word |
| `api/kalimaat/lock.php` | manually lock a word when nothing is locked |
| `api/kalimaat/list.php` | browse/filter words in the zone with progress |
| `api/kalimaat/test.php` | random test question from `READY` words |
| `api/kalimaat/test_answer.php` | grade one answer; one counted correct per app session |

### Catalog

The catalog is static content under `web/data/kalimaat/` and is **not** fetched
from a third party at runtime. It is generated from the Quranpedia.net meanings
dump:

```powershell
php config/build_kalimaat.php --source="$env:TEMP\opencode\qp\meanings.json.gz"
```

The output is `meta.json` plus 30 juz shards (`juz/1.json` … `juz/30.json`).
About 13,600 word/expression cards cover 4,709 ayahs because the source books are
ghareeb/selected-word works, not a full word-by-word lexicon. The source licence
allows free in-app use with a link appreciated; republishing the dataset requires
credit to Quranpedia.net and the dump version. `api/health.php` reports
`kalimaat_ok` separately so a missing upload does not make the whole app fail.

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

## Native Mushaf reader (المصحف)

`web/mushaf.html` is a full-screen, text-based Madinah Mushaf reader. It
replaces the old modal that tried to load `images.quran.com/page/{n}.png`; that
endpoint returns 404 for every page, so the modal always fell back to an
external Quran.com link.

- **Every one of the 604 pages** is rendered from the project's own
  `web/data/quran-uthmani.json` and the existing 604-page verse map in
  `web/js/madinah_page_verses.json`. No page images, no external API, and no
  schema change.
- **Opening page** priority: `?page=N` → the last-read bookmark
  (`rh_mushaf_last_page`) → the account's `current_hifz_page` → page 1. Task
  pages and the recall board open it at their current page through
  `openMushafModal(page)`, which now navigates to `mushaf.html?page=N`.
- **Page-accurate content**: surah bands, the synthesized basmala (skipped for
  At-Tawbah and not duplicated for Al-Fatiha), Arabic-Indic ayah/page numerals,
  and juz/hizb/rub' labels. Line wrapping is the reader's own, not a
  photographic facsimile of the printed page.
- **Navigation**: previous/next page, direct page number, surah jump, juz jump,
  a "my page" shortcut, font-size controls (persisted), and the app's theme and
  language toggles. ArrowLeft goes to the next page (RTL convention) and
  ArrowRight to the previous one.
- **Ayah actions**: tap any ayah to open a small action bar with play, copy
  (with the surah/ayah reference), and log-a-mistake. The mistake button opens
  the shared modal pre-filled through `openMistakeModalForAyah()`.
- **Audio**: per-ayah and whole-page recitation from EveryAyah
  (`Alafasy_128kbps`), with the current ayah highlighted as the page plays.
- **Page note**: a read-only, collapsed-by-default card fed by
  `api/notes/get_page_notes.php?page_number=N`. It is hidden for logged-out
  users, empty notes, unavailable tables, or a 401.
- **Offline**: `mushaf.html`, `css/mushaf.css`, `js/mushaf.js` and
  `data/mushaf_meta.json` are precached by the service worker. The 1.3 MB
  Qur'an text bundle is cached on first fetch by the existing network-first
  handler, so a page opened once is readable offline afterwards.

### Build & verify

```bash
php config/build_mushaf_meta.php   # web/data/mushaf_meta.json (604 rows)
php config/verify_mushaf.php       # page map, text bundle and metadata checks
```

`mushaf_meta.json` is a compact `{ "_meta": {...}, "pages": [[juz, hizb, rub], ...] }`
table; `rub` is the absolute rub' al-hizb (1–240), converted from the
`rub_el_hizb` 1–4 field in `api/data/madinah_pages.json`.

## Page-by-page consolidation — تثبيت الصفحة (v14)

Consolidation is now **one whole Madinah page per entry**, not a rub' and not a
verse-by-verse drill. A page is chosen from the pages the user has already
memorised (طرف الحفظ from `last_tikrar_page`; a `COMPLETE` account draws from
all 604 pages).

- **Weak targets are queued.** The user can select a surah, a rub' or a single
  page. Selected targets are processed in selection order, page by page. If no
  target exists, the server picks a random eligible page, preferring pages that
  have not been consolidated in the last 30 days.
- **The entry gate shows the page first.** It displays the first few words of the
  page, asks the user to recite from memory, then reveals the page and plays the
  recitation. The user marks **تم، ثبّتها** (DONE) or **أحتاج تحسينًا** (IMPROVE).
  The gate then continues to word meanings and the mistake card, in that order.
- **The in-app page has one exercise.** The user arranges the whole page in
  10-word sliding windows across verse boundaries. Completed windows stay fixed;
  a wrong tap never removes the correct order. The page then moves to recitation,
  reveal + listening, and the same DONE / IMPROVE result.
- **DONE advances; IMPROVE repeats.** A DONE page is not shown again immediately;
  a new page appears on the next entry. An IMPROVE page stays pending and is the
  next page again, even on the next day, until it is marked DONE. There is no
  task-level rollover counter for consolidation.
- **Audio** uses EveryAyah's Alafasy 128 kbps files
  (`https://everyayah.com/data/Alafasy_128kbps/SSSAAA.mp3`), played one ayah at a
  time, with the current ayah highlighted.

### Storage and endpoints

Migration v14 creates:

| Table | Purpose |
| --- | --- |
| `consolidation_selections` | queued weak surah / rub' / page targets |
| `consolidation_pages` | per-user page status, attempts, last result and rotation history |

The legacy rub' tables (`rub_history`, `rub_sessions`, `rub_results`,
`rub_verse_stats`, `rub_word_misses`) are kept untouched for historical data,
but runtime code no longer uses them.

| File | Purpose |
| --- | --- |
| `api/tasks/_page.php` | page text/words, target queues, task creation, DONE/IMPROVE state |
| `api/tasks/consolidation.php` | GET state and POST select / unselect / clear / save_progress / result |
| `api/tasks/get_daily_tasks.php` | returns one `PAGE_TAMKIN` card for the day |
| `api/kalimaat/get_entry.php` | returns the page-consolidation payload as the first gate step |
| `web/consolidation.html` | in-app page markup |
| `web/js/consolidation.js` | arrangement, recitation, audio, targets and result controller |
| `web/css/consolidation.css` | page styles |
| `web/js/entry-gate.js` | gate step: first words → recitation → reveal/listen → result |

The mobile navigation now includes **تثبيت الصفحة** in the **المزيد** sheet
instead of **تثبيت الربع**. The shared markup lives in `web/js/nav.js`.

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
- Flashcards: tap or swipe flips the card; practice with **+ / 1 = تلوتها صحيحة**,
  **- / 2 = تعثرت**, **n = التالي**. **↩ تراجع** reverts the last action.
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
immediately. Prefer `migrate.php` for v12 and later upgrades, and `setup.php`
for fresh installs.

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
  hour", pages memorized, active / completed mistakes, lifetime reviews.
- A searchable, paginated learner directory (name, email, status, current page,
  active mistakes, repetitions left, active days in the last 30, last seen).
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

1. Upload `config/` (including `.htaccess`, `database.example.php`, `migrate_v14.php` through `migrate_v7.php`), `migrate.php`, `setup.php`, `api/` (the `api/waqf/` folder is gone) and the changed `web/` files (including `web/consolidation.html`, `web/js/consolidation.js`, `web/css/consolidation.css`, `web/js/entry-gate.js`, `web/js/app.js`, `web/js/review.js`, `web/js/nav.js`, `web/data/kalimaat/`, `web/data/mutashabihat_curated.json`, and `web/js/kalimaat.js`). Remove the retired `web/rub.html`, `web/js/rub*.js`, and `web/css/rub-session.css` files from the server. For the Mushaf reader also upload `web/mushaf.html`, `web/css/mushaf.css`, `web/js/mushaf.js`, and `web/data/mushaf_meta.json`; no migration is required for it.
2. Upload `config/database.local.php` separately with the current credentials if you deploy over FTP (it is intentionally ignored by git). If you deploy through git and that file is absent, the app cannot connect until you run `setup.php`; use the wizard to write it, or set `DB_*` environment variables.
3. Sign in as an administrator and open `https://your-host/migrate.php`, then press **تشغيل ترقية v14 الآن**. For a fresh install, use `setup.php` instead.
4. The migration runner applies v14 (including v7-v13) and leaves `config/installed.lock` untouched. `setup.php` remains locked. Existing `ARCHIVED` mistake rows are purged intentionally.
5. Open `api/health.php` (expect 200, `"schema_ok": true`, `"tafsir_ok": true`, and `"kalimaat_ok": true`), hard-refresh `web/index.html`, and confirm the new service worker cache (`rafeequl-hifz-v32`) is active.

> Back up the database before step 3 on a live site. The migration is additive
> except for the intentional purge of completed mistake rows, but a backup is
> always the right first move. If the host's PHP cannot reach MySQL, use its
> phpMyAdmin/CLI and run `config/migrate_v12.php` there instead.
