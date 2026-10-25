<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Task Progress Update
 * POST JSON: user_id, task_type, completed_page
 *
 * HIFZ_JADID completion increments users.current_hifz_page and
 * auto-updates the Rabt window row. All log writes run in one transaction.
 */

require __DIR__ . '/../../config/database.php';
require_once __DIR__ . '/_rollover.php';

function json_out(int $code, array $payload): void
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

// Schema changes are handled by config/migrate_v7.php (and setup.php).
// No DDL runs in this request path.

/** Today's row for a task type, else the earliest pending (rollover) row. */
function findLogRow(PDO $pdo, int $userId, string $type, string $today): ?array
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

    $stmt = $pdo->prepare($base . ' AND `task_date` <= :d AND `is_completed` = 0 ORDER BY `task_date` ASC, `id` ASC LIMIT 1');
    $stmt->execute([':u' => $userId, ':t' => $type, ':d' => $today]);
    $row = $stmt->fetch();
    return $row ? rh_apply_rollover($pdo, $row, $today) : null;
}

function insertLogRow(PDO $pdo, int $userId, string $type, int $start, int $end, string $date, bool $completed, array $completedPages = [], int $reps = 0): array
{
    $json = !empty($completedPages) ? json_encode(array_values(array_unique(array_map('intval', $completedPages)))) : null;
    $hasRollover = rh_task_has_rollover($pdo);
    $extraColumns = $hasRollover ? ', `rollover_count`, `last_rollover_date`' : '';
    $extraValues  = $hasRollover ? ', 0, :rollover_date' : '';

    $stmt = $pdo->prepare(
        'INSERT INTO `daily_task_logs`
            (`user_id`, `task_date`, `task_type`, `start_page`, `end_page`, `completed_pages`, `repetition_count`, `is_completed`' . $extraColumns . ')
         VALUES (:u, :d, :t, :s, :e, :p, :r, :c' . $extraValues . ')'
    );
    $params = [
        ':u' => $userId,
        ':d' => $date,
        ':t' => $type,
        ':s' => $start,
        ':e' => $end,
        ':p' => $json,
        ':r' => $reps,
        ':c' => $completed ? 1 : 0,
    ];
    if ($hasRollover) {
        $params[':rollover_date'] = $date;
    }
    $stmt->execute($params);

    return [
        'id'                 => (int) $pdo->lastInsertId(),
        'task_date'          => $date,
        'task_type'          => $type,
        'start_page'         => $start,
        'end_page'           => $end,
        'completed_pages'    => $json,
        'repetition_count'   => $reps,
        'is_completed'       => $completed ? 1 : 0,
        'rollover_count'     => 0,
        'last_rollover_date' => $date,
    ];
}

function formatLogRow(array $row): array
{
    $start = (int) $row['start_page'];
    $end = (int) $row['end_page'];
    $isDone = (bool) $row['is_completed'];
    $type = (string) $row['task_type'];
    $reps = (int) ($row['repetition_count'] ?? 0);
    $rolloverCount = (int) ($row['rollover_count'] ?? 0);
    $carriedOver = $rolloverCount > 0;

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
            'carried_over'        => $carriedOver,
            'rollover_count'      => $rolloverCount,
            'last_rollover_date'  => $row['last_rollover_date'] ?? null,
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
        'carried_over'     => $carriedOver,
        'rollover_count'   => $rolloverCount,
        'last_rollover_date' => $row['last_rollover_date'] ?? null,
    ];
}

// ---------------------------------------------------------------------------
// Method & input
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
// Auth & validation
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

$completedPage = $input['completed_page'] ?? null;
if (is_string($completedPage) && ctype_digit($completedPage)) {
    $completedPage = (int) $completedPage;
}
if (!is_int($completedPage) || $completedPage < 1 || $completedPage > 604) {
    json_out(400, [
        'success' => false,
        'errors'  => ['completed_page' => 'completed_page must be an integer between 1 and 604.'],
    ]);
}

if (($input['action'] ?? '') === 'UNDO') {
    require __DIR__ . '/undo_progress.php';
    exit;
}

try {
    // -----------------------------------------------------------------------
    // Load profile & activation gates
    // -----------------------------------------------------------------------

    $stmt = $pdo->prepare('SELECT `id`, `user_type`, `current_hifz_page`, COALESCE(`rabt_extra_pages`, 0) AS `rabt_extra_pages`, COALESCE(`murajaah_days`, 6) AS `murajaah_days`, COALESCE(`last_tikrar_page`, 0) AS `last_tikrar_page` FROM `users` WHERE `id` = :id');
    $stmt->execute([':id' => $userId]);
    $user = $stmt->fetch();
    if (!$user) {
        json_out(401, ['success' => false, 'error' => 'Authentication required.']);
    }

    $current    = (int) $user['current_hifz_page'];
    $lastTikrar = (int) ($user['last_tikrar_page'] ?? 0);
    $utype      = (string) $user['user_type'];
    $murDays    = max(1, min(6, (int) ($user['murajaah_days'] ?? 6)));
    $rabtExtra  = (int) ($user['rabt_extra_pages'] ?? 0);
    $today      = date('Y-m-d');

    if ($utype === 'COMPLETE' && $taskType !== 'MURAJAAH') {
        json_out(400, ['success' => false, 'error' => $taskType . ' is disabled for COMPLETE users.']);
    }
    if ($taskType === 'RABT' && $utype === 'NEW' && $lastTikrar < 1) {
        json_out(400, ['success' => false, 'error' => 'Rabt is not active yet.']);
    }
    if ($taskType === 'MURAJAAH' && $utype === 'NEW' && $lastTikrar <= 30) {
        json_out(400, ['success' => false, 'error' => "Muraja'ah is not active yet."]);
    }

    // -----------------------------------------------------------------------
    // Apply completion
    // -----------------------------------------------------------------------

    $pdo->beginTransaction();
    $row = findLogRow($pdo, $userId, $taskType, $today);

    $newCurrent       = $current;
    $alreadyProcessed = false;
    $affectedTask     = null;

    if ($taskType === 'HIFZ_JADID') {
        if ($completedPage > $current + 1) {
            $pdo->rollBack();
            json_out(400, [
                'success' => false,
                'error'   => 'completed_page must be the next memorized page (current_hifz_page + 1).',
            ]);
        }

        if ($completedPage <= $current) {
            // Page already counted - idempotent no-op
            $alreadyProcessed = true;
            $affectedTask = $row;
        } else {
            $newCurrent = $completedPage;

            $stmt = $pdo->prepare('UPDATE `users` SET `current_hifz_page` = :p WHERE `id` = :id');
            $stmt->execute([':p' => $newCurrent, ':id' => $userId]);

            if ($row) {
                $compJson = json_encode([$newCurrent]);
                $stmt = $pdo->prepare('UPDATE `daily_task_logs` SET `is_completed` = 1, `completed_pages` = :p WHERE `id` = :id');
                $stmt->execute([':p' => $compJson, ':id' => $row['id']]);
                $row['is_completed'] = 1;
                $row['completed_pages'] = $compJson;
                $affectedTask = $row;
            } else {
                $affectedTask = insertLogRow($pdo, $userId, 'HIFZ_JADID', $newCurrent, $newCurrent, $today, true, [$newCurrent]);
            }

            // NOTE: Per business requirement, newly memorized page does NOT join Rabt immediately!
            // It must go through تكرار حفظ الأمس first tomorrow.
            // Rabt continues to only extend up to last_tikrar_page.
        }
    } elseif ($taskType === 'TIKRAR_AMS') {
        if ($row === null) {
            $row = insertLogRow($pdo, $userId, 'TIKRAR_AMS', $completedPage, $completedPage, $today, false, [], 0);
        }

        $currentReps = (int) ($row['repetition_count'] ?? 0);
        $reqReps = $input['repetition_count'] ?? null;
        if ($reqReps !== null && is_numeric($reqReps)) {
            $newReps = max(0, min(10, (int) $reqReps));
        } else {
            $newReps = min(10, $currentReps + 1);
        }

        if ($newReps === $currentReps && (int) $row['is_completed'] === 1) {
            $alreadyProcessed = true;
            $affectedTask = $row;
        } else {
            $isTaskDone = ($newReps >= 10) ? 1 : 0;
            $compJson = $isTaskDone ? json_encode([$completedPage]) : null;

            $stmt = $pdo->prepare('UPDATE `daily_task_logs` SET `repetition_count` = :r, `is_completed` = :c, `completed_pages` = :p WHERE `id` = :id');
            $stmt->execute([
                ':r' => $newReps,
                ':c' => $isTaskDone,
                ':p' => $compJson,
                ':id' => $row['id'],
            ]);

            $row['repetition_count'] = $newReps;
            $row['is_completed'] = $isTaskDone;
            $row['completed_pages'] = $compJson;
            $affectedTask = $row;

            // When TIKRAR_AMS is completed (10 recitations done), this page NOW JOINS RABT!
            if ($isTaskDone) {
                $newLastTikrar = max($lastTikrar, $completedPage);
                if ($newLastTikrar > $lastTikrar) {
                    if ($lastTikrar >= 30) {
                        $rabtExtra++;
                        $stmt = $pdo->prepare('UPDATE `users` SET `last_tikrar_page` = :tp, `rabt_extra_pages` = :extra WHERE `id` = :id');
                        $stmt->execute([':tp' => $newLastTikrar, ':extra' => $rabtExtra, ':id' => $userId]);
                    } else {
                        $stmt = $pdo->prepare('UPDATE `users` SET `last_tikrar_page` = :tp WHERE `id` = :id');
                        $stmt->execute([':tp' => $newLastTikrar, ':id' => $userId]);
                    }
                    $lastTikrar = $newLastTikrar;
                }

                // Auto-update or insert today's Rabt window now that page has graduated
                $rabtActive = ($utype === 'EXISTING' && $lastTikrar >= 1) || ($utype === 'NEW' && $lastTikrar >= 1);
                if ($rabtActive) {
                    $rabtWindow = 30 + $rabtExtra;
                    $rabtStart  = max(1, $lastTikrar - ($rabtWindow - 1));
                    $rabtEnd    = min($lastTikrar, 604);
                    $rrow       = findLogRow($pdo, $userId, 'RABT', $today);

                    if ($rrow) {
                        if (!(int) $rrow['is_completed']) {
                            $stmt = $pdo->prepare(
                                'UPDATE `daily_task_logs` SET `start_page` = :s, `end_page` = :e WHERE `id` = :id'
                            );
                            $stmt->execute([':s' => $rabtStart, ':e' => $rabtEnd, ':id' => $rrow['id']]);
                        }
                    } else {
                        insertLogRow($pdo, $userId, 'RABT', $rabtStart, $rabtEnd, $today, false);
                    }
                }
            }
        }
    } else {
        // RABT / MURAJAAH - page-by-page completion
        if ($row === null) {
            if ($taskType === 'RABT') {
                $frontier  = min($lastTikrar, 604);
                $rabtStart = max(1, $frontier - 29);
                $rabtEnd   = $frontier;

                if ($completedPage < $rabtStart || $completedPage > $rabtEnd) {
                    $pdo->rollBack();
                    json_out(400, [
                        'success' => false,
                        'error'   => "completed_page is outside today's Rabt window ({$rabtStart}-{$rabtEnd}).",
                    ]);
                }
                $isTaskDone = ($rabtStart === $rabtEnd);
                $affectedTask = insertLogRow($pdo, $userId, 'RABT', $rabtStart, $rabtEnd, $today, $isTaskDone, [$completedPage]);
            } else {
                // Muraja'ah
                $affectedTask = insertLogRow($pdo, $userId, 'MURAJAAH', $completedPage, $completedPage, $today, true, [$completedPage]);
            }
        } else {
            $start = (int) $row['start_page'];
            $end   = (int) $row['end_page'];

            if ($completedPage < $start || $completedPage > $end) {
                $pdo->rollBack();
                json_out(400, [
                    'success' => false,
                    'error'   => "completed_page is outside the active task range ({$start}-{$end}).",
                ]);
            }

            $currentList = [];
            if (!empty($row['completed_pages'])) {
                $dec = json_decode((string) $row['completed_pages'], true);
                if (is_array($dec)) {
                    $currentList = array_map('intval', $dec);
                }
            }

            if (in_array($completedPage, $currentList, true)) {
                $alreadyProcessed = true;
            } else {
                $currentList[] = $completedPage;
            }

            $currentList = array_values(array_unique($currentList));
            $totalNeeded = max(1, $end - $start + 1);
            $totalDone   = count($currentList);
            $isTaskDone  = ($totalDone >= $totalNeeded) ? 1 : (int) $row['is_completed'];

            $compJson = json_encode($currentList);
            $stmt = $pdo->prepare('UPDATE `daily_task_logs` SET `completed_pages` = :p, `is_completed` = :c WHERE `id` = :id');
            $stmt->execute([':p' => $compJson, ':c' => $isTaskDone, ':id' => $row['id']]);

            $row['completed_pages'] = $compJson;
            $row['is_completed']    = $isTaskDone;
            $affectedTask = $row;

            // If Murajaah task is completed and end_page reaches or exceeds the current Murajaah boundary,
            // or accumulated extra pages reached the cycle days, roll extra pages into Murajaah and reset rabt_extra_pages to 0.
            if ($taskType === 'MURAJAAH' && $isTaskDone) {
                $murajaahLimit = 604;
                if ($utype === 'NEW' || $utype === 'EXISTING') {
                    $rabtWin = 30 + $rabtExtra;
                    $murajaahLimit = max(0, $lastTikrar - $rabtWin);
                }
                if (($end >= $murajaahLimit || $rabtExtra >= $murDays) && $rabtExtra > 0) {
                    $pdo->prepare('UPDATE `users` SET `rabt_extra_pages` = 0 WHERE `id` = :id')
                        ->execute([':id' => $userId]);
                    $rabtExtra = 0;
                }
            }
        }
    }

    $pdo->commit();

    json_out(200, [
        'success'           => true,
        'message'           => $alreadyProcessed ? 'Already processed.' : 'Task progress updated.',
        'already_processed' => $alreadyProcessed,
        'user'              => [
            'id'                => $userId,
            'user_type'         => $utype,
            'current_hifz_page' => $newCurrent,
            'last_tikrar_page'  => $lastTikrar,
        ],
        'task'              => $affectedTask !== null ? formatLogRow($affectedTask) : null,
    ]);
} catch (PDOException $e) {
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    error_log('[UpdateProgress Failed] ' . $e->getMessage());
    json_out(500, ['success' => false, 'error' => 'Server error. Please try again.']);
}
