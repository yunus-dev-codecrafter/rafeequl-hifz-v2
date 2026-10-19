<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Undo the last review action (session safety net)
 * POST JSON: user_id, mistake_id (optional - if given, undo only if the last
 *            review event belongs to that card)
 *
 * Restores the scheduling snapshot stored on the most recent review event and
 * removes that event, so the card returns to the deck with its prior state.
 */

require __DIR__ . '/../../config/database.php';
require __DIR__ . '/_srs.php';

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

require_once __DIR__ . '/../../config/auth.php';

// Session is authoritative. A client-supplied user_id is accepted only from an
// administrator (so the admin panel can act on other accounts).
$authUser = rh_require_login($pdo);
$userId   = rh_resolve_user_id($pdo, $authUser, $input['user_id'] ?? null);

$wantMistakeId = $input['mistake_id'] ?? null;
if (is_string($wantMistakeId) && ctype_digit($wantMistakeId)) {
    $wantMistakeId = (int) $wantMistakeId;
}
if ($wantMistakeId !== null && (!is_int($wantMistakeId) || $wantMistakeId < 1)) {
    $wantMistakeId = null;
}

try {
    $sql = "SELECT `id`, `mistake_id`, `prev_state`, `created_at`
            FROM `mistake_events`
            WHERE `user_id` = :u
              AND `prev_state` IS NOT NULL
              AND `event_type` IN ('AGAIN','HARD','GOOD','EASY','MASTERED')
              AND `created_at` >= (NOW() - INTERVAL 30 MINUTE)";
    $params = [':u' => $userId];
    if ($wantMistakeId !== null) {
        $sql .= ' AND `mistake_id` = :m';
        $params[':m'] = $wantMistakeId;
    }
    $sql .= ' ORDER BY `id` DESC LIMIT 1';

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $event = $stmt->fetch();

    if (!$event || !$event['prev_state']) {
        json_out(400, ['success' => false, 'error' => 'Nothing to undo.']);
    }

    $prev = json_decode((string) $event['prev_state'], true) ?: [];
    $mistakeId = $event['mistake_id'] !== null ? (int) $event['mistake_id'] : null;
    if ($mistakeId === null) {
        json_out(400, ['success' => false, 'error' => 'Nothing to undo.']);
    }

    $stmt = $pdo->prepare(
        "UPDATE `mistakes`
         SET `status`           = :status,
             `mastery_count`    = :mc,
             `occurrence_count` = :oc,
             `interval_days`    = :iv,
             `ease`             = :ez,
             `lapses`           = :lp,
             `streak_correct`   = :st,
             `due_at`           = :due,
             `last_reviewed_at` = :lr,
             `graduated_at`     = :grad
         WHERE `id` = :id AND `user_id` = :u"
    );
    $stmt->execute([
        ':status' => $prev['status'] ?? 'ACTIVE',
        ':mc'     => $prev['mastery_count'] ?? 0,
        ':oc'     => $prev['occurrence_count'] ?? 1,
        ':iv'     => $prev['interval_days'] ?? 0,
        ':ez'     => $prev['ease'] ?? 2.5,
        ':lp'     => $prev['lapses'] ?? 0,
        ':st'     => $prev['streak_correct'] ?? 0,
        ':due'    => $prev['due_at'] ?? null,
        ':lr'     => $prev['last_reviewed_at'] ?? null,
        ':grad'   => $prev['graduated_at'] ?? null,
        ':id'     => $mistakeId,
        ':u'      => $userId,
    ]);

    $pdo->prepare('DELETE FROM `mistake_events` WHERE `id` = :id AND `user_id` = :u')
        ->execute([':id' => (int) $event['id'], ':u' => $userId]);

    json_out(200, [
        'success'    => true,
        'mistake_id' => $mistakeId,
        'mistake'    => [
            'id'            => $mistakeId,
            'status'        => $prev['status'] ?? 'ACTIVE',
            'interval_days' => $prev['interval_days'] ?? 0,
            'mastery_count' => $prev['mastery_count'] ?? 0,
            'due_at'        => $prev['due_at'] ?? null,
        ],
    ], JSON_UNESCAPED_UNICODE);
} catch (PDOException $e) {
    error_log('[UndoReview Failed] ' . $e->getMessage());
    json_out(500, ['success' => false, 'error' => 'Server error. Please try again.']);
}
