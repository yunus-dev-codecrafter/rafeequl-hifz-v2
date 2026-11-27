<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Prayer Recitation Status Update (تحديث نتيجة تلاوة الصلاة)
 * POST JSON: recitation_id, status ('MASTERED' or 'PENDING_RETRY')
 */

require __DIR__ . '/../../config/database.php';
require_once __DIR__ . '/../../config/auth.php';
require_once __DIR__ . '/_prayer_helpers.php';

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

$authUser = rh_require_login($pdo);
$userId   = (int) $authUser['id'];

$raw = file_get_contents('php://input');
$input = $_POST;
if (is_string($raw) && $raw !== '') {
    $dec = json_decode($raw, true);
    if (is_array($dec)) {
        $input = array_merge($input, $dec);
    }
}

$recitationId = (int) ($input['recitation_id'] ?? 0);
$status = strtoupper((string) ($input['status'] ?? ''));

if ($recitationId < 1 || !in_array($status, ['MASTERED', 'PENDING_RETRY'], true)) {
    json_out(400, [
        'success' => false,
        'error'   => 'recitation_id must be a positive integer, and status must be MASTERED or PENDING_RETRY.',
    ]);
}

try {
    $stmt = $pdo->prepare(
        'SELECT `id`, `attempts`, `cycle_number` FROM `prayer_recitations` WHERE `id` = :id AND `user_id` = :u'
    );
    $stmt->execute([':id' => $recitationId, ':u' => $userId]);
    $row = $stmt->fetch();
    if (!$row) {
        json_out(404, ['success' => false, 'error' => 'Recitation record not found.']);
    }

    $attempts = (int) $row['attempts'];
    if ($status === 'PENDING_RETRY') {
        $attempts++;
    }

    $cycleNum = (int) ($row['cycle_number'] ?? 1);

    $upd = $pdo->prepare(
        'UPDATE `prayer_recitations`
         SET `status` = :st, `attempts` = :att, `last_recited_at` = NOW()
         WHERE `id` = :id AND `user_id` = :u'
    );
    $upd->execute([
        ':st'  => $status,
        ':att' => $attempts,
        ':id'  => $recitationId,
        ':u'   => $userId,
    ]);

    // Compute updated cycle stats after status change
    $cycleStats = rh_prayer_get_cycle_stats($pdo, $userId, $cycleNum);

    json_out(200, [
        'success'  => true,
        'status'   => $status,
        'attempts' => $attempts,
        'cycle'    => $cycleStats,
        'message'  => ($status === 'MASTERED')
            ? 'ما شاء الله! هنيئاً لك إتقان التلاوة في صلاتك، تقبل الله طاعتك.'
            : 'أحسنت المحاولة! تم حفظ هذه الآيات في قائمة مراجعة الصلاة لتعاود قراءتها في صلاتك القادمة بإذن الله.',
    ]);
} catch (Throwable $t) {
    error_log('[Prayer Update Error] ' . $t->getMessage());
    json_out(500, ['success' => false, 'error' => 'تعذر تحديث حالة التلاوة: ' . $t->getMessage()]);
}
