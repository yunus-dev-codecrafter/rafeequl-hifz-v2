<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - User Login
 * POST JSON: email, password
 * Verifies credentials, enforces account status, starts a hardened session and
 * returns the user payload (including role).
 */

require __DIR__ . '/../../config/database.php';
require_once __DIR__ . '/../../config/auth.php';

header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Method not allowed. Use POST.'], JSON_UNESCAPED_UNICODE);
    exit;
}

$raw  = file_get_contents('php://input');
$data = json_decode($raw, true);

if (!is_array($data)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Invalid JSON payload.'], JSON_UNESCAPED_UNICODE);
    exit;
}

$email    = trim((string) ($data['email'] ?? ''));
$password = (string) ($data['password'] ?? '');

$errors = [];
if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    $errors['email'] = 'A valid email is required.';
}
if ($password === '') {
    $errors['password'] = 'Password is required.';
}
if ($errors) {
    http_response_code(400);
    echo json_encode(['success' => false, 'errors' => $errors], JSON_UNESCAPED_UNICODE);
    exit;
}

// --- Brute-force throttle -------------------------------------------------

$wait = rh_login_blocked_for($pdo, $email);
if ($wait > 0) {
    http_response_code(429);
    echo json_encode([
        'success' => false,
        'error'   => 'Too many failed attempts. Please try again in ' . (int) ceil($wait / 60) . ' minute(s).',
        'code'    => 'RATE_LIMITED',
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// --- Fetch user by email --------------------------------------------------

try {
    $stmt = $pdo->prepare('SELECT * FROM `users` WHERE `email` = :email LIMIT 1');
    $stmt->execute([':email' => $email]);
    $user = $stmt->fetch();
} catch (PDOException $e) {
    error_log('[Login Failed] ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Server error. Please try again.'], JSON_UNESCAPED_UNICODE);
    exit;
}

// --- Verify credentials ---------------------------------------------------

if (!$user || !password_verify($password, $user['password_hash'])) {
    rh_login_record_failure($pdo, $email);
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => 'Invalid email or password.'], JSON_UNESCAPED_UNICODE);
    exit;
}

// --- Enforce account status (authoritative) -------------------------------

$status = strtoupper((string) ($user['status'] ?? 'ACTIVE'));
if ($status !== 'ACTIVE') {
    $reason = trim((string) ($user['status_reason'] ?? ''));
    http_response_code(403);
    echo json_encode([
        'success' => false,
        'error'   => $reason !== ''
            ? ('This account is not active: ' . $reason)
            : 'This account is not active. Please contact the administrator.',
        'code'    => 'ACCOUNT_INACTIVE',
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// Re-hash if the algorithm cost has changed since registration
if (password_needs_rehash($user['password_hash'], PASSWORD_DEFAULT)) {
    $rehash = $pdo->prepare('UPDATE `users` SET `password_hash` = :hash WHERE `id` = :id');
    $rehash->execute([
        ':hash' => password_hash($password, PASSWORD_DEFAULT),
        ':id'   => $user['id'],
    ]);
}

rh_login_clear($pdo, $email);

// --- Session --------------------------------------------------------------

rh_session_start();
session_regenerate_id(true); // prevent session fixation
$_SESSION['user_id'] = (int) $user['id'];
$_SESSION['rh_activity_ts'] = time();

// --- Usage tracking -------------------------------------------------------

$userCols = rh_users_columns($pdo);
$set = [];
if (in_array('last_login_at', $userCols, true)) {
    $set[] = '`last_login_at` = NOW()';
}
if (in_array('last_seen_at', $userCols, true)) {
    $set[] = '`last_seen_at` = NOW()';
}
if (in_array('login_count', $userCols, true)) {
    $set[] = '`login_count` = `login_count` + 1';
}
if ($set) {
    try {
        $pdo->prepare('UPDATE `users` SET ' . implode(', ', $set) . ' WHERE `id` = :id')
            ->execute([':id' => (int) $user['id']]);
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
        )->execute([':u' => (int) $user['id']]);
    } catch (Throwable $t) {
        // ignore
    }
}

// --- Response -------------------------------------------------------------

http_response_code(200);
echo json_encode([
    'success' => true,
    'user' => [
        'id'                          => (int) $user['id'],
        'name'                        => $user['name'],
        'email'                       => $user['email'],
        'user_type'                   => $user['user_type'],
        'role'                        => (string) ($user['role'] ?? 'USER'),
        'status'                      => $status,
        'must_change_password'        => (int) ($user['must_change_password'] ?? 0) === 1,
        'current_hifz_page'           => (int) $user['current_hifz_page'],
        'daily_murajaah_target_pages' => (int) $user['daily_murajaah_target_pages'],
    ],
], JSON_UNESCAPED_UNICODE);
