<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Page-by-page consolidation API (PAGE_TAMKIN).
 *
 * GET  ?task_id=123
 *      Returns today's page task, page text/words, active weak targets and the
 *      list of selectable surahs/rubs/pages.
 *
 * POST JSON:
 *   action = "select"        target_type ("SURAH"|"RUB"|"PAGE"), target_id
 *   action = "unselect"      selection_id
 *   action = "clear"
 *   action = "save_progress" task_id, words_done
 *   action = "result"        task_id, result ("DONE"|"IMPROVE")
 *
 * The server owns page selection. The client only renders the returned plan.
 */

require __DIR__ . '/../../config/database.php';
require_once __DIR__ . '/../../config/auth.php';
require_once __DIR__ . '/_page.php';

function json_out(int $code, array $payload): void
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
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

try {
    $authUser = rh_require_login($pdo);
    $userId = (int) $authUser['id'];
    $today = date('Y-m-d');

    if (!rh_pg_schema_ready($pdo)) {
        json_out(503, [
            'success' => false,
            'error'   => 'Page consolidation is not installed yet. Run config/migrate_v14.php.',
            'code'    => 'SCHEMA_NOT_READY',
        ]);
    }

    $action = strtolower(trim((string) ($input['action'] ?? '')));

    if ($method === 'POST' && $action !== '') {
        if ($action === 'select') {
            $type = strtoupper(trim((string) ($input['target_type'] ?? '')));
            $targetId = (int) ($input['target_id'] ?? 0);
            if (!in_array($type, ['SURAH', 'RUB', 'PAGE'], true) || $targetId < 1) {
                json_out(400, ['success' => false, 'error' => 'Choose a valid surah, rub or page.']);
            }
            $ctx = rh_pg_user_context($pdo, $userId);
            $selection = rh_pg_add_selection($pdo, $userId, $type, $targetId, $ctx['frontier'], $today);
            if ($selection === null) {
                json_out(400, ['success' => false, 'error' => 'This target has no memorised pages yet.']);
            }
            json_out(200, array_merge(rh_pg_state($pdo, $userId, $today), ['selection' => $selection]));
        }

        if ($action === 'unselect') {
            $selectionId = (int) ($input['selection_id'] ?? 0);
            $ctx = rh_pg_user_context($pdo, $userId);
            if (!rh_pg_remove_selection($pdo, $userId, $selectionId, $ctx['frontier'])) {
                json_out(404, ['success' => false, 'error' => 'Selection not found.']);
            }
            json_out(200, rh_pg_state($pdo, $userId, $today));
        }

        if ($action === 'clear') {
            $ctx = rh_pg_user_context($pdo, $userId);
            rh_pg_clear_selections($pdo, $userId, $ctx['frontier']);
            json_out(200, rh_pg_state($pdo, $userId, $today));
        }

        if ($action === 'save_progress') {
            $taskId = (int) ($input['task_id'] ?? 0);
            $wordsDone = (int) ($input['words_done'] ?? 0);
            $saved = rh_pg_save_words($pdo, $userId, $taskId, $wordsDone);
            if ($saved === null) {
                json_out(404, ['success' => false, 'error' => 'Task not found.']);
            }
            json_out(200, array_merge(rh_pg_state($pdo, $userId, $today, $taskId), ['saved' => $saved]));
        }

        if ($action === 'result') {
            $taskId = (int) ($input['task_id'] ?? 0);
            $result = strtoupper(trim((string) ($input['result'] ?? '')));
            if (!in_array($result, ['DONE', 'IMPROVE'], true)) {
                json_out(400, ['success' => false, 'error' => 'Result must be DONE or IMPROVE.']);
            }
            $progress = rh_pg_mark_result($pdo, $userId, $taskId, $result, $today);
            if ($progress === null) {
                json_out(404, ['success' => false, 'error' => 'Task not found.']);
            }
            json_out(200, array_merge(rh_pg_state($pdo, $userId, $today, $taskId), ['progress' => $progress]));
        }

        json_out(400, ['success' => false, 'error' => 'Unknown action.']);
    }

    $taskId = isset($input['task_id']) ? (int) $input['task_id'] : null;
    json_out(200, rh_pg_state($pdo, $userId, $today, $taskId));
} catch (Throwable $e) {
    error_log('[PageConsolidation] ' . $e->getMessage());
    json_out(500, [
        'success' => false,
        'error'   => 'Server error. Please try again.',
        'exception' => $e->getMessage(),
        'file'    => $e->getFile(),
        'line'    => $e->getLine(),
    ]);
}
