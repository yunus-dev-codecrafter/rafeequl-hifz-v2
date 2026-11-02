<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz — Rub' Consolidation (RUB_TAMKIN) verse payload.
 *
 * GET/POST: task_id (preferred) or rub_id.
 *
 * The rub' is returned verse by verse in mushaf order. Every verse carries its
 * display text, a stable word list for the arrangement exercise, three decoy
 * words sampled from the whole Qur'an, and its Arabic/English Mukhtasar tafsir.
 * The client consolidates one verse at a time; no waqf stations are involved.
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

$payload = rh_rub_verse_list($rubId);
if ($payload['rub'] === null) {
    json_out(404, ['success' => false, 'error' => 'Rub catalog is not available on this server.']);
}

$rub = $payload['rub'];
$today = date('Y-m-d');
$tafsir = rh_rub_tafsir($rubId);

$verses = [];
$allowedLookup = [];
foreach ($payload['verses'] as $verse) {
    $key = $verse['surah'] . ':' . $verse['ayah'];
    $allowedLookup[$key] = true;

    $words = [];
    foreach ($verse['words'] as $index => $word) {
        $words[] = ['i' => (int) $index, 'text' => (string) $word];
    }

    $verse['key'] = $key;
    // Compute decoys while `words` is still the plain string list.
    $verse['distractors'] = rh_rub_distractors($rubId, $verse, 3);
    $verse['words'] = $words;
    $verse['tafsir_ar'] = (string) ($tafsir[$key]['ar'] ?? '');
    $verse['tafsir_en'] = (string) ($tafsir[$key]['en'] ?? '');
    unset($verse['has_rub_mark'], $verse['has_sajdah']);
    $verses[] = $verse;
}

// completed_stations now holds verse keys ("surah:ayah"). Old station keys
// ("surah:ayah:index") are ignored, so legacy progress starts clean.
$completed = [];
if ($task !== null && !empty($task['completed_stations'])) {
    $decoded = json_decode((string) $task['completed_stations'], true);
    if (is_array($decoded)) {
        $seen = [];
        foreach ($decoded as $key) {
            if (!is_string($key) || !isset($allowedLookup[$key]) || isset($seen[$key])) {
                continue;
            }
            $seen[$key] = true;
            $completed[] = $key;
        }
        $order = array_keys($allowedLookup);
        usort($completed, static function (string $a, string $b) use ($order): int {
            return array_search($a, $order, true) <=> array_search($b, $order, true);
        });
    }
}

json_out(200, [
    'success' => true,
    'today'   => $today,
    'task'    => $task === null ? null : [
        'id'               => (int) $task['id'],
        'task_date'        => (string) $task['task_date'],
        'is_today'         => (string) $task['task_date'] === $today,
        'is_completed'     => (int) $task['is_completed'] === 1,
        'rub_id'           => (int) $task['rub_id'],
        'completed_verses' => $completed,
        'carried_over'     => (int) ($task['rollover_count'] ?? 0) > 0
            || (string) $task['task_date'] !== $today,
        'rollover_count'   => (int) ($task['rollover_count'] ?? 0),
        'last_rollover_date' => $task['last_rollover_date'] ?? null,
    ],
    'rub' => [
        'id'          => (int) $rub['id'],
        'juz'         => (int) $rub['juz'],
        'hizb'        => (int) $rub['hizb'],
        'start'       => $rub['start'],
        'end'         => $rub['end'],
        'start_page'  => (int) $rub['start_page'],
        'end_page'    => (int) $rub['end_page'],
        'verse_count' => count($verses),
    ],
    'completed_verses' => $completed,
    'verses'           => $verses,
]);
