<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Clear Flashcard (Practice Result)
 * POST JSON: mistake_id, action ('MASTERED' | 'KEEP_PRACTICING')
 *
 * MASTERED        -> status ARCHIVED + mastery_count + 1 (row is never deleted)
 * KEEP_PRACTICING -> mastery_count + 1, stays ACTIVE
 */

require __DIR__ . '/../../config/database.php';

function json_out(int $code, array $payload): void
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

function fetchMistake(PDO $pdo, int $userId, int $mistakeId): ?array
{
    $stmt = $pdo->prepare(
        'SELECT `id`, `page_number`, `surah_number`, `ayah_number`, `mistake_type`,
                `notes`, `status`, `mastery_count`, `created_at`
         FROM `mistakes`
         WHERE `id` = :id AND `user_id` = :u'
    );
    $stmt->execute([':id' => $mistakeId, ':u' => $userId]);
    $row = $stmt->fetch();
    return $row ?: null;
}

function mistakePayload(array $m): array
{
    return [
        'id'            => (int) $m['id'],
        'page_number'   => (int) $m['page_number'],
        'surah_number'  => (int) $m['surah_number'],
        'ayah_number'   => (int) $m['ayah_number'],
        'mistake_type'  => $m['mistake_type'],
        'status'        => $m['status'],
        'mastery_count' => (int) $m['mastery_count'],
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
    json_out(400, [
        'success' => false,
        'errors'  => ['mistake_id' => 'mistake_id must be a positive integer.'],
    ]);
}

$action = (string) ($input['action'] ?? '');
if (!in_array($action, ['MASTERED', 'KEEP_PRACTICING', 'REACTIVATE', 'DELETE'], true)) {
    json_out(400, [
        'success' => false,
        'errors'  => ['action' => "action must be 'MASTERED', 'KEEP_PRACTICING', 'REACTIVATE', or 'DELETE'."],
    ]);
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

try {
    $mistake = fetchMistake($pdo, $userId, $mistakeId);
    if (!$mistake) {
        json_out(400, ['success' => false, 'error' => 'Mistake not found.']);
    }

    if ($action === 'DELETE') {
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
            // Idempotent: never double-increment on repeated calls
            $alreadyProcessed = true;
        } else {
            $stmt = $pdo->prepare(
                "UPDATE `mistakes`
                 SET `status` = 'ARCHIVED', `mastery_count` = `mastery_count` + 1
                 WHERE `id` = :id AND `user_id` = :u AND `status` = 'ACTIVE'"
            );
            $stmt->execute([':id' => $mistakeId, ':u' => $userId]);
            $mistake['status']        = 'ARCHIVED';
            $mistake['mastery_count'] = (int) $mistake['mastery_count'] + 1;
        }
    } elseif ($action === 'REACTIVATE') {
        $stmt = $pdo->prepare(
            "UPDATE `mistakes`
             SET `status` = 'ACTIVE'
             WHERE `id` = :id AND `user_id` = :u"
        );
        $stmt->execute([':id' => $mistakeId, ':u' => $userId]);
        $mistake['status'] = 'ACTIVE';
    } else { // KEEP_PRACTICING
        if ($mistake['status'] === 'ARCHIVED') {
            json_out(400, [
                'success' => false,
                'error'   => 'Mistake is already archived.',
            ]);
        }
        $stmt = $pdo->prepare(
            'UPDATE `mistakes`
             SET `mastery_count` = `mastery_count` + 1
             WHERE `id` = :id AND `user_id` = :u AND `status` = \'ACTIVE\''
        );
        $stmt->execute([':id' => $mistakeId, ':u' => $userId]);
        $mistake['mastery_count'] = (int) $mistake['mastery_count'] + 1;
    }

    json_out(200, [
        'success'           => true,
        'message'           => $action === 'MASTERED'
            ? 'Mistake archived. Row preserved in history.'
            : 'Card kept in the active practice queue.',
        'already_processed' => $alreadyProcessed,
        'mistake'           => mistakePayload($mistake),
    ]);
} catch (PDOException $e) {
    error_log('[ClearMistake Failed] ' . $e->getMessage());
    json_out(500, ['success' => false, 'error' => 'Server error. Please try again.']);
}
