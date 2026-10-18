# Rafeequl Hifz — What happens on Day 7 (revision set to 6 days)

Precise, code-grounded answer to the questions in `bug.txt`.

**Scope:** a `NEW` or `EXISTING` user who has set **`murajaah_days = 6`** and who memorizes
**one new page per day** (the app's normal rhythm). `COMPLETE` users behave differently
(their review pool is always all 604 pages) and are covered at the end.

Sources (verified against the current code):
`api/tasks/get_daily_tasks.php`, `api/tasks/update_progress.php`,
`api/tasks/undo_progress.php`, `api/tasks/update_plan.php`.

---

## 0. Short answers to your questions

1. **What is supposed to happen on Day 7?** The rabt cycle closes. `rabt_extra_pages`
   is reset to `0`, so **Rabt shrinks back to exactly the last 30 graduated pages**, and
   **Muraja'ah restarts from page 1**, covering the whole range `[1 … rabtStart − 1]`
   (i.e. *all pages that are not in Rabt*), split into 6 daily chunks.
2. **Is your description of rabt correct?** Yes. On Day 7 Rabt = the last 30 graduated
   pages = the newest 6 pages + the remaining 24 older ones. The 6 pages that were
   ejected from Rabt join the Muraja'ah pool.
3. **Why did Day 7 previously show only the 6 pages that left Rabt, only in revision?**
   That was a real bug (the chunk cursor continued from `max(end_page)+1` instead of
   restarting). It is **already fixed** in commit `a6df11b`
   ("Fix Muraja'ah Day 7 cycle restart bug"). Section 5 below explains it.
   In the current code the Day-7 revision chunk starts at **page 1**, not at the 6 ejected pages.

---

## 1. The four moving pieces of state

Stored on the `users` row (`get_daily_tasks.php:256-264`, `update_progress.php:217`):

| Variable | DB column | Meaning |
|---|---|---|
| `current` | `current_hifz_page` | Highest page the user has memorized (Hifz Jadid). |
| `lastTikrar` | `last_tikrar_page` | Highest page that has **graduated** Tikrar Ams (recited 10×). Only graduated pages are eligible for Rabt. |
| `E` | `rabt_extra_pages` | How many pages the Rabt window has grown past its base of 30 **during the current round**. This is effectively the round's day/page counter. |
| `D` | `murajaah_days` | The user's chosen cycle length (here `6`). |

### Derived ranges (recomputed every time the dashboard loads)

```
rabtWindow = 30 + E
rabtEnd    = min(lastTikrar, 604)
rabtStart  = max(1, rabtEnd - (rabtWindow - 1))
RABT       = [rabtStart, rabtEnd]

MURAJAAH range = [1, rabtStart - 1]          -- "everything that is not Rabt"
pool           = rabtStart - 1 = lastTiklar - 30 - E
dailyTarget    = ceil(pool / D)
```

`get_daily_tasks.php:384-412`.

### The graduation rule (the only place `E` grows)

When a Tikrar Ams page reaches 10 repetitions (`update_progress.php:319-332`):

```
if (page > lastTikrar) {
    if (lastTikrar >= 30) E = E + 1;   // past the first 30 -> Rabt window grows
    lastTikrar = page;
}
```

So, memorizing at 1 page/day, **`lastTikrar` and `E` both advance by exactly 1 per day**
once the first 30 pages are full. A consequence used throughout this document:

> While a round is running, `lastTikrar − E` is **constant**, therefore
> `pool = lastTiklar − 30 − E` is **constant during the round**.
> Newly memorized pages sit in Rabt; they do **not** enter Muraja'ah until the round ends.

---

## 2. Days 1 → 6 (the "expansion" days)

During these days, each new page that passes Tikrar Ams:

- increments `lastTikrar` by 1,
- increments `E` by 1 (because `lastTikrar ≥ 30`),

so **Rabt grows from 30 pages to 30 + E pages** (e.g. 30 → 36 over a 6-day round), and the
new pages stay in Rabt.

Muraja'ah runs normally over its current range, one chunk per day, advancing
sequentially (`nextMurajaahChunk`, `get_daily_tasks.php:81-115`).

---

## 3. Day 7 — the cycle close

On the morning the dashboard is opened for the 7th day, `get_daily_tasks.php:295-338`
first decides whether the round is finished, using **three alternative triggers**
(`:316-323`):

```
cycleCompleted = true  if ANY of:
   (a) tasksInRound    >= D          -- 6 completed revision chunks since the last restart
   (b) prevPoolEnd > 0 && lastCompletedEnd >= prevPoolEnd  -- the last chunk reached the end of the pool
   (c) E               >= D          -- 6 new pages have entered Rabt this round
```

where `prevPoolEnd = lastTiklar − (30 + E)` was the pool end **before** any release, and
`tasksInRound` counts completed Muraja'ah tasks back to the last one that started at page 1.

For a user memorizing one page/day with `D = 6`, trigger **(c)** fires: by Day 7 morning
`E = 6`.

### The reset (`:330-338`)

```
if (cycleCompleted && no existing/pending Muraja'ah task for today) {
    E = 0;                       // rabt_extra_pages -> 0
}
```

Then everything downstream is recomputed with `E = 0`:

| Task | Days 1–6 (E = 6) | Day 7 (E reset to 0) |
|---|---|---|
| **Rabt** | `[lastTiklar − 35 … lastTiklar]` → 36 pages | `[lastTiklar − 29 … lastTiklar]` → **exactly 30 pages** |
| **Muraja'ah range** | `[1 … lastTiklar − 36]` | `[1 … lastTiklar − 30]` (pool grew by 6) |
| **Daily target** | pool / 6 | `ceil(pool / 6)` |
| **Chunk start** | sequential (continues forward) | **restarts with page 1** |

The restart is explicit: `$shouldRestart = $cycleCompleted` (`:426-427`), and
`nextMurajaahChunk` then returns `[rangeStart, min(rangeStart + target − 1, rangeEnd)]`
`= [1, target]`.

> **This is the answer to your main question.** On Day 7 the revision does **not** contain
> "only the six pages that left Rabt". It contains **all pages outside Rabt**, and the
> day's slice begins at **page 1**.

---

## 4. Worked example — brand-new user, 1 page/day, 6-day revision

`lastTiklar` reaches page *p* on day *p+1* (the day after memorizing it). The Rabt round
starts the moment page 31 graduates and `E` becomes 1.

| Morning | `lastTiklar` | `E` | Rabt window | Muraja'ah range | Muraja'ah today |
|---|---|---|---|---|---|
| D32 | 31 | 1 | 30+1 → `[1, 31]` | `[1, 0]` → inactive | — |
| D33 | 32 | 2 | `[1, 32]` | inactive | — |
| D34 | 33 | 3 | `[1, 33]` | inactive | — |
| D35 | 34 | 4 | `[1, 34]` | inactive | — |
| D36 | 35 | 5 | `[1, 35]` | inactive | — |
| D37 | 36 | 6 | `[1, 36]` | inactive | — |
| **D38 (Day 7)** | **36** | **0 (reset)** | **`[7, 36]` → 30 pages** | **`[1, 6]`, pool 6** | **`[1, 1]`** (target `ceil(6/6)=1`) |

On D38: Rabt = pages 7–36 (24 older + 6 newest = 30) ✅ (exactly as you described),
and revision restarts at page 1, one page per day, so pages 1–6 are covered across D38–D43.

For a user who already had, say, 100 graduated pages (`lastTiklar = 100`, `E = 0`):
RABT = `[71, 100]`, pool = `[1, 70]`, `dailyTarget = ceil(70/6) = 12`, and Day 7 restarts
at `[1, 12]`. Revision shows **70 pages, not 6** — it is the whole non-Rabt pool.

---

## 5. The bug you saw on Day 7 (why it showed only the six ejected pages)

Before commit `a6df11b`, `nextMurajaahChunk()` started each new chunk from

```
MAX(end_page) over all completed Muraja'ah tasks  + 1
```

and the "restart at page 1" branch was only reached *after* the cursor passed the range
end. So while the pool grew, the next chunk was `[maxEnd+1 … poolEnd]`. If the previous
round had reviewed `[1, 30]` and the pool had grown to `[1, 36]`, the new chunk became

```
[31, 36]   <-- exactly the six pages that had just been ejected from Rabt
```

…which is precisely what you reported. The fix:

- explicit `cycleCompleted` detection (three triggers above), and
- a `shouldRestart` flag so the first chunk of a new round starts at **page 1**
  (`get_daily_tasks.php:81-115, 426-427`),
- the `E → 0` reset now happens in the morning, before the ranges are computed (`:330-338`).

---

## 6. Edge cases worth knowing

- **A pending (unfinished) revision blocks the reset.** The reset only runs when no
  Muraja'ah task for today exists (`$existingMurajaah === null`). If the user did not finish
  revision, the old task rolls forward (`findExistingTask`, `:55-73`) and `E` is **not**
  reset that day — Rabt keeps its expanded window until revision is completed.
  This is the "rollover" rule: the cycle only advances when the user keeps up.
- **Missed days** do not shift the schedule; the earliest pending task is reused, so the
  round simply takes longer in wall-clock time.
- **Spacing of memorization matters, not the calendar.** `E` is incremented **per
  graduated page**, not per calendar day. A user memorizing 2 pages/day reaches `E = 6`
  in 3 days; a user who stops memorizing never increments `E`, and the round instead ends
  via trigger (a) `tasksInRound >= 6` or (b) "last chunk reached the pool end".
- **Breaking the cycle mid-round** with `Undo` on Tikrar Ams decrements `E`
  (`undo_progress.php:226-234`), and changing `current_hifz_page` via the plan modal
  resets `E` to 0 (`update_plan.php:113-116`).
- **`COMPLETE` users** skip all of this: their Muraja'ah range is always `[1, 604]`
  (`get_daily_tasks.php:394-396`), with `prevPoolEnd = 604`.
- **Round-over-round growth.** Because each round releases `D` pages (6) and always
  restarts at page 1, the revision pool increases by exactly 6 pages per completed round
  while the user keeps memorizing. Once memorization stops, the pool freezes at
  `lastTiklar − 30` and the user reviews the *entire* non-Rabt portion once every 6 days.

---

## 7. One-line summary

**Day 7 (with `murajaah_days = 6`): `rabt_extra_pages` resets to 0 → Rabt = the last 30
graduated pages; Muraja'ah = every page before Rabt, restarting at page 1, split into
6 daily chunks of `ceil(pool / 6)` pages.** The "only the 6 ejected pages" behaviour you
observed was the pre-`a6df11b` cursor bug and is no longer what the code does.
