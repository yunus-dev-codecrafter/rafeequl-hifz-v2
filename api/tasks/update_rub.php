<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz — Rub' Consolidation progress (RUB_TAMKIN).
 *
 * POST JSON:
 *   task_id   int       required
 *   completed string[]  full list of completed verse keys ("surah:ayah")
 *   action    string    optional: "RESET"
 *
 * The client sends its whole local state, so retries are idempotent and the
 * page keeps working offline (queued calls are replayed in order). The existing
 * `completed_stations` TEXT column now stores verse keys; old station keys are
 * silently ignored and need no schema migration.
 */

require __DIR__ . '/../../config/database.php';
require_once __DIR__ . '/_rub.php';
require_once __DIR__ . '/_rollover.php';

function json_out(int $code, array $payload): void
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    json_out(400, ['success' => false, 'error' => 'Method not allowed. Use POST.']);
}

$input = $_GET;
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

require_once __DIR__ . '/../../config/auth.php';

$authUser = rh_require_login($pdo);
$userId   = rh_resolve_user_id($pdo, $authUser, $input['user_id'] ?? null);

$taskId = (int) ($input['task_id'] ?? 0);
if ($taskId <= 0) {
    json_out(400, ['success' => false, 'errors' => ['task_id' => 'task_id is required.']]);
}

$action = strtoupper(trim((string) ($input['action'] ?? '')));
$hasCompleted = array_key_exists('completed', $input);
if ($action !== 'RESET' && !$hasCompleted) {
    json_out(400, ['success' => false, 'errors' => ['completed' => 'completed must be an array of verse keys.']]);
}

$submitted = [];
if ($hasCompleted) {
    if (!is_array($input['completed'])) {
        json_out(400, ['success' => false, 'errors' => ['completed' => 'completed must be an array.']]);
    }
    foreach ($input['completed'] as $key) {
        if (is_string($key) && $key !== '') {
            $submitted[] = $key;
        }
    }
}

try {
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
    $task = rh_apply_rollover($pdo, $task, date('Y-m-d'));

    $rubId = (int) $task['rub_id'];
    $payload = rh_rub_verse_list($rubId);
    if ($payload['rub'] === null) {
        json_out(404, ['success' => false, 'error' => 'Rub catalog is not available on this server.']);
    }

    // Allow-list of valid verse keys, in mushaf order.
    $allowed = [];
    $allowedLookup = [];
    foreach ($payload['verses'] as $verse) {
        $key = $verse['surah'] . ':' . $verse['ayah'];
        $allowed[] = $key;
        $allowedLookup[$key] = true;
    }
    $versesTotal = count($allowed);

    $completed = [];
    if ($action !== 'RESET') {
        $set = [];
        foreach ($submitted as $key) {
            if (isset($allowedLookup[$key])) {
                $set[$key] = true;
            }
        }
        foreach ($allowed as $key) {
            if (isset($set[$key])) {
                $completed[] = $key;
            }
        }
    }

    $wasCompleted = (int) $task['is_completed'] === 1;
    $isCompleted = $versesTotal > 0 && count($completed) >= $versesTotal;

    $pdo->beginTransaction();

    $upd = $pdo->prepare(
        'UPDATE `daily_task_logs`
         SET `completed_stations` = :s, `is_completed` = :c
         WHERE `id` = :id AND `user_id` = :u'
    );
    $upd->execute([
        ':s'  => json_encode($completed, JSON_UNESCAPED_UNICODE),
        ':c'  => $isCompleted ? 1 : 0,
        ':id' => $taskId,
        ':u'  => $userId,
    ]);

    if ($isCompleted && !$wasCompleted) {
        rh_mark_rub_done($pdo, $userId, $rubId, (string) $task['task_date']);
    } elseif (!$isCompleted && $wasCompleted) {
        rh_unmark_rub_done($pdo, $userId, $rubId, (string) $task['task_date']);
    }

    $pdo->commit();

    json_out(200, [
        'success'          => true,
        'task_id'          => $taskId,
        'rub_id'           => $rubId,
        'completed_verses' => $completed,
        'completed_count'  => count($completed),
        'verses_total'     => $versesTotal,
        'progress_percent' => $versesTotal > 0 ? (int) round((count($completed) / $versesTotal) * 100) : 0,
        'is_completed'     => $isCompleted,
        'task_date'        => (string) $task['task_date'],
        'rollover_count'   => (int) ($task['rollover_count'] ?? 0),
        'last_rollover_date' => $task['last_rollover_date'] ?? null,
    ]);
} catch (PDOException $e) {
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    error_log('[UpdateRub Failed] ' . $e->getMessage());
    json_out(500, ['success' => false, 'error' => 'Server error. Please try again.']);
}
