<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Daily Task Generation Engine
 * Generates / fetches today's active task list for a user.
 * Accepts GET or POST; user_id from session or request.
 */

require __DIR__ . '/../../config/database.php';

const TASK_TITLES = [
    'HIFZ_JADID' => ['ar' => 'الحفظ الجديد',     'en' => 'New Memorization'],
    'TIKRAR_AMS' => ['ar' => 'تكرار حفظ الأمس',   'en' => "Yesterday's Repetition"],
    'RABT'       => ['ar' => 'الربط',            'en' => 'Rabt (Linking)'],
    'MURAJAAH'   => ['ar' => 'المراجعة',         'en' => "Muraja'ah (Review)"],
    'MISTAKES'   => ['ar' => 'المعالجة',         'en' => 'Remediation'],
];

function json_out(int $code, array $payload): void
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

// Ensure completed_pages, repetition_count, and revision plan columns exist
try {
    $pdo->exec("ALTER TABLE `daily_task_logs` ADD COLUMN `completed_pages` TEXT NULL");
} catch (Throwable $t) {}
try {
    $pdo->exec("ALTER TABLE `daily_task_logs` MODIFY COLUMN `task_type` ENUM('HIFZ_JADID', 'TIKRAR_AMS', 'RABT', 'MURAJAAH') NOT NULL");
} catch (Throwable $t) {}
try {
    $pdo->exec("ALTER TABLE `daily_task_logs` ADD COLUMN `repetition_count` INT NOT NULL DEFAULT 0");
} catch (Throwable $t) {}
try {
    $pdo->exec("ALTER TABLE `users` ADD COLUMN `murajaah_days` INT NOT NULL DEFAULT 6");
} catch (Throwable $t) {}
try {
    $pdo->exec("ALTER TABLE `users` ADD COLUMN `rabt_extra_pages` INT NOT NULL DEFAULT 0");
} catch (Throwable $t) {}
try {
    $pdo->exec("ALTER TABLE `users` ADD COLUMN `last_tikrar_page` INT NOT NULL DEFAULT 0");
} catch (Throwable $t) {}
try {
    $pdo->exec("UPDATE `users` SET `last_tikrar_page` = `current_hifz_page` WHERE `last_tikrar_page` = 0 AND `current_hifz_page` > 0");
} catch (Throwable $t) {}

/**
 * Find an existing log row for today's task:
 * 1) today's own row, 2) earliest pending row (rollover), else null.
 */
function findExistingTask(PDO $pdo, int $userId, string $type, string $today): ?array
{
    $base = 'SELECT `id`, `task_date`, `task_type`, `start_page`, `end_page`, `is_completed`, `completed_pages`, COALESCE(`repetition_count`, 0) AS `repetition_count`
             FROM `daily_task_logs`
             WHERE `user_id` = :u AND `task_type` = :t';

    $stmt = $pdo->prepare($base . ' AND `task_date` = :d ORDER BY `id` ASC LIMIT 1');
    $stmt->execute([':u' => $userId, ':t' => $type, ':d' => $today]);
    $row = $stmt->fetch();
    if ($row) {
        return $row;
    }

    // Rollover rule: reuse the earliest uncompleted range instead of advancing
    $stmt = $pdo->prepare($base . ' AND `task_date` <= :d AND `is_completed` = 0 ORDER BY `task_date` ASC, `id` ASC LIMIT 1');
    $stmt->execute([':u' => $userId, ':t' => $type, ':d' => $today]);
    $row = $stmt->fetch();
    return $row ?: null;
}

/**
 * Next sequential muraja'ah chunk inside [rangeStart, rangeEnd].
 * Advances from the furthest completed chunk; restarts at rangeStart
 * after the cycle finishes. If cycle finishes and there were pending rabt_extra_pages,
 * rolls those extra pages into murajaah and resets rabt_extra_pages to 0.
 */
function nextMurajaahChunk(PDO $pdo, int $userId, int $rangeStart, int $rangeEnd, int $target): ?array
{
    if ($rangeEnd < $rangeStart) {
        return null;
    }

    $stmt = $pdo->prepare(
        "SELECT MAX(`end_page`) FROM `daily_task_logs`
         WHERE `user_id` = :u AND `task_type` = 'MURAJAAH' AND `is_completed` = 1"
    );
    $stmt->execute([':u' => $userId]);
    $max = $stmt->fetchColumn();

    if ($max === false || $max === null || (int) $max < $rangeStart) {
        $next = $rangeStart;
    } else {
        $next = (int) $max + 1;
        if ($next > $rangeEnd) {
            $next = $rangeStart; // cycle complete -> restart!

            // Renewing revision cycle: incorporate accumulated rabt_extra_pages into Murajaah
            try {
                $uStmt = $pdo->prepare("SELECT `rabt_extra_pages` FROM `users` WHERE `id` = :u");
                $uStmt->execute([':u' => $userId]);
                $extra = (int) $uStmt->fetchColumn();
                if ($extra > 0) {
                    $pdo->prepare("UPDATE `users` SET `rabt_extra_pages` = 0 WHERE `id` = :u")
                        ->execute([':u' => $userId]);
                }
            } catch (Throwable $e) {}
        }
    }

    return [$next, min($next + $target - 1, $rangeEnd)];
}

function insertTask(PDO $pdo, int $userId, string $type, array $bounds, string $date, int $reps = 0): array
{
    $stmt = $pdo->prepare(
        'INSERT INTO `daily_task_logs`
            (`user_id`, `task_date`, `task_type`, `start_page`, `end_page`, `repetition_count`, `is_completed`)
         VALUES (:u, :d, :t, :s, :e, :r, 0)'
    );
    $stmt->execute([
        ':u' => $userId,
        ':d' => $date,
        ':t' => $type,
        ':s' => $bounds[0],
        ':e' => $bounds[1],
        ':r' => $reps,
    ]);

    return [
        'id'               => (int) $pdo->lastInsertId(),
        'task_date'        => $date,
        'task_type'        => $type,
        'start_page'       => $bounds[0],
        'end_page'         => $bounds[1],
        'repetition_count' => $reps,
        'is_completed'     => 0,
    ];
}

function formatTask(array $row, string $today): array
{
    $type = (string) $row['task_type'];
    $start = isset($row['start_page']) ? (int) $row['start_page'] : null;
    $end = isset($row['end_page']) ? (int) $row['end_page'] : null;
    $isCompleted = (bool) $row['is_completed'];
    $repetitionCount = isset($row['repetition_count']) ? (int) $row['repetition_count'] : 0;

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
            'carried_over'        => (string) $row['task_date'] !== $today,
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
        'carried_over'     => (string) $row['task_date'] !== $today,
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

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

$userId = $input['user_id'] ?? $_SESSION['user_id'] ?? null;
if ($userId === null || $userId === '') {
    json_out(401, ['success' => false, 'error' => 'Authentication required.']);
}
if (!filter_var($userId, FILTER_VALIDATE_INT)) {
    json_out(400, ['success' => false, 'error' => 'Invalid user_id.']);
}
$userId = (int) $userId;

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
    $rabtWindow  = 30 + $rabtExtra;

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
                $chunk = nextMurajaahChunk($pdo, $userId, $bounds[0], $bounds[1], $target);
                if ($chunk === null) {
                    continue; // empty range -> task inactive
                }
                $bounds = $chunk;
            }
            $row = insertTask($pdo, $userId, $type, $bounds, $today);
        }

        $tasks[] = formatTask($row, $today);
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
            'active_mistakes' => $activeMistakes,
        ];
    }

    json_out(200, [
        'success' => true,
        'date'    => $today,
        'user'    => [
            'id'                          => (int) $user['id'],
            'user_type'                   => $user['user_type'],
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
