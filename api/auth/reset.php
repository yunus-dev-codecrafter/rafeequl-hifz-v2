<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Reset Account API
 * Erases all user task logs, mistakes, and resets memorization / revision progress back to initial default zero.
 * POST JSON: user_id (optional if user_id exists in session)
 */

require __DIR__ . '/../../config/database.php';

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
    if (is_array($json)) {
        $input = array_merge($input, $json);
    }
} elseif (!empty($_POST)) {
    $input = array_merge($input, $_POST);
}

require_once __DIR__ . '/../../config/auth.php';

// Session is authoritative. A client-supplied user_id is accepted only from an
// administrator (so the admin panel can act on other accounts).
$authUser = rh_require_login($pdo);
$userId   = rh_resolve_user_id($pdo, $authUser, $input['user_id'] ?? null);

// Schema changes are handled by config/migrate_v7.php (and setup.php).

try {
    $pdo->beginTransaction();

    // 1. Delete all mistakes for this user
    $stmt = $pdo->prepare("DELETE FROM `mistakes` WHERE `user_id` = :u");
    $stmt->execute([':u' => $userId]);

    // 2. Delete all daily task logs for this user
    $stmt = $pdo->prepare("DELETE FROM `daily_task_logs` WHERE `user_id` = :u");
    $stmt->execute([':u' => $userId]);

    // 2b. Clear the rub' rotation history (table may not exist on old installs)
    try {
        $stmt = $pdo->prepare("DELETE FROM `rub_history` WHERE `user_id` = :u");
        $stmt->execute([':u' => $userId]);
    } catch (Throwable $t) {}

    // 2c. Clear kalimaat progress (table may not exist before migration v10)
    try {
        $stmt = $pdo->prepare("DELETE FROM `kalimaat_progress` WHERE `user_id` = :u");
        $stmt->execute([':u' => $userId]);
    } catch (Throwable $t) {}

    // 3. Reset user table fields to default baseline (0 current page, NEW user, default 6 days / 100 pages target)
    $stmt = $pdo->prepare("
        UPDATE `users`
        SET `current_hifz_page` = 0,
            `last_tikrar_page` = 0,
            `user_type` = 'NEW',
            `daily_murajaah_target_pages` = 100,
            `murajaah_days` = 6,
            `rabt_extra_pages` = 0,
            `gate_mistake_id` = NULL,
            `gate_mistake_locked_at` = NULL
        WHERE `id` = :u
    ");
    $stmt->execute([':u' => $userId]);

    $pdo->commit();

    json_out(200, [
        'success' => true,
        'message' => 'تم تصفير وتهيئة جميع البيانات والتقدم بنجاح والعودة للبداية.',
        'user'    => [
            'id'                          => $userId,
            'user_type'                   => 'NEW',
            'current_hifz_page'           => 0,
            'last_tikrar_page'            => 0,
            'daily_murajaah_target_pages' => 100,
            'murajaah_days'               => 6,
            'rabt_extra_pages'            => 0,
        ],
    ]);
} catch (PDOException $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    error_log('[Reset Account Failed] ' . $e->getMessage());
    json_out(500, ['success' => false, 'error' => 'حدث خطأ أثناء تصفير الحساب: ' . $e->getMessage()]);
}
