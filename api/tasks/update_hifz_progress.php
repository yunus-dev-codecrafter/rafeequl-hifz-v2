<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - save per-verse progress for today's HIFZ_JADID page.
 *
 * This endpoint is intentionally separate from update_progress.php: it is
 * called frequently (after repetitions / link recitations) and must never
 * advance users.current_hifz_page. The page is completed only by
 * update_progress.php after this state is complete.
 */

require __DIR__ . '/../../config/database.php';
require_once __DIR__ . '/_rollover.php';
require_once __DIR__ . '/_hifz.php';

function json_out(int $code, array $payload): void
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, max-age=0');
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

try {
    $authUser = rh_require_login($pdo);
    $userId = (int) ($authUser['id'] ?? 0);
    if ($userId < 1) {
        json_out(401, ['success' => false, 'error' => 'Authentication required.']);
    }

    $taskId = $input['task_id'] ?? null;
    if (is_string($taskId) && ctype_digit($taskId)) {
        $taskId = (int) $taskId;
    }
    if (!is_int($taskId) || $taskId < 1) {
        json_out(400, ['success' => false, 'error' => 'task_id is required.']);
    }

    $page = $input['page'] ?? null;
    if (is_string($page) && ctype_digit($page)) {
        $page = (int) $page;
    }
    if (!is_int($page) || $page < 1 || $page > 604) {
        json_out(400, ['success' => false, 'error' => 'page must be an integer between 1 and 604.']);
    }

    $progressInput = $input['progress'] ?? null;
    if (!is_array($progressInput)) {
        json_out(400, ['success' => false, 'error' => 'progress must be a JSON object.']);
    }

    if (!rh_task_has_hifz_progress($pdo)) {
        json_out(503, [
            'success'            => false,
            'migration_required' => true,
            'error'              => 'Database upgrade required. Run config/migrate_v8.php (or setup.php) to save verse progress.',
        ]);
    }

    $stmt = $pdo->prepare(
        "SELECT `id`, `start_page`, `end_page`, `is_completed`, `hifz_progress`
         FROM `daily_task_logs`
         WHERE `id` = :id AND `user_id` = :u AND `task_type` = 'HIFZ_JADID'
         LIMIT 1"
    );
    $stmt->execute([':id' => $taskId, ':u' => $userId]);
    $row = $stmt->fetch();
    if (!$row) {
        json_out(404, ['success' => false, 'error' => 'HIFZ task not found.']);
    }

    $start = (int) $row['start_page'];
    $end = (int) $row['end_page'];
    if ($page < $start || $page > $end || $start !== $end) {
        json_out(400, ['success' => false, 'error' => 'page does not match the active HIFZ task.']);
    }

    if ((int) $row['is_completed'] === 1) {
        json_out(409, [
            'success' => false,
            'error'   => 'This HIFZ page is already complete.',
        ]);
    }

    $state = rh_hifz_sanitize($progressInput, $page);
    if ($state === null) {
        json_out(400, ['success' => false, 'error' => 'The progress payload is invalid for this page.']);
    }

    $stateJson = rh_hifz_json($state);
    $stmt = $pdo->prepare(
        'UPDATE `daily_task_logs`
         SET `hifz_progress` = :hp
         WHERE `id` = :id AND `user_id` = :u AND `is_completed` = 0'
    );
    $stmt->execute([':hp' => $stateJson, ':id' => $taskId, ':u' => $userId]);

    json_out(200, [
        'success'  => true,
        'saved'    => true,
        'progress' => $state,
    ]);
} catch (PDOException $e) {
    error_log('[UpdateHifzProgress Failed] ' . $e->getMessage());
    json_out(500, ['success' => false, 'error' => 'Server error. Please try again.']);
}
