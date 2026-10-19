<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Central authentication & authorization guard.
 *
 * This is the single source of truth for "who is calling". Every API endpoint
 * should require this file and call one of:
 *
 *     $user   = rh_require_login($pdo);        // any active account
 *     $user   = rh_require_admin($pdo);        // ADMIN or SUPER_ADMIN
 *     $user   = rh_require_super_admin($pdo);  // SUPER_ADMIN only
 *     $userId = rh_resolve_user_id($pdo, $user, $input['user_id'] ?? null);
 *
 * Design notes:
 *  - The session is authoritative. A client-supplied `user_id` is only honoured
 *    for administrators, which closes the previous IDOR hole.
 *  - Account `status` is re-read from the database on EVERY request, so
 *    suspending an account takes effect immediately (even mid-session).
 *  - Everything degrades gracefully before migration v4 has been applied: the
 *    missing `role` / `status` columns are treated as 'USER' / 'ACTIVE'.
 */

require_once __DIR__ . '/database.php';

/** JSON response helper (namespaced to avoid clashing with local json_out()). */
function rh_json_out(int $code, array $payload): void
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

/** Start the session with hardened cookie flags. */
function rh_session_start(): void
{
    if (session_status() !== PHP_SESSION_NONE) {
        return;
    }

    $https = (!empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https')
        || ((string) ($_SERVER['SERVER_PORT'] ?? '') === '443');

    if (PHP_VERSION_ID >= 70300) {
        session_set_cookie_params([
            'lifetime' => 0,
            'path'     => '/',
            'httponly' => true,
            'secure'   => $https,
            'samesite' => 'Lax',
        ]);
    } else {
        session_set_cookie_params(0, '/', '', $https, true);
    }

    session_start();
}

/** The caller's IP (best effort) - used for audit + login throttling. */
function rh_client_ip(): string
{
    return substr((string) ($_SERVER['REMOTE_ADDR'] ?? ''), 0, 45);
}

/** Cached list of `users` column names (lower-cased). */
function rh_users_columns(PDO $pdo): array
{
    static $cols = null;
    if ($cols !== null) {
        return $cols;
    }
    $cols = [];
    try {
        foreach ($pdo->query('SHOW COLUMNS FROM `users`') as $row) {
            $cols[] = strtolower((string) $row['Field']);
        }
    } catch (Throwable $t) {
        $cols = [];
    }
    return $cols;
}

/** Whether a table exists (cached per request). */
function rh_table_exists(PDO $pdo, string $table): bool
{
    static $cache = [];
    $key = strtolower($table);
    if (array_key_exists($key, $cache)) {
        return $cache[$key];
    }
    try {
        $stmt = $pdo->prepare(
            'SELECT 1 FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t LIMIT 1'
        );
        $stmt->execute([':t' => $table]);
        return $cache[$key] = (bool) $stmt->fetchColumn();
    } catch (Throwable $t) {
        return $cache[$key] = false;
    }
}

/**
 * Load the authenticated user fresh from the database, or null when there is
 * no valid session. Tolerates a database that has not run migration v4 yet.
 */
function rh_current_user(PDO $pdo): ?array
{
    rh_session_start();

    $id = $_SESSION['user_id'] ?? null;
    if ($id === null || $id === '' || !filter_var($id, FILTER_VALIDATE_INT)) {
        return null;
    }
    $id = (int) $id;
    if ($id <= 0) {
        return null;
    }

    $cols = rh_users_columns($pdo);
    $has  = static fn(string $c): bool => in_array($c, $cols, true);

    $select = '`id`, `name`, `email`, `user_type`, `current_hifz_page`';
    $select .= $has('role') ? ', `role`' : ", 'USER' AS `role`";
    $select .= $has('status') ? ', `status`' : ", 'ACTIVE' AS `status`";
    $select .= $has('must_change_password') ? ', `must_change_password`' : ', 0 AS `must_change_password`';
    $select .= $has('last_login_at') ? ', `last_login_at`' : ', NULL AS `last_login_at`';
    $select .= $has('last_seen_at') ? ', `last_seen_at`' : ', NULL AS `last_seen_at`';

    try {
        $stmt = $pdo->prepare("SELECT $select FROM `users` WHERE `id` = :id LIMIT 1");
        $stmt->execute([':id' => $id]);
        $user = $stmt->fetch();
    } catch (Throwable $t) {
        error_log('[Auth current_user] ' . $t->getMessage());
        return null;
    }

    return $user ?: null;
}

/** Drop the current session entirely (used for hard deactivation + logout). */
function rh_destroy_session(): void
{
    $_SESSION = [];
    if (session_status() === PHP_SESSION_ACTIVE) {
        if (ini_get('session.use_cookies')) {
            $p = session_get_cookie_params();
            setcookie(
                session_name(),
                '',
                time() - 42000,
                $p['path'] ?? '/',
                $p['domain'] ?? '',
                (bool) ($p['secure'] ?? false),
                (bool) ($p['httponly'] ?? true)
            );
        }
        session_destroy();
    }
}

/**
 * Record activity for usage analytics. Throttled to once per 5 minutes per
 * session so it stays cheap. Never throws.
 */
function rh_touch_activity(PDO $pdo, int $userId): void
{
    $now  = time();
    $last = (int) ($_SESSION['rh_activity_ts'] ?? 0);
    if ($now - $last < 300) {
        return;
    }
    $_SESSION['rh_activity_ts'] = $now;

    if (in_array('last_seen_at', rh_users_columns($pdo), true)) {
        try {
            $pdo->prepare('UPDATE `users` SET `last_seen_at` = NOW() WHERE `id` = :id')
                ->execute([':id' => $userId]);
        } catch (Throwable $t) {
            // ignore
        }
    }

    if (rh_table_exists($pdo, 'user_activity')) {
        try {
            $pdo->prepare(
                'INSERT INTO `user_activity`
                    (`user_id`, `activity_date`, `first_seen_at`, `last_seen_at`, `hits`)
                 VALUES (:u, CURDATE(), NOW(), NOW(), 1)
                 ON DUPLICATE KEY UPDATE `last_seen_at` = NOW(), `hits` = `hits` + 1'
            )->execute([':u' => $userId]);
        } catch (Throwable $t) {
            // ignore
        }
    }
}

/** Require any active account. Responds (and exits) otherwise. */
function rh_require_login(PDO $pdo): array
{
    $user = rh_current_user($pdo);

    if (!$user) {
        rh_json_out(401, ['success' => false, 'error' => 'Authentication required.']);
    }

    if (strtoupper((string) $user['status']) !== 'ACTIVE') {
        rh_destroy_session();
        rh_json_out(403, [
            'success' => false,
            'error'   => 'This account is not active. Please contact the administrator.',
            'code'    => 'ACCOUNT_INACTIVE',
        ]);
    }

    rh_touch_activity($pdo, (int) $user['id']);
    return $user;
}

/** Require ADMIN or SUPER_ADMIN. */
function rh_require_admin(PDO $pdo): array
{
    $user = rh_require_login($pdo);
    $role = strtoupper((string) $user['role']);
    if ($role !== 'ADMIN' && $role !== 'SUPER_ADMIN') {
        rh_json_out(403, ['success' => false, 'error' => 'Administrator access required.']);
    }
    return $user;
}

/** Require SUPER_ADMIN. */
function rh_require_super_admin(PDO $pdo): array
{
    $user = rh_require_admin($pdo);
    if (strtoupper((string) $user['role']) !== 'SUPER_ADMIN') {
        rh_json_out(403, ['success' => false, 'error' => 'Super administrator access required.']);
    }
    return $user;
}

/** True when the account may act on other accounts. */
function rh_is_admin(array $user): bool
{
    $role = strtoupper((string) ($user['role'] ?? 'USER'));
    return $role === 'ADMIN' || $role === 'SUPER_ADMIN';
}

/**
 * Resolve the effective user id for a user-scoped request.
 *
 * The session user always wins. A different `user_id` in the request is only
 * accepted from an administrator; everyone else gets 403. This is what closes
 * the old "pass any user_id" hole.
 */
function rh_resolve_user_id(PDO $pdo, array $user, $inputUserId = null): int
{
    $sessionId = (int) $user['id'];

    if ($inputUserId === null || $inputUserId === '') {
        return $sessionId;
    }
    if (!filter_var($inputUserId, FILTER_VALIDATE_INT)) {
        rh_json_out(400, ['success' => false, 'error' => 'Invalid user_id.']);
    }

    $inputId = (int) $inputUserId;
    if ($inputId === $sessionId) {
        return $sessionId;
    }
    if (rh_is_admin($user)) {
        return $inputId;
    }

    rh_json_out(403, ['success' => false, 'error' => 'You may only access your own account.']);
    return $sessionId; // unreachable
}

/** Append an administrator action to the audit trail. Never throws. */
function rh_audit(PDO $pdo, int $adminId, string $action, ?int $targetId = null, array $details = []): void
{
    if (!rh_table_exists($pdo, 'admin_audit')) {
        return;
    }
    try {
        $pdo->prepare(
            'INSERT INTO `admin_audit`
                (`admin_user_id`, `action`, `target_user_id`, `details`, `ip`)
             VALUES (:a, :act, :t, :d, :ip)'
        )->execute([
            ':a'   => $adminId,
            ':act' => $action,
            ':t'   => $targetId,
            ':d'   => $details ? json_encode($details, JSON_UNESCAPED_UNICODE) : null,
            ':ip'  => rh_client_ip(),
        ]);
    } catch (Throwable $t) {
        // ignore
    }
}

/* -------------------------------------------------------------------------
   Login throttling (only active once migration v4 created the table)
   ------------------------------------------------------------------------- */

const RH_LOGIN_MAX_ATTEMPTS = 8;
const RH_LOGIN_WINDOW_SECS  = 900; // 15 minutes

/** Seconds the caller must wait, or 0 when not blocked. */
function rh_login_blocked_for(PDO $pdo, string $email): int
{
    if (!rh_table_exists($pdo, 'login_attempts')) {
        return 0;
    }
    try {
        $stmt = $pdo->prepare('SELECT `attempts`, `last_attempt_at` FROM `login_attempts` WHERE `email` = :e LIMIT 1');
        $stmt->execute([':e' => $email]);
        $row = $stmt->fetch();
        if (!$row) {
            return 0;
        }
        $attempts = (int) $row['attempts'];
        $last     = strtotime((string) $row['last_attempt_at']) ?: 0;
        $elapsed  = time() - $last;
        if ($attempts >= RH_LOGIN_MAX_ATTEMPTS && $elapsed < RH_LOGIN_WINDOW_SECS) {
            return RH_LOGIN_WINDOW_SECS - $elapsed;
        }
        return 0;
    } catch (Throwable $t) {
        return 0;
    }
}

function rh_login_record_failure(PDO $pdo, string $email): void
{
    if (!rh_table_exists($pdo, 'login_attempts')) {
        return;
    }
    try {
        $pdo->prepare(
            'INSERT INTO `login_attempts` (`email`, `ip`, `attempts`, `last_attempt_at`)
             VALUES (:e, :ip, 1, NOW())
             ON DUPLICATE KEY UPDATE `attempts` = `attempts` + 1, `ip` = :ip2, `last_attempt_at` = NOW()'
        )->execute([':e' => $email, ':ip' => rh_client_ip(), ':ip2' => rh_client_ip()]);
    } catch (Throwable $t) {
        // ignore
    }
}

function rh_login_clear(PDO $pdo, string $email): void
{
    if (!rh_table_exists($pdo, 'login_attempts')) {
        return;
    }
    try {
        $pdo->prepare('DELETE FROM `login_attempts` WHERE `email` = :e')->execute([':e' => $email]);
    } catch (Throwable $t) {
        // ignore
    }
}
