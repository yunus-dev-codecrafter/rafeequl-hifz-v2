<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Admin: activate / suspend / disable an account.
 *
 * POST JSON: user_id, status (ACTIVE|SUSPENDED|DISABLED), reason (optional)
 * SUPER_ADMIN only.
 *
 * Deactivation is authoritative: the guard re-checks `status` on every request,
 * so an affected user is locked out immediately - even mid-session.
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
$status   = strtoupper(trim((string) ($input['status'] ?? '')));
$reason   = trim((string) ($input['reason'] ?? ''));

if (!filter_var($targetId, FILTER_VALIDATE_INT)) {
    rh_json_out(400, ['success' => false, 'error' => 'A valid user_id is required.']);
}
$targetId = (int) $targetId;

if (!in_array($status, ['ACTIVE', 'SUSPENDED', 'DISABLED'], true)) {
    rh_json_out(400, ['success' => false, 'error' => 'status must be ACTIVE, SUSPENDED or DISABLED.']);
}
$reasonLength = function_exists('mb_strlen') ? mb_strlen($reason) : strlen($reason);
if ($reasonLength > 255) {
    rh_json_out(400, ['success' => false, 'error' => 'reason must be at most 255 characters.']);
}

if ($targetId === (int) $admin['id']) {
    rh_json_out(400, ['success' => false, 'error' => 'You cannot change the status of your own account.']);
}

try {
    $stmt = $pdo->prepare('SELECT `id`, `name`, `email`, `role`, `status` FROM `users` WHERE `id` = :id LIMIT 1');
    $stmt->execute([':id' => $targetId]);
    $target = $stmt->fetch();
    if (!$target) {
        rh_json_out(404, ['success' => false, 'error' => 'User not found.']);
    }

    // Never allow locking out the last active super administrator.
    if ($status !== 'ACTIVE' && strtoupper((string) $target['role']) === 'SUPER_ADMIN') {
        $stmt = $pdo->prepare(
            "SELECT COUNT(*) FROM `users`
             WHERE `role` = 'SUPER_ADMIN' AND `status` = 'ACTIVE' AND `id` <> :id"
        );
        $stmt->execute([':id' => $targetId]);
        if ((int) $stmt->fetchColumn() < 1) {
            rh_json_out(400, [
                'success' => false,
                'error'   => 'You cannot deactivate the last active super administrator.',
            ]);
        }
    }

    if ($status === 'ACTIVE') {
        $pdo->prepare(
            'UPDATE `users` SET `status` = :s, `status_reason` = NULL, `suspended_at` = NULL WHERE `id` = :id'
        )->execute([':s' => $status, ':id' => $targetId]);
    } else {
        $pdo->prepare(
            'UPDATE `users` SET `status` = :s, `status_reason` = :r, `suspended_at` = NOW() WHERE `id` = :id'
        )->execute([':s' => $status, ':r' => ($reason !== '' ? $reason : null), ':id' => $targetId]);
    }

    rh_audit($pdo, (int) $admin['id'], 'SET_STATUS', $targetId, [
        'from'   => (string) $target['status'],
        'to'     => $status,
        'reason' => $reason !== '' ? $reason : null,
        'email'  => (string) $target['email'],
    ]);

    rh_json_out(200, [
        'success' => true,
        'user'    => [
            'id'     => $targetId,
            'status' => $status,
            'reason' => $reason !== '' ? $reason : null,
        ],
    ]);
} catch (Throwable $e) {
    error_log('[AdminSetStatus Failed] ' . $e->getMessage());
    rh_json_out(500, ['success' => false, 'error' => 'Server error. Please try again.']);
}
