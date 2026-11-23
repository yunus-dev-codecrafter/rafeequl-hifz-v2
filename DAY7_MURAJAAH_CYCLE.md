# Rafeequl Hifz — What happens on Day 7 (revision set to 6 days)

Precise, code-grounded explanation of the Rabt & Muraja'ah cycle dynamics.

**Scope:** a `NEW` or `EXISTING` user who has set **`murajaah_days = 6`** (or `10`) and who memorizes
**one new page per day** (the app's normal rhythm). `COMPLETE` users behave differently
(their review pool is always all 604 pages) and are covered at the end.

Sources (verified against current codebase):
`api/tasks/get_daily_tasks.php`, `api/tasks/update_progress.php`,
`api/tasks/undo_progress.php`, `api/tasks/update_plan.php`.

---

## 0. Short answers

1. **What is supposed to happen on Day 7 (with `murajaah_days = 6`)?** The Rabt cycle closes. `rabt_extra_pages` (`E`)
   is reset to `0`, so **Rabt shrinks back to exactly the base of 10 graduated pages**, and
   **Muraja'ah restarts from page 1**, covering the whole range `[1 … rabtStart − 1]`
   (i.e. *all pages that are not in Rabt*), split into 6 daily chunks.
2. **How does Rabt behave during the round?**
   - **Base:** 10 pages (`rabt_base_pages`).
   - **Max window:** Determined by the user's Muraja'ah cycle length:
     - If `murajaah_days = 6`: expands from **10 to 16 pages** (`10 + 6`).
     - If `murajaah_days = 10`: expands from **10 to 20 pages** (`10 + 10`).
   - On Day 7 (for 6 days) or Day 11 (for 10 days): Rabt resets back to 10 pages. The ejected pages join the Muraja'ah pool.
3. **Why did Day 7 previously show only the 6 pages that left Rabt?**
   That was a cursor bug fixed in commit `a6df11b`. The revision chunk on Day 7 starts at **page 1**, covering the entire older pool.

---

## 1. The four moving pieces of state

Stored on the `users` row (`get_daily_tasks.php`, `update_progress.php`):

| Variable | DB column | Meaning |
|---|---|---|
| `current` | `current_hifz_page` | Highest page the user has memorized (Hifz Jadid). |
| `lastTikrar` | `last_tikrar_page` | Highest page that has **graduated** Tikrar Ams (passed the 4-step consolidation gauntlet). Only graduated pages enter Rabt. |
| `B` | `rabt_base_pages` | Base Rabt capacity (now **10** pages). |
| `E` | `rabt_extra_pages` | How many pages the Rabt window has expanded past its base of 10 **during the current round** (effectively the round's day/page counter). |
| `D` | `murajaah_days` | The user's chosen cycle length (default `6`, or up to `10`). |

### Derived ranges (recomputed every time the dashboard loads)

```
rabtWindow = B + E          -- 10 + E (expands up to 16 or 20)
rabtEnd    = min(lastTikrar, 604)
rabtStart  = max(1, rabtEnd - (rabtWindow - 1))
RABT       = [rabtStart, rabtEnd]

MURAJAAH range = [1, rabtStart - 1]          -- "everything that is not in Rabt"
pool           = rabtStart - 1 = lastTikrar - 10 - E
dailyTarget    = ceil(pool / D)
```

### The graduation rule (where `E` grows)

When a Tikrar Ams page completes its 4-step consolidation gauntlet (`update_progress.php`):

```
if (page > lastTikrar) {
    if (rabtBase < 10) {
        rabtBase = rabtBase + 1; // rebuilding base up to 10
    } else {
        E = E + 1;               // expands Rabt window past base 10
    }
    lastTikrar = page;
}
```

---

## 2. Days 1 → 6 (the "expansion" days)

During these days, each new page that passes Tikrar Ams:
- increments `lastTikrar` by 1,
- increments `E` by 1 (once `lastTikrar ≥ 10`),

so **Rabt grows from 10 pages to 10 + E pages** (e.g. 10 → 16 over a 6-day round, or 10 → 20 over a 10-day round), and the new pages stay in Rabt.

Muraja'ah runs normally over its current range, one chunk per day, advancing sequentially.

---

## 3. Day 7 (or Day 11) — the cycle close

On the morning the dashboard is opened for the new cycle, `get_daily_tasks.php` evaluates cycle completion triggers:

```
cycleCompleted = true  if ANY of:
   (a) tasksInRound    >= D          -- D completed revision chunks since the last restart
   (b) prevPoolEnd > 0 && lastCompletedEnd >= prevPoolEnd  -- the last chunk reached the end of the pool
   (c) E               >= D          -- D new pages have entered Rabt this round (e.g. E >= 6 or E >= 10)
```

### The reset

```
if (cycleCompleted && no existing/pending Muraja'ah task for today) {
    E = 0;                       // rabt_extra_pages -> 0
}
```

Then everything downstream is recomputed with `E = 0`:

| Task | Days 1–6 (E = 6, D = 6) | Day 7 (E reset to 0) |
|---|---|---|
| **Rabt** | `[lastTikrar − 15 … lastTikrar]` → 16 pages | `[lastTikrar − 9 … lastTikrar]` → **exactly 10 pages** |
| **Muraja'ah range** | `[1 … lastTikrar − 16]` | `[1 … lastTikrar − 10]` (pool grew by 6) |
| **Daily target** | pool / 6 | `ceil(pool / 6)` |
| **Chunk start** | sequential (continues forward) | **restarts with page 1** |

---

## 4. Worked example — brand-new user, 1 page/day, 6-day revision

The user completes their initial 10 pages. Starting at page 11:

| Morning | `lastTikrar` | `E` | Rabt window | Muraja'ah range | Muraja'ah today |
|---|---|---|---|---|---|
| D12 | 11 | 1 | 10+1 = 11 → `[1, 11]` | `[1, 0]` → inactive | — |
| D13 | 12 | 2 | 10+2 = 12 → `[1, 12]` | inactive | — |
| D14 | 13 | 3 | 10+3 = 13 → `[1, 13]` | inactive | — |
| D15 | 14 | 4 | 10+4 = 14 → `[1, 14]` | inactive | — |
| D16 | 15 | 5 | 10+5 = 15 → `[1, 15]` | inactive | — |
| D17 | 16 | 6 | 10+6 = 16 → `[1, 16]` | inactive | — |
| **D18 (Day 7)** | **16** | **0 (reset)** | **`[7, 16]` → 10 pages** | **`[1, 6]`, pool 6** | **`[1, 1]`** (target `ceil(6/6)=1`) |

On D18: Rabt = pages 7–16 (4 older + 6 newest = 10 pages), and revision begins at page 1, covering pages 1–6 across D18–D23.

---

## 5. One-line summary

**Day 7 (with `murajaah_days = 6`): `rabt_extra_pages` resets to 0 → Rabt shrinks to the last 10 graduated pages (max was 16); Muraja'ah = every page before Rabt, restarting at page 1, split into 6 daily chunks.**
