<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz — Rub' Consolidation (RUB_TAMKIN) verse payload.
 *
 * GET/POST: task_id (preferred) or rub_id.
 *
 * Returns the rub' in mushaf order, each verse split at stop-preferring waqf
 * signs into stations. Every station is repeated 3 times by the client.
 */

require __DIR__ . '/../../config/database.php';
require_once __DIR__ . '/_rub.php';

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

require_once __DIR__ . '/../../config/auth.php';

$authUser = rh_require_login($pdo);
$userId   = rh_resolve_user_id($pdo, $authUser, $input['user_id'] ?? null);

$taskId = isset($input['task_id']) && $input['task_id'] !== '' ? (int) $input['task_id'] : 0;
$rubId  = isset($input['rub_id']) && $input['rub_id'] !== '' ? (int) $input['rub_id'] : 0;

$task = null;
if ($taskId > 0) {
    $stmt = $pdo->prepare(
        "SELECT `id`, `user_id`, `task_date`, `task_type`, `rub_id`, `start_page`, `end_page`,
                `is_completed`, `completed_stations`
         FROM `daily_task_logs`
         WHERE `id` = :id AND `user_id` = :u AND `task_type` = 'RUB_TAMKIN'
         LIMIT 1"
    );
    $stmt->execute([':id' => $taskId, ':u' => $userId]);
    $task = $stmt->fetch();
    if (!$task) {
        json_out(404, ['success' => false, 'error' => 'Task not found.']);
    }
    if ($rubId <= 0) {
        $rubId = (int) $task['rub_id'];
    }
}

if ($rubId <= 0) {
    json_out(400, ['success' => false, 'errors' => ['rub_id' => 'task_id or rub_id is required.']]);
}
if ($rubId < 1 || $rubId > 240) {
    json_out(400, ['success' => false, 'errors' => ['rub_id' => 'rub_id must be between 1 and 240.']]);
}

$payload = rh_rub_verses($rubId);
if ($payload['rub'] === null) {
    json_out(404, ['success' => false, 'error' => 'Rub catalog is not available on this server.']);
}

$completed = [];
if ($task !== null && !empty($task['completed_stations'])) {
    $decoded = json_decode((string) $task['completed_stations'], true);
    if (is_array($decoded)) {
        foreach ($decoded as $key) {
            if (is_string($key) && $key !== '') {
                $completed[] = $key;
            }
        }
    }
}
$completed = array_values(array_unique($completed));

$rub = $payload['rub'];
$today = date('Y-m-d');

// Add a stable station key to every segment so the client never has to build one.
$verses = [];
foreach ($payload['verses'] as $verse) {
    $segments = [];
    foreach ($verse['segments'] as $segment) {
        $segment['key'] = $verse['surah'] . ':' . $verse['ayah'] . ':' . (int) $segment['index'];
        $segments[] = $segment;
    }
    $verse['segments'] = $segments;
    $verses[] = $verse;
}

json_out(200, [
    'success'            => true,
    'today'              => $today,
    'task'               => $task === null ? null : [
        'id'                 => (int) $task['id'],
        'task_date'          => (string) $task['task_date'],
        'is_today'           => (string) $task['task_date'] === $today,
        'is_completed'       => (int) $task['is_completed'] === 1,
        'rub_id'             => (int) $task['rub_id'],
        'completed_stations' => $completed,
    ],
    'rub'                => [
        'id'             => (int) $rub['id'],
        'juz'            => (int) $rub['juz'],
        'hizb'           => (int) $rub['hizb'],
        'start'          => $rub['start'],
        'end'            => $rub['end'],
        'start_page'     => (int) $rub['start_page'],
        'end_page'       => (int) $rub['end_page'],
        'verse_count'    => (int) $rub['verse_count'],
        'segments_total' => (int) $rub['segments_total'],
    ],
    'completed_stations' => $completed,
    'verses'             => $verses,
]);
