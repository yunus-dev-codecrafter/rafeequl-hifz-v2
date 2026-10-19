<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Admin: change an account's role.
 *
 * POST JSON: user_id, role (USER|ADMIN|SUPER_ADMIN)
 * SUPER_ADMIN only.
 */

require __DIR__ . '/../../config/auth.php';

$admin = rh_require_super_admin($pdo);

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    rh_json_out(400, ['success' => false, 'error' => 'Method not allowed. Use POST.']);
}

$input = $_GET;
$raw   = file_get_contents('php://input');
if (is_string($raw) && $raw !== '') {
    $json = json_decode($raw, true);
    if (!is_array($json)) {
        rh_json_out(400, ['success' => false, 'error' => 'Invalid JSON payload.']);
    }
    $input = array_merge($input, $json);
}

$targetId = $input['user_id'] ?? null;
$role     = strtoupper(trim((string) ($input['role'] ?? '')));

if (!filter_var($targetId, FILTER_VALIDATE_INT)) {
    rh_json_out(400, ['success' => false, 'error' => 'A valid user_id is required.']);
}
$targetId = (int) $targetId;

if (!in_array($role, ['USER', 'ADMIN', 'SUPER_ADMIN'], true)) {
    rh_json_out(400, ['success' => false, 'error' => 'role must be USER, ADMIN or SUPER_ADMIN.']);
}

if ($targetId === (int) $admin['id']) {
    rh_json_out(400, ['success' => false, 'error' => 'You cannot change your own role.']);
}

try {
    $stmt = $pdo->prepare('SELECT `id`, `name`, `email`, `role` FROM `users` WHERE `id` = :id LIMIT 1');
    $stmt->execute([':id' => $targetId]);
    $target = $stmt->fetch();
    if (!$target) {
        rh_json_out(404, ['success' => false, 'error' => 'User not found.']);
    }

    // Never allow demoting the last super administrator.
    if (strtoupper((string) $target['role']) === 'SUPER_ADMIN' && $role !== 'SUPER_ADMIN') {
        $stmt = $pdo->prepare(
            "SELECT COUNT(*) FROM `users`
             WHERE `role` = 'SUPER_ADMIN' AND `status` = 'ACTIVE' AND `id` <> :id"
        );
        $stmt->execute([':id' => $targetId]);
        if ((int) $stmt->fetchColumn() < 1) {
            rh_json_out(400, [
                'success' => false,
                'error'   => 'You cannot demote the last active super administrator.',
            ]);
        }
    }

    $pdo->prepare('UPDATE `users` SET `role` = :r WHERE `id` = :id')
        ->execute([':r' => $role, ':id' => $targetId]);

    rh_audit($pdo, (int) $admin['id'], 'SET_ROLE', $targetId, [
        'from'  => (string) $target['role'],
        'to'    => $role,
        'email' => (string) $target['email'],
    ]);

    rh_json_out(200, [
        'success' => true,
        'user'    => ['id' => $targetId, 'role' => $role],
    ]);
} catch (Throwable $e) {
    error_log('[AdminSetRole Failed] ' . $e->getMessage());
    rh_json_out(500, ['success' => false, 'error' => 'Server error. Please try again.']);
}
