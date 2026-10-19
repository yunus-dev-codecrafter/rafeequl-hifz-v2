<?php
declare(strict_types=1);

/**
 * Root router for InfinityFree hosting.
 *
 * Sends each visitor to the right landing page:
 *   - no active session ......... web/index.html        (login / register)
 *   - must change password ...... web/change-password.html
 *   - administrator ............. web/admin.html
 *   - learner ................... web/dashboard.html
 */

require_once __DIR__ . '/config/auth.php';

$user = rh_current_user($pdo);

if (!$user || strtoupper((string) $user['status']) !== 'ACTIVE') {
    if ($user) {
        // Inactive account: end the session so the login page is clean.
        rh_destroy_session();
    }
    header('Location: web/index.html');
    exit();
}

if ((int) $user['must_change_password'] === 1) {
    header('Location: web/change-password.html');
    exit();
}

$role = strtoupper((string) $user['role']);
if ($role === 'ADMIN' || $role === 'SUPER_ADMIN') {
    header('Location: web/admin.html');
    exit();
}

header('Location: web/dashboard.html');
exit();
