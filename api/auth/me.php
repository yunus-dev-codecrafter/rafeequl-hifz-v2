<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Current session user.
 *
 * GET -> { success, user } for the authenticated account, or 401.
 * Side-effect free (unlike tasks/get_daily_tasks.php, which may create rows).
 */

require __DIR__ . '/../../config/auth.php';

$user = rh_require_login($pdo);

rh_json_out(200, [
    'success' => true,
    'user' => [
        'id'                   => (int) $user['id'],
        'name'                 => (string) $user['name'],
        'email'                => (string) $user['email'],
        'user_type'            => (string) $user['user_type'],
        'role'                 => (string) $user['role'],
        'status'               => (string) $user['status'],
        'must_change_password' => (int) $user['must_change_password'] === 1,
        'current_hifz_page'    => (int) $user['current_hifz_page'],
        'last_login_at'        => $user['last_login_at'] !== null ? (string) $user['last_login_at'] : null,
        'last_seen_at'         => $user['last_seen_at'] !== null ? (string) $user['last_seen_at'] : null,
    ],
]);
