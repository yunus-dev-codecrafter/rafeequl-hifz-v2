<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Clear / Manage Flashcard (History actions)
 * POST JSON: mistake_id, action ('MASTERED' | 'KEEP_PRACTICING' | 'REACTIVATE' | 'DELETE')
 *
 * MASTERED        -> archives the card (graduated_at set), records MASTERED event
 * REACTIVATE      -> returns it to the active deck, due immediately
 * DELETE          -> hard-deletes the row, keeps a DELETED audit event
 * KEEP_PRACTICING -> stays active, mastery_count + 1 (legacy)
 *
 * Graded practice should use review_mistake.php; this endpoint powers the
 * history page's management buttons.
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

function fetchMistake(PDO $pdo, int $userId, int $mistakeId): ?array
{
    $stmt = $pdo->prepare('SELECT * FROM `mistakes` WHERE `id` = :id AND `user_id` = :u');
    $stmt->execute([':id' => $mistakeId, ':u' => $userId]);
    $row = $stmt->fetch();
    return $row ?: null;
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

$mistakeId = $input['mistake_id'] ?? null;
if (is_string($mistakeId) && ctype_digit($mistakeId)) {
    $mistakeId = (int) $mistakeId;
}
if (!is_int($mistakeId) || $mistakeId < 1) {
    json_out(400, ['success' => false, 'errors' => ['mistake_id' => 'mistake_id must be a positive integer.']]);
}

$action = (string) ($input['action'] ?? '');
if (!in_array($action, ['MASTERED', 'KEEP_PRACTICING', 'REACTIVATE', 'DELETE'], true)) {
    json_out(400, [
        'success' => false,
        'errors'  => ['action' => "action must be 'MASTERED', 'KEEP_PRACTICING', 'REACTIVATE', or 'DELETE'."],
    ]);
}

try {
    $mistake = fetchMistake($pdo, $userId, $mistakeId);
    if (!$mistake) {
        json_out(400, ['success' => false, 'error' => 'Mistake not found.']);
    }

    if ($action === 'DELETE') {
        srs_log_event($pdo, $userId, $mistakeId, 'DELETED');
        $stmt = $pdo->prepare('DELETE FROM `mistakes` WHERE `id` = :id AND `user_id` = :u');
        $stmt->execute([':id' => $mistakeId, ':u' => $userId]);
        json_out(200, [
            'success'    => true,
            'message'    => 'تم حذف البطاقة وسجل الخطأ نهائياً بنجاح.',
            'deleted_id' => $mistakeId,
            'action'     => 'DELETE',
        ]);
    }

    $alreadyProcessed = false;

    if ($action === 'MASTERED') {
        if ($mistake['status'] === 'ARCHIVED') {
            $alreadyProcessed = true;
        } else {
            $stmt = $pdo->prepare(
                "UPDATE `mistakes`
                 SET `status` = 'ARCHIVED', `mastery_count` = `mastery_count` + 1,
                     `graduated_at` = NOW()
                 WHERE `id` = :id AND `user_id` = :u AND `status` = 'ACTIVE'"
            );
            $stmt->execute([':id' => $mistakeId, ':u' => $userId]);
            srs_log_event($pdo, $userId, $mistakeId, 'MASTERED',
                SRS_GRADES['EASY'], (int) $mistake['interval_days'], (int) $mistake['interval_days'],
                srs_prev_state($mistake));
            $mistake['status']        = 'ARCHIVED';
            $mistake['mastery_count'] = (int) $mistake['mastery_count'] + 1;
        }
    } elseif ($action === 'REACTIVATE') {
        $stmt = $pdo->prepare(
            "UPDATE `mistakes`
             SET `status` = 'ACTIVE', `graduated_at` = NULL, `due_at` = NOW(),
                 `interval_days` = 0, `streak_correct` = 0
             WHERE `id` = :id AND `user_id` = :u"
        );
        $stmt->execute([':id' => $mistakeId, ':u' => $userId]);
        srs_log_event($pdo, $userId, $mistakeId, 'REACTIVATED');
        $mistake['status']      = 'ACTIVE';
        $mistake['due_at']      = date('Y-m-d H:i:s');
        $mistake['interval_days'] = 0;
    } else { // KEEP_PRACTICING (legacy)
        if ($mistake['status'] === 'ARCHIVED') {
            json_out(400, ['success' => false, 'error' => 'Mistake is already archived.']);
        }
        $stmt = $pdo->prepare(
            "UPDATE `mistakes`
             SET `mastery_count` = `mastery_count` + 1, `due_at` = NOW()
             WHERE `id` = :id AND `user_id` = :u AND `status` = 'ACTIVE'"
        );
        $stmt->execute([':id' => $mistakeId, ':u' => $userId]);
        srs_log_event($pdo, $userId, $mistakeId, 'HARD', SRS_GRADES['HARD']);
        $mistake['mastery_count'] = (int) $mistake['mastery_count'] + 1;
    }

    json_out(200, [
        'success'           => true,
        'message'           => $action === 'MASTERED'
            ? 'Mistake archived. Row preserved in history.'
            : 'Card kept in the active practice queue.',
        'already_processed' => $alreadyProcessed,
        'mistake'           => [
            'id'            => (int) $mistake['id'],
            'page_number'   => (int) $mistake['page_number'],
            'surah_number'  => (int) $mistake['surah_number'],
            'ayah_number'   => (int) $mistake['ayah_number'],
            'mistake_type'  => $mistake['mistake_type'],
            'status'        => $mistake['status'],
            'mastery_count' => (int) $mistake['mastery_count'],
        ],
    ]);
} catch (PDOException $e) {
    error_log('[ClearMistake Failed] ' . $e->getMessage());
    json_out(500, ['success' => false, 'error' => 'Server error. Please try again.']);
}
