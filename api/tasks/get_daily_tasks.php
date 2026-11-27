<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Daily Task Generation Engine
 * Generates / fetches today's active task list for a user.
 * Accepts GET or POST; user_id from session or request.
 */

require __DIR__ . '/../../config/database.php';
require_once __DIR__ . '/_page.php';
require_once __DIR__ . '/_rollover.php';
require_once __DIR__ . '/_hifz.php';
require_once __DIR__ . '/_tafreet.php';

const TASK_TITLES = [
    'HIFZ_JADID' => ['ar' => 'الحفظ الجديد',     'en' => 'New Memorization'],
    'TIKRAR_AMS' => ['ar' => 'تكرار حفظ الأمس',   'en' => "Yesterday's Repetition"],
    'RABT'       => ['ar' => 'الربط',            'en' => 'Rabt (Linking)'],
    'MURAJAAH'   => ['ar' => 'المراجعة',         'en' => "Muraja'ah (Review)"],
    'PAGE_TAMKIN' => ['ar' => 'تثبيت الصفحة',     'en' => 'Page Consolidation'],
    'MISTAKES'   => ['ar' => 'المعالجة',         'en' => 'Remediation'],
];

function json_out(int $code, array $payload): void
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

// Schema changes are handled once by config/migrate_v8.php (and setup.php).
// Keeping DDL out of the request path prevents metadata-lock storms and 502s.
// The SELECT helper tolerates a pre-v7 database and reports zero rollovers.

/**
 * Find an existing log row for today's task:
 * 1) today's own row, 2) earliest pending row (rollover), else null.
 */
function findExistingTask(PDO $pdo, int $userId, string $type, string $today): ?array
{
    $select = rh_task_log_select($pdo);
    $base = 'SELECT ' . $select . '
             FROM `daily_task_logs`
             WHERE `user_id` = :u AND `task_type` = :t';

    // Prioritize active (uncompleted) task for today, then latest task for today.
    $stmt = $pdo->prepare($base . ' AND `task_date` = :d ORDER BY `is_completed` ASC, `id` DESC LIMIT 1');
    $stmt->execute([':u' => $userId, ':t' => $type, ':d' => $today]);
    $row = $stmt->fetch();
    if ($row) {
        return rh_apply_rollover($pdo, $row, $today);
    }

    // Rollover rule: reuse the earliest uncompleted range instead of advancing.
    // rh_apply_rollover() records each calendar day it has stayed unfinished.
    $stmt = $pdo->prepare($base . ' AND `task_date` <= :d AND `is_completed` = 0 ORDER BY `task_date` ASC, `id` ASC LIMIT 1');
    $stmt->execute([':u' => $userId, ':t' => $type, ':d' => $today]);
    $row = $stmt->fetch();
    return $row ? rh_apply_rollover($pdo, $row, $today) : null;
}

/**
 * Next sequential muraja'ah chunk inside [rangeStart, rangeEnd].
 * If $shouldRestart is true, restarts at rangeStart.
 * Otherwise, advances from the latest completed chunk or $nextStartOverride.
 * After the cycle finishes, rolls accumulated extra pages into murajaah and resets rabt_extra_pages to 0.
 */
function nextMurajaahChunk(PDO $pdo, int $userId, int $rangeStart, int $rangeEnd, int $target, bool $shouldRestart = false, ?int $nextStartOverride = null): ?array
{
    if ($rangeEnd < $rangeStart) {
        return null;
    }

    if ($shouldRestart) {
        $next = $rangeStart;
    } elseif ($nextStartOverride !== null) {
        $next = $nextStartOverride;
        if ($next > $rangeEnd) {
            $next = $rangeStart;
        }
    } else {
        $stmt = $pdo->prepare(
            "SELECT `end_page` FROM `daily_task_logs`
             WHERE `user_id` = :u AND `task_type` = 'MURAJAAH' AND `is_completed` = 1
             ORDER BY `task_date` DESC, `id` DESC
             LIMIT 1"
        );
        $stmt->execute([':u' => $userId]);
        $lastEnd = $stmt->fetchColumn();

        if ($lastEnd === false || $lastEnd === null || (int) $lastEnd < $rangeStart) {
            $next = $rangeStart;
        } else {
            $next = (int) $lastEnd + 1;
            if ($next > $rangeEnd) {
                $next = $rangeStart; // cycle complete -> restart!
            }
        }
    }

    return [$next, min($next + $target - 1, $rangeEnd)];
}

function insertTask(PDO $pdo, int $userId, string $type, array $bounds, string $date, int $reps = 0): array
{
    $hasRollover = rh_task_has_rollover($pdo);
    $extraColumns = $hasRollover ? ', `rollover_count`, `last_rollover_date`' : '';
    $extraValues  = $hasRollover ? ', 0, :rollover_date' : '';

    $stmt = $pdo->prepare(
        'INSERT INTO `daily_task_logs`
            (`user_id`, `task_date`, `task_type`, `start_page`, `end_page`, `repetition_count`, `is_completed`' . $extraColumns . ')
         VALUES (:u, :d, :t, :s, :e, :r, 0' . $extraValues . ')'
    );
    $params = [
        ':u' => $userId,
        ':d' => $date,
        ':t' => $type,
        ':s' => $bounds[0],
        ':e' => $bounds[1],
        ':r' => $reps,
    ];
    if ($hasRollover) {
        $params[':rollover_date'] = $date;
    }
    $stmt->execute($params);

    return [
        'id'                 => (int) $pdo->lastInsertId(),
        'task_date'          => $date,
        'task_type'          => $type,
        'start_page'         => $bounds[0],
        'end_page'           => $bounds[1],
        'repetition_count'   => $reps,
        'hifz_progress'      => null,
        'is_completed'       => 0,
        'rollover_count'     => 0,
        'last_rollover_date' => $date,
    ];
}

function formatTask(array $row, string $today, ?PDO $pdo = null, int $userId = 0): array
{
    $type = (string) $row['task_type'];
    $start = isset($row['start_page']) ? (int) $row['start_page'] : null;
    $end = isset($row['end_page']) ? (int) $row['end_page'] : null;
    $isCompleted = (bool) $row['is_completed'];
    $repetitionCount = isset($row['repetition_count']) ? (int) $row['repetition_count'] : 0;
    $hifzProgress = null;
    if ($type === 'HIFZ_JADID' && $start !== null) {
        $decodedHifz = rh_hifz_decode(isset($row['hifz_progress']) ? (string) $row['hifz_progress'] : null);
        // Legacy completed pages (40x flow) are converted for read-only display.
        $hifzProgress = rh_hifz_sanitize($decodedHifz, $start, true);
    }

    $completedPages = [];
    if (!empty($row['completed_pages'])) {
        $decoded = json_decode((string) $row['completed_pages'], true);
        if (is_array($decoded)) {
            $completedPages = array_values(array_map('intval', $decoded));
        }
    } elseif ($isCompleted && $start !== null && $end !== null) {
        if ($start === $end) {
            $completedPages = [$start];
        } else {
            $completedPages = range($start, $end);
        }
    }

    $totalPages = ($start !== null && $end !== null && $end >= $start) ? ($end - $start + 1) : 0;
    $completedCount = count($completedPages);
    $rolloverCount = 0;
    $carriedOver = false;

    if ($type === 'PAGE_TAMKIN') {
        $payload = ($pdo !== null) ? rh_pg_task_payload($pdo, $row, true) : [];
        $wordCount = (int) ($payload['word_count'] ?? 0);
        $wordsDone = (int) ($payload['words_done'] ?? 0);
        $percent = $wordCount > 0 ? (int) round(($wordsDone / $wordCount) * 100) : 0;

        return [
            'id'                 => isset($row['id']) ? (int) $row['id'] : null,
            'task_type'          => $type,
            'title_ar'           => TASK_TITLES[$type]['ar'] ?? 'تثبيت الصفحة',
            'title_en'           => TASK_TITLES[$type]['en'] ?? 'Page Consolidation',
            'start_page'         => $start,
            'end_page'           => $end,
            'task_date'          => (string) $row['task_date'],
            'is_completed'       => false,
            'is_continuous'      => true,
            'completed_pages'    => $isCompleted && $start !== null ? [$start] : [],
            'completed_count'    => $isCompleted ? 1 : 0,
            'total_pages'        => 1,
            'progress_percent'   => min(100, $percent),
            'carried_over'       => false,
            'rollover_count'     => 0,
            'last_rollover_date' => null,
            'page_number'        => $start,
            'source'             => $payload['source'] ?? 'AUTO',
            'result'             => $payload['result'] ?? '',
            'words_done'         => $wordsDone,
            'word_count'         => $wordCount,
            'start_ref'          => $payload['start_ref'] ?? null,
            'end_ref'            => $payload['end_ref'] ?? null,
        ];
    }

    if ($type === 'TIKRAR_AMS') {
        $targetReps = 10;
        $currentReps = $isCompleted ? 10 : min(10, $repetitionCount);
        $percent = (int) round(($currentReps / $targetReps) * 100);
        return [
            'id'                  => isset($row['id']) ? (int) $row['id'] : null,
            'task_type'           => $type,
            'title_ar'            => TASK_TITLES[$type]['ar'] ?? 'تكرار حفظ الأمس',
            'title_en'            => TASK_TITLES[$type]['en'] ?? "Yesterday's Repetition",
            'start_page'          => $start,
            'end_page'            => $end,
            'task_date'           => (string) $row['task_date'],
            'is_completed'        => $isCompleted,
            'completed_pages'     => $isCompleted && $start !== null ? [$start] : [],
            'completed_count'     => $isCompleted ? 1 : 0,
            'total_pages'         => 1,
            'repetition_count'    => $currentReps,
            'target_repetitions'  => $targetReps,
            'progress_percent'    => min(100, $percent),
            'carried_over'        => $carriedOver,
            'rollover_count'      => $rolloverCount,
            'last_rollover_date'  => $row['last_rollover_date'] ?? null,
        ];
    }

    $percent = $totalPages > 0 ? (int) round(($completedCount / $totalPages) * 100) : ($isCompleted ? 100 : 0);

    return [
        'id'               => isset($row['id']) ? (int) $row['id'] : null,
        'task_type'        => $type,
        'title_ar'         => TASK_TITLES[$type]['ar'] ?? $type,
        'title_en'         => TASK_TITLES[$type]['en'] ?? $type,
        'start_page'       => $start,
        'end_page'         => $end,
        'task_date'        => (string) $row['task_date'],
        'is_completed'     => $isCompleted,
        'completed_pages'  => $completedPages,
        'completed_count'  => $completedCount,
        'total_pages'      => $totalPages,
        'progress_percent' => min(100, $percent),
        'carried_over'     => $carriedOver,
        'rollover_count'   => $rolloverCount,
        'last_rollover_date' => $row['last_rollover_date'] ?? null,
        'hifz_progress'     => $hifzProgress,
        'hifz_target_reps'  => RH_HIFZ_TARGET_REPS,
        'hifz_pair_target_reps' => RH_HIFZ_PAIR_REPS,
    ];
}

// ---------------------------------------------------------------------------
// Method & input
// ---------------------------------------------------------------------------

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if (!in_array($method, ['GET', 'POST'], true)) {
    json_out(400, ['success' => false, 'error' => 'Method not allowed. Use GET or POST.']);
}

$input = $_GET;
if ($method === 'POST') {
    $raw = file_get_contents('php://input');
    if (is_string($raw) && $raw !== '') {
        $json = json_decode($raw, true);
        if (!is_array($json)) {
            json_out(400, ['success' => false, 'error' => 'Invalid JSON payload.']);
        }
        $input = array_merge($input, $json);
    } elseif (!empty($_POST)) {
        $input = array_merge($input, $_POST);
    }
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

require_once __DIR__ . '/../../config/auth.php';

if (!function_exists('rh_today')) {
    function rh_today(?int $timestamp = null): string
    {
        $ts = $timestamp ?? time();
        $offset = (int) (defined('RH_DAY_CUTOFF_HOUR') ? RH_DAY_CUTOFF_HOUR : 6) * 3600;
        return date('Y-m-d', $ts - $offset);
    }
}

// Session is authoritative. A client-supplied user_id is accepted only from an
// administrator (so the admin panel can act on other accounts).
$authUser = rh_require_login($pdo);
$userId   = rh_resolve_user_id($pdo, $authUser, $input['user_id'] ?? null);

try {
    // -----------------------------------------------------------------------
    // Penalty (يوم تفريط) Audit & Account Deletion Check
    // -----------------------------------------------------------------------
    $today = rh_today();
    $tafreetAudit = rh_evaluate_tafreet($pdo, $userId, $today);
    if ($tafreetAudit['deleted']) {
        if (session_status() === PHP_SESSION_ACTIVE) {
            session_destroy();
        }
        json_out(403, [
            'success' => false,
            'code'    => 'ACCOUNT_DELETED_TAFREET',
            'error'   => 'تم حذف حسابك نهائياً لتجاوزك الحد المسموح به لأيام التفريط (٢٥ يوماً).',
        ]);
    }

    $isAbsenceDay = rh_is_absence_day($pdo, $userId, $today);
    $absenceInfo  = rh_get_user_absences($pdo, $userId);

    // -----------------------------------------------------------------------
    // Load profile
    // -----------------------------------------------------------------------

    $stmt = $pdo->prepare(
        'SELECT `id`, `name`, `user_type`, `current_hifz_page`, `daily_murajaah_target_pages`,
                COALESCE(`murajaah_days`, 6) AS `murajaah_days`,
                COALESCE(`rabt_extra_pages`, 0) AS `rabt_extra_pages`,
                COALESCE(`rabt_base_pages`, 10) AS `rabt_base_pages`,
                COALESCE(`last_tikrar_page`, 0) AS `last_tikrar_page`,
                COALESCE(`tafreet_count`, 0) AS `tafreet_count`
         FROM `users` WHERE `id` = :id'
    );
    $stmt->execute([':id' => $userId]);
    $user = $stmt->fetch();
    if (!$user) {
        json_out(401, ['success' => false, 'error' => 'Authentication required.']);
    }

    $current     = (int) $user['current_hifz_page'];
    $lastTikrar  = (int) ($user['last_tikrar_page'] ?? 0);
    $utype       = (string) $user['user_type'];
    $murDays     = max(1, min(10, (int) ($user['murajaah_days'] ?? 6)));
    $rabtExtra   = max(0, (int) ($user['rabt_extra_pages'] ?? 0));
    $rabtBase    = max(0, min(10, (int) ($user['rabt_base_pages'] ?? 10)));
    $tafreetCnt  = (int) ($user['tafreet_count'] ?? 0);

    // -----------------------------------------------------------------------
    // Muraja'ah Cycle & Rabt Reset Analysis (Day 7 / Day 11 transition)
    // -----------------------------------------------------------------------
    // Days 1 to $murDays: New pages memorized pass Tikrar Ams and enter Rabt
    // (Rabt expands from rabtBase [10] to rabtBase + $rabtExtra pages: max 16 for 6-day cycle, max 20 for 10-day cycle).
    // On Day ($murDays + 1) [e.g. Day 7 or Day 11]: The cycle is complete!
    // 1. If extra pages accumulated ($rabtExtra > 0): they graduate to Muraja'ah and $rabtExtra resets to 0.
    // 2. If new memorization was paused ($rabtExtra == 0): Rabt reduces by $murDays pages down to 0.
    // 3. Muraja'ah restarts from Page 1!
    // -----------------------------------------------------------------------
    $mStmt = $pdo->prepare(
        "SELECT `id`, `start_page`, `end_page`, `task_date`
         FROM `daily_task_logs`
         WHERE `user_id` = :u AND `task_type` = 'MURAJAAH' AND `is_completed` = 1
         ORDER BY `task_date` DESC, `id` DESC
         LIMIT 50"
    );
    $mStmt->execute([':u' => $userId]);
    $completedMurTasks = $mStmt->fetchAll();

    $tasksInRound = 0;
    $lastCompletedEnd = 0;
    if (!empty($completedMurTasks)) {
        $lastCompletedEnd = (int) $completedMurTasks[0]['end_page'];
        foreach ($completedMurTasks as $mt) {
            $tasksInRound++;
            if ((int) $mt['start_page'] === 1) {
                break;
            }
        }
    }

    // Previous pool end before any Rabt release
    $prevPoolEnd = 0;
    if ($utype === 'COMPLETE') {
        $prevPoolEnd = 604;
    } else {
        $prevRabtWin = $rabtBase + $rabtExtra;
        $prevPoolEnd = max(0, $lastTikrar - $prevRabtWin);
    }

    $cycleCompleted = false;
    if ($tasksInRound >= $murDays) {
        $cycleCompleted = true;
    } elseif ($prevPoolEnd > 0 && $lastCompletedEnd >= $prevPoolEnd) {
        $cycleCompleted = true;
    } elseif ($rabtExtra >= $murDays) {
        $cycleCompleted = true;
    }

    // If cycle completed and today's MURAJAAH task doesn't already exist:
    $existingMurajaah = findExistingTask($pdo, $userId, 'MURAJAAH', $today);
    if ($cycleCompleted && $existingMurajaah === null) {
        if ($rabtExtra > 0) {
            // Extra pages graduate to Muraja'ah!
            try {
                $pdo->prepare("UPDATE `users` SET `rabt_extra_pages` = 0 WHERE `id` = :u")
                    ->execute([':u' => $userId]);
            } catch (Throwable $e) {}
            $rabtExtra = 0;
        } else {
            // New memorization was paused/absent: Rabt shrinks by standard daily portion equivalent
            $newRabtBase = max(0, $rabtBase - $murDays);
            try {
                $pdo->prepare("UPDATE `users` SET `rabt_base_pages` = :base WHERE `id` = :u")
                    ->execute([':base' => $newRabtBase, ':u' => $userId]);
            } catch (Throwable $e) {}
            $rabtBase = $newRabtBase;
        }
    }

    $rabtWindow = $rabtBase + $rabtExtra;

    // Cycle day progression & projected completion date
    $currentCycleDay = $cycleCompleted ? 1 : min($murDays, $tasksInRound + 1);
    $daysRemaining   = max(0, $murDays - $currentCycleDay);
    $projectedEndDate = date('Y-m-d', strtotime('+' . $daysRemaining . ' days', strtotime($today)));

    // Active mistakes -> Task 5 (المعالجة), dynamic only (never persisted)
    $stmt = $pdo->prepare("SELECT COUNT(*) FROM `mistakes` WHERE `user_id` = :id AND `status` = 'ACTIVE'");
    $stmt->execute([':id' => $userId]);
    $activeMistakes = (int) $stmt->fetchColumn();

    // -----------------------------------------------------------------------
    // Fresh ranges per business rules (profile-derived)
    // -----------------------------------------------------------------------

    $fresh     = [];   // task_type => [start, end]

    if ($utype === 'EXISTING' || $utype === 'NEW') {
        // When in planned absence, new memorization & yesterday's repetition are paused
        if (!$isAbsenceDay) {
            // Task 1 - Hifz Jadid: next page (always active unless finished)
            if ($current < 604) {
                $fresh['HIFZ_JADID'] = [$current + 1, $current + 1];
            }

            // Task 2 - Tikrar Ams (تكرار حفظ الأمس):
            $existingTikrar = findExistingTask($pdo, $userId, 'TIKRAR_AMS', $today);
            if ($existingTikrar !== null) {
                $fresh['TIKRAR_AMS'] = [(int) $existingTikrar['start_page'], (int) $existingTikrar['end_page']];
            } elseif ($lastTikrar < $current) {
                $nextTikrarPage = $lastTikrar + 1;
                // Check if $nextTikrarPage was memorized TODAY in HIFZ_JADID
                $hstmt = $pdo->prepare(
                    "SELECT COUNT(*) FROM `daily_task_logs`
                     WHERE `user_id` = :u AND `task_type` = 'HIFZ_JADID' AND `start_page` = :p AND `task_date` = :d AND `is_completed` = 1"
                );
                $hstmt->execute([':u' => $userId, ':p' => $nextTikrarPage, ':d' => $today]);
                $memorizedToday = ((int) $hstmt->fetchColumn()) > 0;

                if (!$memorizedToday) {
                    $fresh['TIKRAR_AMS'] = [$nextTikrarPage, $nextTikrarPage];
                }
            }
        }

        // Task 3 - Rabt:
        // Active as long as rabtWindow > 0 and lastTikrar >= 1
        $rabtEnd = min($lastTikrar, 604);
        if ($rabtWindow > 0 && $rabtEnd >= 1) {
            $rabtStart = max(1, $rabtEnd - ($rabtWindow - 1));
            $fresh['RABT'] = [$rabtStart, $rabtEnd];
        }
    }

    // Task 4 - Muraja'ah range (chunks resolved against logs below)
    $murajaahTotalPages = 0;
    if ($utype === 'COMPLETE') {
        $fresh['MURAJAAH'] = [1, 604];
        $murajaahTotalPages = 604;
    } elseif ($utype === 'EXISTING' || $utype === 'NEW') {
        if ($rabtWindow > 0 && isset($fresh['RABT'])) {
            $effectiveRabtStart = $fresh['RABT'][0];
            if ($effectiveRabtStart > 1) {
                $fresh['MURAJAAH'] = [1, $effectiveRabtStart - 1];
                $murajaahTotalPages = $effectiveRabtStart - 1;
            }
        } elseif ($lastTikrar >= 1) {
            // When Rabt has completely reduced to 0 during pause, all memorized pages join Muraja'ah
            $fresh['MURAJAAH'] = [1, $lastTikrar];
            $murajaahTotalPages = $lastTikrar;
        }
    }

    // Calculate daily muraja'ah target based on user's target days (max 6 days)
    if ($murajaahTotalPages > 0) {
        $calculatedTarget = (int) ceil($murajaahTotalPages / $murDays);
        $target = max(1, $calculatedTarget);
    } else {
        $target = max(1, (int) $user['daily_murajaah_target_pages']);
    }

    // -----------------------------------------------------------------------
    // Reconcile with daily_task_logs (generates AND fetches)
    // -----------------------------------------------------------------------

    $pdo->beginTransaction();
    $tasks = [];

    // Strict Day-Lock Check:
    // If any core task from a previous calendar day is still uncompleted,
    // the day remains locked to that past day. The student must complete it
    // before any new day's tasks can be generated.
    $lockStmt = $pdo->prepare(
        "SELECT `task_date` FROM `daily_task_logs`
         WHERE `user_id` = :u
           AND `task_date` < :today
           AND `task_type` IN ('HIFZ_JADID', 'TIKRAR_AMS', 'RABT', 'MURAJAAH')
           AND `is_completed` = 0
         ORDER BY `task_date` ASC, `id` ASC
         LIMIT 1"
    );
    $lockStmt->execute([':u' => $userId, ':today' => $today]);
    $lockedDate = $lockStmt->fetchColumn();

    $dayLocked = false;
    $activeDate = $today;

    if ($lockedDate !== false && $lockedDate !== null) {
        $dayLocked = true;
        $activeDate = (string) $lockedDate;
    } else {
        // Also check: did the user complete an unfinished previous day's task TODAY?
        // If so, their catch-up was completed today, so they see that completed day
        // until the next 6:00 AM cutoff.
        $catchUpStmt = $pdo->prepare(
            "SELECT `task_date` FROM `daily_task_logs`
             WHERE `user_id` = :u
               AND `task_date` < :today
               AND `task_type` IN ('HIFZ_JADID', 'TIKRAR_AMS', 'RABT', 'MURAJAAH')
               AND `last_rollover_date` = :today2
             ORDER BY `task_date` DESC, `id` DESC
             LIMIT 1"
        );
        $catchUpStmt->execute([':u' => $userId, ':today' => $today, ':today2' => $today]);
        $catchUpDate = $catchUpStmt->fetchColumn();

        if ($catchUpDate !== false && $catchUpDate !== null) {
            $todayTaskStmt = $pdo->prepare(
                "SELECT COUNT(*) FROM `daily_task_logs`
                 WHERE `user_id` = :u AND `task_date` = :today
                   AND `task_type` IN ('HIFZ_JADID', 'TIKRAR_AMS', 'RABT', 'MURAJAAH')"
            );
            $todayTaskStmt->execute([':u' => $userId, ':today' => $today]);
            $hasTodayTasks = ((int) $todayTaskStmt->fetchColumn()) > 0;
            if (!$hasTodayTasks) {
                $dayLocked = true;
                $activeDate = (string) $catchUpDate;
            }
        }
    }

    if ($dayLocked) {
        // DAY LOCK ACTIVE:
        // Do NOT generate new tasks for today.
        // Return the tasks from the locked day so the user finishes them first.
        $stmt = $pdo->prepare(
            "SELECT " . rh_task_log_select($pdo) . "
             FROM `daily_task_logs`
             WHERE `user_id` = :u
               AND `task_date` = :d
               AND `task_type` IN ('HIFZ_JADID', 'TIKRAR_AMS', 'RABT', 'MURAJAAH')
             ORDER BY FIELD(`task_type`, 'HIFZ_JADID', 'TIKRAR_AMS', 'RABT', 'MURAJAAH'), `id` ASC"
        );
        $stmt->execute([':u' => $userId, ':d' => $activeDate]);
        $lockedRows = $stmt->fetchAll();

        $latestByType = [];
        foreach ($lockedRows as $r) {
            $latestByType[$r['task_type']] = $r;
        }

        foreach ($latestByType as $r) {
            $tasks[] = formatTask($r, $activeDate, $pdo, $userId);
        }

        $pageRow = rh_pg_ensure_task($pdo, $userId, $activeDate);
        if ($pageRow !== null) {
            $tasks[] = formatTask($pageRow, $activeDate, $pdo, $userId);
        }

        $today = $activeDate;
    } else {
        foreach ($fresh as $type => $bounds) {
            $row = findExistingTask($pdo, $userId, $type, $today);

            if ($row === null) {
                if ($type === 'MURAJAAH') {
                    $nextStartOverride = ($lastCompletedEnd > 0 && !$cycleCompleted) ? ($lastCompletedEnd + 1) : null;
                    $chunk = nextMurajaahChunk($pdo, $userId, $bounds[0], $bounds[1], $target, $cycleCompleted, $nextStartOverride);
                    if ($chunk === null) {
                        continue; // empty range -> task inactive
                    }
                    $bounds = $chunk;
                }
                $row = insertTask($pdo, $userId, $type, $bounds, $today);
            }

            $tasks[] = formatTask($row, $today, $pdo, $userId);
        }

        // Task 4b - Page-by-page consolidation (PAGE_TAMKIN).
        // There is deliberately no rollover: an unfinished page keeps its pending
        // state in consolidation_pages and gets a fresh daily task row tomorrow.
        $pageRow = rh_pg_ensure_task($pdo, $userId, $today);
        if ($pageRow !== null) {
            $tasks[] = formatTask($pageRow, $today, $pdo, $userId);
        }
    }

    $pdo->commit();

    // Mistake history badges for the Muraja'ah range (ACTIVE + ARCHIVED)
    foreach ($tasks as $i => $task) {
        if ($task['task_type'] !== 'MURAJAAH' || $task['start_page'] === null) {
            continue;
        }
        $stmt = $pdo->prepare(
            "SELECT `page_number`, COUNT(*) AS `cnt`
             FROM `mistakes`
             WHERE `user_id` = :u
               AND `status` IN ('ACTIVE', 'ARCHIVED')
               AND `page_number` BETWEEN :s AND :e
             GROUP BY `page_number`"
        );
        $stmt->execute([
            ':u' => $userId,
            ':s' => $task['start_page'],
            ':e' => $task['end_page'],
        ]);
        $badges = [];
        foreach ($stmt->fetchAll() as $badge) {
            $badges[(string) (int) $badge['page_number']] = (int) $badge['cnt'];
        }
        $tasks[$i]['has_previous_mistakes'] = count($badges) > 0;
        $tasks[$i]['mistake_badges']        = $badges;
        break;
    }

    // Task 4 - active mistakes only, response-only (not persisted)
    if ($activeMistakes > 0) {
        $tasks[] = [
            'id'             => null,
            'task_type'      => 'MISTAKES',
            'title_ar'       => TASK_TITLES['MISTAKES']['ar'],
            'title_en'       => TASK_TITLES['MISTAKES']['en'],
            'start_page'     => null,
            'end_page'       => null,
            'task_date'      => $today,
            'is_completed'   => false,
            'carried_over'   => false,
            'rollover_count' => 0,
            'last_rollover_date' => null,
            'active_mistakes' => $activeMistakes,
        ];
    }

    json_out(200, [
        'success' => true,
        'date'    => $today,
        'cycle'   => [
            'current_day'        => $currentCycleDay,
            'total_days'         => $murDays,
            'projected_end_date' => $projectedEndDate,
        ],
        'tafreet' => [
            'count'         => $tafreetAudit['tafreet_count'],
            'max'           => 25,
            'warning_level' => $tafreetAudit['warning_level'],
            'new_penalties' => $tafreetAudit['new_penalties'],
        ],
        'absence' => [
            'is_absence_today' => $isAbsenceDay,
            'remaining_quota'  => $absenceInfo['remaining'],
            'total_planned'    => $absenceInfo['total'],
            'max'              => $absenceInfo['max'],
        ],
        'user'    => [
            'id'                          => (int) $user['id'],
            'name'                        => (string) ($authUser['name'] ?? $user['name'] ?? ''),
            'email'                       => (string) ($authUser['email'] ?? ''),
            'user_type'                   => $user['user_type'],
            'role'                        => (string) ($authUser['role'] ?? 'USER'),
            'status'                      => (string) ($authUser['status'] ?? 'ACTIVE'),
            'must_change_password'        => (int) ($authUser['must_change_password'] ?? 0) === 1,
            'current_hifz_page'           => $current,
            'last_tikrar_page'            => $lastTikrar,
            'daily_murajaah_target_pages' => $target,
            'murajaah_days'               => $murDays,
            'rabt_base_pages'             => $rabtBase,
            'rabt_extra_pages'            => $rabtExtra,
            'rabt_window_size'            => $rabtWindow,
            'murajaah_total_pages'        => $murajaahTotalPages,
            'tafreet_count'               => $tafreetAudit['tafreet_count'],
        ],
        'tasks'   => $tasks,
    ]);
} catch (PDOException $e) {
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    error_log('[DailyTasks Failed] ' . $e->getMessage());
    json_out(500, ['success' => false, 'error' => 'Server error. Please try again.', 'exception' => $e->getMessage()]);
}
