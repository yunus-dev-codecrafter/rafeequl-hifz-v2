<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Rub' Consolidation structured session API (RUB_TAMKIN v13).
 *
 * GET  ?task_id=123
 *      Returns the active session (if any), recent history, weak verses/words,
 *      and the saved settings so the page can resume exactly where it stopped.
 *
 * POST JSON:
 *   action = "start"   task_id, difficulty, exercises[], sample_size,
 *                      allow_outside_rub, focus ("ALL"|"WEAK"), force?, resume?
 *   action = "save"    session_id, results[] (idempotent upserts)
 *   action = "finish"  session_id, duration_seconds
 *   action = "reset"   task_id  (abandons the active session, keeps history)
 *
 * The plan itself is generated server-side by _rub_session.php. The client only
 * renders it and validates locally; every submitted result is re-validated
 * against the selected rub' before it is stored.
 */

require __DIR__ . '/../../config/database.php';
require_once __DIR__ . '/_rub.php';
require_once __DIR__ . '/_rub_session.php';
require_once __DIR__ . '/_rollover.php';

function json_out(int $code, array $payload): void
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

function rh_rub_schema_ready(PDO $pdo): bool
{
    try {
        foreach (['rub_sessions', 'rub_results', 'rub_verse_stats', 'rub_word_misses'] as $table) {
            if (!$pdo->query("SHOW TABLES LIKE '" . $table . "'")->fetchColumn()) {
                return false;
            }
        }
        // v13 extends rub_results.exercise with the advanced challenges. Refuse
        // to start a session that cannot be saved instead of failing mid-way.
        $column = $pdo->query("SHOW COLUMNS FROM `rub_results` LIKE 'exercise'")->fetch();
        if (!is_array($column) || strpos((string) ($column['Type'] ?? ''), 'INTERRUPT') === false) {
            return false;
        }
        return true;
    } catch (Throwable $t) {
        return false;
    }
}

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

require_once __DIR__ . '/../../config/auth.php';

$authUser = rh_require_login($pdo);
$userId   = rh_resolve_user_id($pdo, $authUser, $input['user_id'] ?? null);

if (!rh_rub_schema_ready($pdo)) {
    json_out(503, [
        'success' => false,
        'error'   => 'The Rub Consolidation session tables are not installed or need the v13 upgrade.',
        'code'    => 'schema_missing',
        'hint'    => 'Run config/migrate_v13.php or open migrate.php, then reload this page.',
    ]);
}

$action = strtoupper(trim((string) ($input['action'] ?? 'STATE')));

/** Load and validate the RUB_TAMKIN task owned by this user. */
function rh_rub_session_task(PDO $pdo, int $userId, int $taskId): array
{
    $select = rh_task_log_select($pdo);
    $stmt = $pdo->prepare(
        'SELECT `user_id`, ' . $select . "
         FROM `daily_task_logs`
         WHERE `id` = :id AND `user_id` = :u AND `task_type` = 'RUB_TAMKIN'
         LIMIT 1"
    );
    $stmt->execute([':id' => $taskId, ':u' => $userId]);
    $task = $stmt->fetch();
    if (!$task) {
        json_out(404, ['success' => false, 'error' => 'Task not found.']);
    }
    return rh_apply_rollover($pdo, $task, date('Y-m-d'));
}

function rh_rub_state_payload(PDO $pdo, int $userId, array $task): array
{
    $taskId = (int) $task['id'];
    $rubId = (int) $task['rub_id'];

    $active = rh_rub_active_session($pdo, $userId, $taskId);
    $activePublic = $active ? rh_rub_session_public($active) : null;
    if ($activePublic !== null) {
        $activePublic['results'] = rh_rub_session_results($pdo, (int) $activePublic['id'], $userId);
    }

    $lastStmt = $pdo->prepare(
        'SELECT ' . rh_rub_session_select() . '
         FROM `rub_sessions`
         WHERE `user_id` = :u AND `task_id` = :t AND `status` = \'COMPLETED\'
         ORDER BY `id` DESC LIMIT 1'
    );
    $lastStmt->execute([':u' => $userId, ':t' => $taskId]);
    $lastRow = $lastStmt->fetch();
    $last = $lastRow ? rh_rub_session_public($lastRow) : null;
    if ($last !== null) {
        unset($last['plan']);
    }

    $settings = [
        'difficulty'       => 'INTERMEDIATE',
        'exercises'        => rh_rub_core_exercise_keys(),
        'sample_size'      => 6,
        'allow_outside_rub' => true,
        'focus'            => 'ALL',
    ];
    $source = $activePublic ?? $last;
    if ($source !== null) {
        $settings = [
            'difficulty'       => (string) $source['difficulty'],
            'exercises'        => $source['exercises'] ?: rh_rub_core_exercise_keys(),
            'sample_size'      => (int) $source['sample_size'] > 0 ? (int) $source['sample_size'] : 6,
            'allow_outside_rub' => (bool) $source['allow_outside_rub'],
            'focus'            => 'ALL',
        ];
    }

    $weak = rh_rub_weak_verses($pdo, $userId, $rubId, 20);
    $weakWords = rh_rub_weak_words($pdo, $userId, $rubId, 12);

    return [
        'success'       => true,
        'today'         => date('Y-m-d'),
        'task'          => [
            'id'       => $taskId,
            'task_date' => (string) ($task['task_date'] ?? ''),
            'rub_id'   => $rubId,
            'is_completed' => (int) ($task['is_completed'] ?? 0) === 1,
            'rollover_count' => (int) ($task['rollover_count'] ?? 0),
        ],
        'rub'           => rh_rub_by_id($rubId),
        'active_session' => $activePublic,
        'last_session'  => $last,
        'history'       => rh_rub_session_history($pdo, $userId, $rubId, 6),
        'settings'      => $settings,
        'stats'         => [
            'weak_verses' => $weak,
            'weak_words'  => $weakWords,
            'due_count'   => rh_rub_due_count($pdo, $userId, $rubId),
            'has_weak'    => count($weak) > 0 || count($weakWords) > 0,
        ],
    ];
}

try {
    if ($action === 'STATE') {
        $taskId = (int) ($input['task_id'] ?? 0);
        if ($taskId <= 0) {
            json_out(400, ['success' => false, 'errors' => ['task_id' => 'task_id is required.']]);
        }
        $task = rh_rub_session_task($pdo, $userId, $taskId);
        json_out(200, rh_rub_state_payload($pdo, $userId, $task));
    }

    if ($action === 'START') {
        $taskId = (int) ($input['task_id'] ?? 0);
        if ($taskId <= 0) {
            json_out(400, ['success' => false, 'errors' => ['task_id' => 'task_id is required.']]);
        }
        $task = rh_rub_session_task($pdo, $userId, $taskId);
        $rubId = (int) $task['rub_id'];
        $payload = rh_rub_verse_list($rubId);
        if ($payload['rub'] === null) {
            json_out(404, ['success' => false, 'error' => 'Rub catalog is not available on this server.']);
        }

        $difficulty = strtoupper(trim((string) ($input['difficulty'] ?? 'INTERMEDIATE')));
        if (!in_array($difficulty, rh_rub_difficulties(), true)) {
            $difficulty = 'INTERMEDIATE';
        }

        $requested = $input['exercises'] ?? rh_rub_core_exercise_keys();
        if (!is_array($requested)) {
            json_out(400, ['success' => false, 'errors' => ['exercises' => 'exercises must be an array.']]);
        }
        $exercises = [];
        foreach (rh_rub_exercise_keys() as $key) {
            if (in_array($key, $requested, true)) {
                $exercises[] = $key;
            }
        }
        if (!$exercises) {
            json_out(400, ['success' => false, 'errors' => ['exercises' => 'Choose at least one exercise.']]);
        }

        $sampleSize = (int) ($input['sample_size'] ?? 6);
        if (!in_array($sampleSize, rh_rub_sample_sizes(), true)) {
            $sampleSize = 6;
        }

        $allowOutside = !array_key_exists('allow_outside_rub', $input)
            || filter_var($input['allow_outside_rub'], FILTER_VALIDATE_BOOLEAN);

        $focus = strtoupper(trim((string) ($input['focus'] ?? 'ALL')));
        if (!in_array($focus, ['ALL', 'WEAK'], true)) {
            $focus = 'ALL';
        }

        $force = filter_var($input['force'] ?? false, FILTER_VALIDATE_BOOLEAN);
        $resume = filter_var($input['resume'] ?? false, FILTER_VALIDATE_BOOLEAN);

        $active = rh_rub_active_session($pdo, $userId, $taskId);
        if ($active !== null && $resume && !$force) {
            $activePublic = rh_rub_session_public($active);
            $activePublic['results'] = rh_rub_session_results($pdo, (int) $active['id'], $userId);
            json_out(200, [
                'success' => true,
                'resumed' => true,
                'session' => $activePublic,
                'settings' => [
                    'difficulty' => (string) $active['difficulty'],
                    'exercises' => $activePublic['exercises'],
                    'sample_size' => (int) $active['sample_size'],
                    'allow_outside_rub' => (int) $active['allow_outside_rub'] === 1,
                    'focus' => $focus,
                ],
            ]);
        }

        if ($active !== null) {
            $abandon = $pdo->prepare(
                'UPDATE `rub_sessions` SET `status` = \'ABANDONED\'
                 WHERE `id` = :id AND `user_id` = :u AND `status` = \'IN_PROGRESS\''
            );
            $abandon->execute([':id' => (int) $active['id'], ':u' => $userId]);
        }

        $attemptStmt = $pdo->prepare(
            'SELECT COALESCE(MAX(`attempt_no`), 0) + 1
             FROM `rub_sessions` WHERE `user_id` = :u AND `task_id` = :t'
        );
        $attemptStmt->execute([':u' => $userId, ':t' => $taskId]);
        $attemptNo = max(1, (int) $attemptStmt->fetchColumn());

        $stats = rh_rub_verse_stats_map($pdo, $userId, $rubId);
        $seed = abs((int) crc32($taskId . ':' . $attemptNo . ':' . $rubId . ':' . $focus . ':' . $difficulty));
        if ($seed === 0) {
            $seed = 1;
        }

        $plan = rh_rub_build_plan($rubId, $difficulty, $exercises, $sampleSize, $allowOutside, $focus, $stats, $seed);
        $available = 0;
        foreach (($plan['exercises'] ?? []) as $stage) {
            if (is_array($stage) && !empty($stage['available'])) {
                $available++;
            }
        }
        if ($available === 0) {
            json_out(422, [
                'success' => false,
                'error'   => 'No exercise items could be generated for this rub with the selected settings.',
                'code'    => 'empty_plan',
                'plan'    => $plan,
            ]);
        }

        $insert = $pdo->prepare(
            'INSERT INTO `rub_sessions`
                (`user_id`, `task_id`, `rub_id`, `attempt_no`, `difficulty`, `status`,
                 `exercises`, `plan_json`, `progress_json`, `sample_size`, `allow_outside_rub`)
             VALUES
                (:u, :t, :r, :a, :d, \'IN_PROGRESS\',
                 :ex, :plan, :progress, :size, :outside)'
        );
        $insert->execute([
            ':u' => $userId,
            ':t' => $taskId,
            ':r' => $rubId,
            ':a' => $attemptNo,
            ':d' => $difficulty,
            ':ex' => json_encode($exercises, JSON_UNESCAPED_UNICODE),
            ':plan' => json_encode($plan, JSON_UNESCAPED_UNICODE),
            ':progress' => json_encode(['answered' => [], 'updated_at' => date('c')], JSON_UNESCAPED_UNICODE),
            ':size' => $sampleSize,
            ':outside' => $allowOutside ? 1 : 0,
        ]);

        $sessionId = (int) $pdo->lastInsertId();
        $row = rh_rub_session_by_id($pdo, $userId, $sessionId);
        if (!$row) {
            json_out(500, ['success' => false, 'error' => 'Could not load the new session.']);
        }

        json_out(200, [
            'success' => true,
            'resumed' => false,
            'session' => rh_rub_session_public($row, $plan),
            'settings' => [
                'difficulty' => $difficulty,
                'exercises' => $exercises,
                'sample_size' => $sampleSize,
                'allow_outside_rub' => $allowOutside,
                'focus' => $focus,
            ],
            'focus_fallback' => $focus === 'WEAK' && count($stats) === 0,
        ]);
    }

    if ($action === 'SAVE') {
        $sessionId = (int) ($input['session_id'] ?? 0);
        if ($sessionId <= 0) {
            json_out(400, ['success' => false, 'errors' => ['session_id' => 'session_id is required.']]);
        }
        $session = rh_rub_session_by_id($pdo, $userId, $sessionId);
        if (!$session) {
            json_out(404, ['success' => false, 'error' => 'Session not found.']);
        }
        if ((string) $session['status'] !== 'IN_PROGRESS') {
            json_out(409, ['success' => false, 'error' => 'This session is no longer in progress.', 'code' => 'session_closed']);
        }

        $results = $input['results'] ?? null;
        if (!is_array($results)) {
            json_out(400, ['success' => false, 'errors' => ['results' => 'results must be an array.']]);
        }
        if (count($results) > 500) {
            json_out(400, ['success' => false, 'errors' => ['results' => 'Too many results in one request.']]);
        }

        $saved = rh_rub_save_results($pdo, $userId, $session, $results);
        json_out(200, [
            'success' => true,
            'saved'   => (int) $saved['saved'],
            'session' => $saved['session'],
        ]);
    }

    if ($action === 'FINISH') {
        $sessionId = (int) ($input['session_id'] ?? 0);
        if ($sessionId <= 0) {
            json_out(400, ['success' => false, 'errors' => ['session_id' => 'session_id is required.']]);
        }
        $session = rh_rub_session_by_id($pdo, $userId, $sessionId);
        if (!$session) {
            json_out(404, ['success' => false, 'error' => 'Session not found.']);
        }
        if ((string) $session['status'] === 'COMPLETED') {
            $task = rh_rub_session_task($pdo, $userId, (int) $session['task_id']);
            $completed = rh_rub_session_public($session);
            $completed['results'] = rh_rub_session_results($pdo, (int) $session['id'], $userId);
            json_out(200, [
                'success' => true,
                'already_completed' => true,
                'session' => $completed,
                'state'   => rh_rub_state_payload($pdo, $userId, $task),
            ]);
        }
        if ((string) $session['status'] !== 'IN_PROGRESS') {
            json_out(409, ['success' => false, 'error' => 'This session cannot be finished.', 'code' => 'session_closed']);
        }

        $duration = max(0, min(86400, (int) ($input['duration_seconds'] ?? 0)));
        $result = rh_rub_finish_session($pdo, $userId, $session, $duration);
        if (empty($result['ok'])) {
            json_out(409, [
                'success' => false,
                'error' => (string) ($result['error'] ?? 'The session is not complete yet.'),
                'code' => 'items_remaining',
                'remaining' => (int) ($result['remaining'] ?? 0),
            ]);
        }

        $task = rh_rub_session_task($pdo, $userId, (int) $session['task_id']);
        $state = rh_rub_state_payload($pdo, $userId, $task);
        $finished = is_array($result['session'] ?? null) ? $result['session'] : [];
        if ($finished) {
            $finished['results'] = rh_rub_session_results($pdo, (int) $session['id'], $userId);
        }
        json_out(200, [
            'success' => true,
            'session' => $finished,
            'state'   => $state,
        ]);
    }

    if ($action === 'RESET' || $action === 'ABANDON') {
        $taskId = (int) ($input['task_id'] ?? 0);
        if ($taskId <= 0) {
            json_out(400, ['success' => false, 'errors' => ['task_id' => 'task_id is required.']]);
        }
        $task = rh_rub_session_task($pdo, $userId, $taskId);
        $stmt = $pdo->prepare(
            'UPDATE `rub_sessions` SET `status` = \'ABANDONED\'
             WHERE `user_id` = :u AND `task_id` = :t AND `status` = \'IN_PROGRESS\''
        );
        $stmt->execute([':u' => $userId, ':t' => $taskId]);
        json_out(200, [
            'success' => true,
            'abandoned' => $stmt->rowCount(),
            'state' => rh_rub_state_payload($pdo, $userId, $task),
        ]);
    }

    json_out(400, ['success' => false, 'error' => 'Unknown action.']);
} catch (Throwable $e) {
    error_log('[RubSession] ' . $e->getMessage());
    json_out(500, [
        'success' => false,
        'error'   => 'The Rub Consolidation session could not be saved. Please try again.',
        'code'    => 'server_error',
    ]);
}
