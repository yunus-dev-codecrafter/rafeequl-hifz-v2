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

// Ensure optional columns exist in users table
try {
    $pdo->exec("ALTER TABLE `users` ADD COLUMN `murajaah_days` INT NOT NULL DEFAULT 6");
} catch (Throwable $t) {}
try {
    $pdo->exec("ALTER TABLE `users` ADD COLUMN `rabt_extra_pages` INT NOT NULL DEFAULT 0");
} catch (Throwable $t) {}

try {
    $pdo->beginTransaction();

    // 1. Delete all mistakes for this user
    $stmt = $pdo->prepare("DELETE FROM `mistakes` WHERE `user_id` = :u");
    $stmt->execute([':u' => $userId]);

    // 2. Delete all daily task logs for this user
    $stmt = $pdo->prepare("DELETE FROM `daily_task_logs` WHERE `user_id` = :u");
    $stmt->execute([':u' => $userId]);

    // 3. Reset user table fields to default baseline (0 current page, NEW user, default 6 days / 100 pages target)
    $stmt = $pdo->prepare("
        UPDATE `users`
        SET `current_hifz_page` = 0,
            `user_type` = 'NEW',
            `daily_murajaah_target_pages` = 100,
            `murajaah_days` = 6,
            `rabt_extra_pages` = 0
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
