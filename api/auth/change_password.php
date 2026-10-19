<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Change own password.
 *
 * POST JSON: current_password, new_password
 * Any authenticated account may change its own password. Used for the forced
 * first-login change (must_change_password) and by the account settings UI.
 */

require __DIR__ . '/../../config/auth.php';

$user = rh_require_login($pdo);

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    rh_json_out(400, ['success' => false, 'error' => 'Method not allowed. Use POST.']);
}

$raw  = file_get_contents('php://input');
$data = json_decode((string) $raw, true);
if (!is_array($data)) {
    rh_json_out(400, ['success' => false, 'error' => 'Invalid JSON payload.']);
}

$current = (string) ($data['current_password'] ?? '');
$new     = (string) ($data['new_password'] ?? '');

$errors = [];
if ($current === '') {
    $errors['current_password'] = 'Current password is required.';
}
if (strlen($new) < 8) {
    $errors['new_password'] = 'New password must be at least 8 characters.';
}
if ($new !== '' && $new === $current) {
    $errors['new_password'] = 'New password must be different from the current one.';
}
if ($errors) {
    rh_json_out(400, ['success' => false, 'errors' => $errors]);
}

try {
    $stmt = $pdo->prepare('SELECT `password_hash` FROM `users` WHERE `id` = :id LIMIT 1');
    $stmt->execute([':id' => (int) $user['id']]);
    $hash = $stmt->fetchColumn();

    if (!$hash || !password_verify($current, (string) $hash)) {
        rh_json_out(401, ['success' => false, 'error' => 'Current password is incorrect.']);
    }

    $pdo->prepare('UPDATE `users` SET `password_hash` = :h, `must_change_password` = 0 WHERE `id` = :id')
        ->execute([':h' => password_hash($new, PASSWORD_DEFAULT), ':id' => (int) $user['id']]);

    rh_json_out(200, ['success' => true]);
} catch (Throwable $e) {
    error_log('[ChangePassword Failed] ' . $e->getMessage());
    rh_json_out(500, ['success' => false, 'error' => 'Server error. Please try again.']);
}
