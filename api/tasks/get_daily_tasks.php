<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Daily Task Generation Engine
 * Generates / fetches today's active task list for a user.
 * Accepts GET or POST; user_id from session or request.
 */

require __DIR__ . '/../../config/database.php';
require_once __DIR__ . '/_rub.php';
require_once __DIR__ . '/_rollover.php';
require_once __DIR__ . '/_hifz.php';

const TASK_TITLES = [
    'HIFZ_JADID' => ['ar' => 'الحفظ الجديد',     'en' => 'New Memorization'],
    'TIKRAR_AMS' => ['ar' => 'تكرار حفظ الأمس',   'en' => "Yesterday's Repetition"],
    'RABT'       => ['ar' => 'الربط',            'en' => 'Rabt (Linking)'],
    'MURAJAAH'   => ['ar' => 'المراجعة',         'en' => "Muraja'ah (Review)"],
    'RUB_TAMKIN' => ['ar' => 'تثبيت الربع',       'en' => "Rub' Consolidation"],
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

    $stmt = $pdo->prepare($base . ' AND `task_date` = :d ORDER BY `id` ASC LIMIT 1');
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

function insertRubTask(PDO $pdo, int $userId, array $rub, string $date): array
{
    $hasRollover = rh_task_has_rollover($pdo);
    $extraColumns = $hasRollover ? ', `rollover_count`, `last_rollover_date`' : '';
    $extraValues  = $hasRollover ? ', 0, :rollover_date' : '';

    $stmt = $pdo->prepare(
        'INSERT INTO `daily_task_logs`
            (`user_id`, `task_date`, `task_type`, `start_page`, `end_page`, `rub_id`, `is_completed`' . $extraColumns . ')
         VALUES (:u, :d, \'RUB_TAMKIN\', :s, :e, :rub, 0' . $extraValues . ')'
    );
    $params = [
        ':u'   => $userId,
        ':d'   => $date,
        ':s'   => (int) $rub['start_page'],
        ':e'   => (int) $rub['end_page'],
        ':rub' => (int) $rub['id'],
    ];
    if ($hasRollover) {
        $params[':rollover_date'] = $date;
    }
    $stmt->execute($params);

    return [
        'id'                 => (int) $pdo->lastInsertId(),
        'task_date'          => $date,
        'task_type'          => 'RUB_TAMKIN',
        'start_page'         => (int) $rub['start_page'],
        'end_page'           => (int) $rub['end_page'],
        'rub_id'             => (int) $rub['id'],
        'completed_stations' => null,
        'is_completed'       => 0,
        'rollover_count'     => 0,
        'last_rollover_date' => $date,
    ];
}

function formatTask(array $row, string $today): array
{
    $type = (string) $row['task_type'];
    $start = isset($row['start_page']) ? (int) $row['start_page'] : null;
    $end = isset($row['end_page']) ? (int) $row['end_page'] : null;
    $isCompleted = (bool) $row['is_completed'];
    $repetitionCount = isset($row['repetition_count']) ? (int) $row['repetition_count'] : 0;
    $hifzProgress = null;
    if ($type === 'HIFZ_JADID' && $start !== null) {
        $decodedHifz = rh_hifz_decode(isset($row['hifz_progress']) ? (string) $row['hifz_progress'] : null);
        $hifzProgress = rh_hifz_sanitize($decodedHifz, $start);
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
    $rolloverCount = (int) ($row['rollover_count'] ?? 0);
    $carriedOver = $rolloverCount > 0 || ((string) $row['task_date'] !== $today);

    if ($type === 'RUB_TAMKIN') {
        $rubId = isset($row['rub_id']) ? (int) $row['rub_id'] : 0;
        $rub = $rubId > 0 ? rh_rub_by_id($rubId) : null;

        $doneStations = [];
        if (!empty($row['completed_stations'])) {
            $decoded = json_decode((string) $row['completed_stations'], true);
            if (is_array($decoded)) {
                foreach ($decoded as $key) {
                    if (is_string($key) && $key !== '') {
                        $doneStations[] = $key;
                    }
                }
            }
        }

        $segmentsTotal = $rub !== null ? (int) $rub['segments_total'] : 0;
        $doneCount = $segmentsTotal > 0 ? min(count($doneStations), $segmentsTotal) : 0;
        $percent = $segmentsTotal > 0 ? (int) round(($doneCount / $segmentsTotal) * 100) : 0;

        return [
            'id'                 => isset($row['id']) ? (int) $row['id'] : null,
            'task_type'          => $type,
            'title_ar'           => TASK_TITLES[$type]['ar'] ?? 'تثبيت الربع',
            'title_en'           => TASK_TITLES[$type]['en'] ?? "Rub' Consolidation",
            'start_page'         => $start,
            'end_page'           => $end,
            'task_date'          => (string) $row['task_date'],
            'is_completed'       => $isCompleted,
            'completed_pages'    => [],
            'completed_count'    => $isCompleted ? $segmentsTotal : $doneCount,
            'total_pages'        => $segmentsTotal,
            'progress_percent'   => $isCompleted ? 100 : min(100, $percent),
            'carried_over'       => $carriedOver,
            'rollover_count'     => $rolloverCount,
            'last_rollover_date' => $row['last_rollover_date'] ?? null,
            'rub_id'             => $rubId,
            'rub_label_ar'       => $rubId > 0 ? rh_rub_label($rubId) : '',
            'juz'                => $rub['juz'] ?? null,
            'hizb'               => $rub['hizb'] ?? null,
            'start_ref'          => $rub !== null ? $rub['start']['surah'] . ':' . $rub['start']['ayah'] : null,
            'end_ref'            => $rub !== null ? $rub['end']['surah'] . ':' . $rub['end']['ayah'] : null,
            'verse_count'        => $rub['verse_count'] ?? 0,
            'segments_total'     => $segmentsTotal,
            'completed_stations' => $doneStations,
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

// Session is authoritative. A client-supplied user_id is accepted only from an
// administrator (so the admin panel can act on other accounts).
$authUser = rh_require_login($pdo);
$userId   = rh_resolve_user_id($pdo, $authUser, $input['user_id'] ?? null);

try {
    // -----------------------------------------------------------------------
    // Load profile
    // -----------------------------------------------------------------------

    $stmt = $pdo->prepare(
        'SELECT `id`, `name`, `user_type`, `current_hifz_page`, `daily_murajaah_target_pages`,
                COALESCE(`murajaah_days`, 6) AS `murajaah_days`,
                COALESCE(`rabt_extra_pages`, 0) AS `rabt_extra_pages`,
                COALESCE(`last_tikrar_page`, 0) AS `last_tikrar_page`
         FROM `users` WHERE `id` = :id'
    );
    $stmt->execute([':id' => $userId]);
    $user = $stmt->fetch();
    if (!$user) {
        json_out(401, ['success' => false, 'error' => 'Authentication required.']);
    }

    $today       = date('Y-m-d');
    $current     = (int) $user['current_hifz_page'];
    $lastTikrar  = (int) ($user['last_tikrar_page'] ?? 0);
    $utype       = (string) $user['user_type'];
    $murDays     = max(1, min(6, (int) ($user['murajaah_days'] ?? 6)));
    $rabtExtra   = max(0, (int) ($user['rabt_extra_pages'] ?? 0));

    // -----------------------------------------------------------------------
    // Muraja'ah Cycle & Rabt Reset Analysis (Day 7 transition)
    // -----------------------------------------------------------------------
    // Days 1 to $murDays: New pages memorized pass Tikrar Ams and enter Rabt
    // (Rabt expands from 30 to 30 + $rabtExtra pages).
    // On Day ($murDays + 1) [e.g. Day 7]: The cycle is complete!
    // The accumulated extra pages leave Rabt and join Muraja'ah. Rabt resets to 30 pages.
    // A brand new round begins for Muraja'ah starting from Page 1!
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
        $prevRabtWin = 30 + $rabtExtra;
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
    // 1. Release accumulated rabt_extra_pages to Muraja'ah (reset rabt_extra_pages to 0).
    // 2. Rabt returns to 30 pages.
    // 3. Muraja'ah restarts from Page 1!
    $existingMurajaah = findExistingTask($pdo, $userId, 'MURAJAAH', $today);
    if ($cycleCompleted && $existingMurajaah === null) {
        if ($rabtExtra > 0) {
            try {
                $pdo->prepare("UPDATE `users` SET `rabt_extra_pages` = 0 WHERE `id` = :u")
                    ->execute([':u' => $userId]);
            } catch (Throwable $e) {}
            $rabtExtra = 0;
        }
    }

    $rabtWindow  = 30 + $rabtExtra;

    // Rub' consolidation pool frontier: pages that graduated Tikrar Ams.
    // COMPLETE accounts (full Qur'an) use all 240 rub's.
    $rubFrontier = ($utype === 'COMPLETE') ? 604 : $lastTikrar;

    // Active mistakes -> Task 5 (المعالجة), dynamic only (never persisted)
    $stmt = $pdo->prepare("SELECT COUNT(*) FROM `mistakes` WHERE `user_id` = :id AND `status` = 'ACTIVE'");
    $stmt->execute([':id' => $userId]);
    $activeMistakes = (int) $stmt->fetchColumn();

    // -----------------------------------------------------------------------
    // Fresh ranges per business rules (profile-derived)
    // -----------------------------------------------------------------------

    $fresh     = [];   // task_type => [start, end]

    if ($utype === 'EXISTING' || $utype === 'NEW') {
        // Task 1 - Hifz Jadid: next page (always active unless finished)
        if ($current < 604) {
            $fresh['HIFZ_JADID'] = [$current + 1, $current + 1];
        }

        // Task 2 - Tikrar Ams (تكرار حفظ الأمس):
        // When a page is completed in Hifz Jadid, it doesn't immediately join Rabt.
        // It has to go through Tikrar Ams first (recited 10 times).
        // The last page memorized today will appear here tomorrow.
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

        // Task 3 - Rabt:
        // Rabt will NOT count any page until it has gone through Tikrar Ams!
        // Therefore Rabt's frontier is $lastTikrar.
        $rabtEnd = min($lastTikrar, 604);
        $rabtActive = ($utype === 'EXISTING' && $rabtEnd >= 1) || ($utype === 'NEW' && $rabtEnd >= 1);
        if ($rabtActive && $rabtEnd >= 1) {
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
        $effectiveRabtStart = isset($fresh['RABT']) ? $fresh['RABT'][0] : (max(1, $lastTikrar - ($rabtWindow - 1)));
        $murActive = ($utype === 'EXISTING') || ($lastTikrar > 30);
        if ($murActive && $effectiveRabtStart > 1) {
            $fresh['MURAJAAH'] = [1, $effectiveRabtStart - 1];
            $murajaahTotalPages = $effectiveRabtStart - 1;
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

        $tasks[] = formatTask($row, $today);
    }

    // Task 4b - Rub' consolidation (RUB_TAMKIN): one random rub' per day.
    // Rollover behaves like the other tasks: an unfinished rub' keeps coming
    // back until every station has been recited 3 times.
    $rubEligible = ($utype === 'COMPLETE') || ($rubFrontier >= 1);
    if ($rubEligible) {
        $rubRow = findExistingTask($pdo, $userId, 'RUB_TAMKIN', $today);
        if ($rubRow === null) {
            $pickedRub = rh_pick_rub($pdo, $userId, $utype === 'COMPLETE' ? 604 : $rubFrontier, $utype, $today);
            if ($pickedRub !== null) {
                $rubRow = insertRubTask($pdo, $userId, $pickedRub, $today);
            }
        }
        if ($rubRow !== null) {
            $tasks[] = formatTask($rubRow, $today);
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
            'rabt_extra_pages'            => $rabtExtra,
            'rabt_window_size'            => $rabtWindow,
            'murajaah_total_pages'        => $murajaahTotalPages,
        ],
        'tasks'   => $tasks,
    ]);
} catch (PDOException $e) {
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    error_log('[DailyTasks Failed] ' . $e->getMessage());
    json_out(500, ['success' => false, 'error' => 'Server error. Please try again.']);
}
