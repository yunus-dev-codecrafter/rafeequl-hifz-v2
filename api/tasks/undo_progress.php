<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Task Progress Undo
 * POST JSON: user_id, task_type, page (or completed_page)
 *
 * Reverts an mistakenly marked page as completed.
 * For HIFZ_JADID: reverts users.current_hifz_page and adjusts Rabt window.
 * For RABT & MURAJAAH: removes the page from completed_pages and resets is_completed to 0.
 */

require __DIR__ . '/../../config/database.php';

if (!function_exists('json_out')) {
    function json_out(int $code, array $payload): void
    {
        http_response_code($code);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($payload, JSON_UNESCAPED_UNICODE);
        exit;
    }
}

if (!function_exists('findLogForUndo')) {
    function findLogForUndo(PDO $pdo, int $userId, string $type, string $today): ?array
    {
        $base = 'SELECT `id`, `task_date`, `task_type`, `start_page`, `end_page`, `is_completed`, `completed_pages`, COALESCE(`repetition_count`, 0) AS `repetition_count`
                 FROM `daily_task_logs`
                 WHERE `user_id` = :u AND `task_type` = :t';

        $stmt = $pdo->prepare($base . ' AND `task_date` = :d ORDER BY `id` DESC LIMIT 1');
        $stmt->execute([':u' => $userId, ':t' => $type, ':d' => $today]);
        $row = $stmt->fetch();
        if ($row) {
            return $row;
        }

        $stmt = $pdo->prepare($base . ' AND `task_date` <= :d ORDER BY `task_date` DESC, `id` DESC LIMIT 1');
        $stmt->execute([':u' => $userId, ':t' => $type, ':d' => $today]);
        $row = $stmt->fetch();
        return $row ?: null;
    }
}

if (!function_exists('formatLogRowUndo')) {
    function formatLogRowUndo(array $row): array
    {
        $start  = (int) $row['start_page'];
        $end    = (int) $row['end_page'];
        $isDone = (bool) $row['is_completed'];
        $type   = (string) $row['task_type'];
        $reps   = (int) ($row['repetition_count'] ?? 0);

        if ($type === 'TIKRAR_AMS') {
            $targetReps = 10;
            $currentReps = $isDone ? 10 : min(10, $reps);
            $percent = (int) round(($currentReps / $targetReps) * 100);
            return [
                'id'                  => (int) $row['id'],
                'task_date'           => (string) $row['task_date'],
                'task_type'           => $type,
                'start_page'          => $start,
                'end_page'            => $end,
                'is_completed'        => $isDone,
                'completed_pages'     => $isDone ? [$start] : [],
                'completed_count'     => $isDone ? 1 : 0,
                'total_pages'         => 1,
                'repetition_count'    => $currentReps,
                'target_repetitions'  => $targetReps,
                'progress_percent'    => min(100, $percent),
            ];
        }

        $pages = [];
        if (!empty($row['completed_pages'])) {
            $dec = json_decode((string) $row['completed_pages'], true);
            if (is_array($dec)) {
                $pages = array_values(array_map('intval', $dec));
            }
        } elseif ($isDone) {
            $pages = ($start === $end) ? [$start] : range($start, $end);
        }

        $total = max(1, $end - $start + 1);
        $count = count($pages);

        return [
            'id'               => (int) $row['id'],
            'task_date'        => (string) $row['task_date'],
            'task_type'        => $type,
            'start_page'       => $start,
            'end_page'         => $end,
            'is_completed'     => $isDone,
            'completed_pages'  => $pages,
            'completed_count'  => $count,
            'total_pages'      => $total,
            'progress_percent' => min(100, (int) round(($count / $total) * 100)),
        ];
    }
}

// ---------------------------------------------------------------------------
// Method & Input Parsing
// ---------------------------------------------------------------------------

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    json_out(400, ['success' => false, 'error' => 'Method not allowed. Use POST.']);
}

$input = $_GET;
$raw   = file_get_contents('php://input');
if (is_string($raw) && $raw !== '') {
    $json = json_decode($raw, true);
    if (!is_array($json)) {
        json_out(400, ['success' => false, 'error' => 'Invalid JSON payload.']);
    }
    $input = array_merge($input, $json);
} elseif (!empty($_POST)) {
    $input = array_merge($input, $_POST);
}

// ---------------------------------------------------------------------------
// Auth & Validation
// ---------------------------------------------------------------------------

require_once __DIR__ . '/../../config/auth.php';

// Session is authoritative. A client-supplied user_id is accepted only from an
// administrator (so the admin panel can act on other accounts).
$authUser = rh_require_login($pdo);
$userId   = rh_resolve_user_id($pdo, $authUser, $input['user_id'] ?? null);

$taskType = (string) ($input['task_type'] ?? '');
if (!in_array($taskType, ['HIFZ_JADID', 'TIKRAR_AMS', 'RABT', 'MURAJAAH'], true)) {
    json_out(400, [
        'success' => false,
        'errors'  => ['task_type' => 'task_type must be one of: HIFZ_JADID, TIKRAR_AMS, RABT, MURAJAAH.'],
    ]);
}

$page = $input['completed_page'] ?? $input['page'] ?? null;
if (is_string($page) && ctype_digit($page)) {
    $page = (int) $page;
}
if (!is_int($page) || $page < 1 || $page > 604) {
    json_out(400, [
        'success' => false,
        'errors'  => ['page' => 'page must be an integer between 1 and 604.'],
    ]);
}

try {
    $stmt = $pdo->prepare('SELECT `id`, `user_type`, `current_hifz_page`, COALESCE(`rabt_extra_pages`, 0) AS `rabt_extra_pages`, COALESCE(`murajaah_days`, 6) AS `murajaah_days`, COALESCE(`last_tikrar_page`, 0) AS `last_tikrar_page` FROM `users` WHERE `id` = :id');
    $stmt->execute([':id' => $userId]);
    $user = $stmt->fetch();
    if (!$user) {
        json_out(401, ['success' => false, 'error' => 'Authentication required.']);
    }

    $current    = (int) $user['current_hifz_page'];
    $lastTikrar = (int) ($user['last_tikrar_page'] ?? 0);
    $utype      = (string) $user['user_type'];
    $rabtExtra  = (int) ($user['rabt_extra_pages'] ?? 0);
    $today      = date('Y-m-d');

    $pdo->beginTransaction();
    $row = findLogForUndo($pdo, $userId, $taskType, $today);

    $alreadyProcessed = false;
    $affectedTask     = null;

    if ($taskType === 'HIFZ_JADID') {
        if ($row) {
            $compList = [];
            if (!empty($row['completed_pages'])) {
                $dec = json_decode((string) $row['completed_pages'], true);
                if (is_array($dec)) {
                    $compList = array_map('intval', $dec);
                }
            } elseif ((int) $row['is_completed'] === 1) {
                $compList = [(int) $row['start_page']];
            }

            if (in_array($page, $compList, true) || (int) $row['is_completed'] === 1) {
                if ($current >= $page) {
                    $newCurrent = max(0, $page - 1);
                    $stmt = $pdo->prepare('UPDATE `users` SET `current_hifz_page` = :p WHERE `id` = :id');
                    $stmt->execute([':p' => $newCurrent, ':id' => $userId]);
                    $current = $newCurrent;
                }

                $stmt = $pdo->prepare('UPDATE `daily_task_logs` SET `is_completed` = 0, `completed_pages` = NULL WHERE `id` = :id');
                $stmt->execute([':id' => $row['id']]);
                $row['is_completed'] = 0;
                $row['completed_pages'] = null;
                $affectedTask = $row;
            } else {
                $alreadyProcessed = true;
                $affectedTask = $row;
            }
        }
    } elseif ($taskType === 'TIKRAR_AMS') {
        if ($row) {
            $currentReps = (int) ($row['repetition_count'] ?? 0);
            if ($currentReps <= 0 && !(int) $row['is_completed']) {
                $alreadyProcessed = true;
                $affectedTask = $row;
            } else {
                $wasDone = ((int) $row['is_completed'] === 1);
                $newReps = max(0, $currentReps - 1);

                $stmt = $pdo->prepare('UPDATE `daily_task_logs` SET `repetition_count` = :r, `is_completed` = 0, `completed_pages` = NULL WHERE `id` = :id');
                $stmt->execute([':r' => $newReps, ':id' => $row['id']]);
                $row['repetition_count'] = $newReps;
                $row['is_completed'] = 0;
                $row['completed_pages'] = null;
                $affectedTask = $row;

                if ($wasDone) {
                    if ($lastTikrar >= $page) {
                        $newLastTikrar = max(0, $page - 1);
                        $newRabtExtra = ($lastTikrar >= 30 && $rabtExtra > 0) ? ($rabtExtra - 1) : $rabtExtra;
                        $stmt = $pdo->prepare('UPDATE `users` SET `last_tikrar_page` = :p, `rabt_extra_pages` = :extra WHERE `id` = :id');
                        $stmt->execute([':p' => $newLastTikrar, ':extra' => $newRabtExtra, ':id' => $userId]);
                        $lastTikrar = $newLastTikrar;
                        $rabtExtra = $newRabtExtra;
                    }

                    // Revert today's uncompleted Rabt window if needed
                    $rrow = findLogForUndo($pdo, $userId, 'RABT', $today);
                    if ($rrow && !(int) $rrow['is_completed']) {
                        $rabtWindow = 30 + $rabtExtra;
                        $rabtStart  = max(1, $lastTikrar - ($rabtWindow - 1));
                        $rabtEnd    = min($lastTikrar, 604);
                        $stmt = $pdo->prepare('UPDATE `daily_task_logs` SET `start_page` = :s, `end_page` = :e WHERE `id` = :id');
                        $stmt->execute([':s' => $rabtStart, ':e' => $rabtEnd, ':id' => $rrow['id']]);
                    }
                }
            }
        }
    } else {
        // RABT / MURAJAAH
        if ($row) {
            $start = (int) $row['start_page'];
            $end   = (int) $row['end_page'];

            $compList = [];
            if (!empty($row['completed_pages'])) {
                $dec = json_decode((string) $row['completed_pages'], true);
                if (is_array($dec)) {
                    $compList = array_map('intval', $dec);
                }
            } elseif ((int) $row['is_completed'] === 1) {
                $compList = ($start === $end) ? [$start] : range($start, $end);
            }

            if (!in_array($page, $compList, true)) {
                $alreadyProcessed = true;
                $affectedTask = $row;
            } else {
                $compList = array_values(array_filter($compList, function($p) use ($page) {
                    return (int) $p !== (int) $page;
                }));

                $newCompJson = !empty($compList) ? json_encode($compList) : null;
                $stmt = $pdo->prepare('UPDATE `daily_task_logs` SET `completed_pages` = :p, `is_completed` = 0 WHERE `id` = :id');
                $stmt->execute([':p' => $newCompJson, ':id' => $row['id']]);

                $row['completed_pages'] = $newCompJson;
                $row['is_completed'] = 0;
                $affectedTask = $row;
            }
        }
    }

    $pdo->commit();

    json_out(200, [
        'success'           => true,
        'message'           => $alreadyProcessed ? 'Already unmarked.' : 'Page progress undone.',
        'already_processed' => $alreadyProcessed,
        'user'              => [
            'id'                => $userId,
            'user_type'         => $utype,
            'current_hifz_page' => $current,
            'last_tikrar_page'  => $lastTikrar,
        ],
        'task'              => $affectedTask !== null ? formatLogRowUndo($affectedTask) : null,
    ]);
} catch (PDOException $e) {
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    error_log('[UndoProgress Failed] ' . $e->getMessage());
    json_out(500, ['success' => false, 'error' => 'Server error. Please try again.']);
}
