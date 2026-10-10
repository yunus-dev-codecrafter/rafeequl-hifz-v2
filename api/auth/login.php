<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - User Login
 * POST JSON: email, password
 * Verifies credentials, starts session, returns user payload.
 */

require __DIR__ . '/../../config/database.php';

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
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => 'Invalid email or password.'], JSON_UNESCAPED_UNICODE);
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

// --- Session --------------------------------------------------------------

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}
$_SESSION['user_id'] = (int) $user['id'];

// --- Response -------------------------------------------------------------

http_response_code(200);
echo json_encode([
    'success' => true,
    'user' => [
        'id'                          => (int) $user['id'],
        'name'                        => $user['name'],
        'email'                       => $user['email'],
        'user_type'                   => $user['user_type'],
        'current_hifz_page'           => (int) $user['current_hifz_page'],
        'daily_murajaah_target_pages' => (int) $user['daily_murajaah_target_pages'],
    ],
], JSON_UNESCAPED_UNICODE);
