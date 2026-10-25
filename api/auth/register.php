<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - User Registration / Onboarding
 * POST JSON: name, email, password, user_type,
 *            current_hifz_page, daily_murajaah_target_pages
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

// --- Validation -----------------------------------------------------------

$errors = [];

$name  = trim((string) ($data['name'] ?? ''));
$email = trim((string) ($data['email'] ?? ''));
$password = (string) ($data['password'] ?? '');
$userType  = (string) ($data['user_type'] ?? '');

if ($name === '' || mb_strlen($name) > 100) {
    $errors['name'] = 'Name is required (max 100 characters).';
}
if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL) || mb_strlen($email) > 255) {
    $errors['email'] = 'A valid email is required.';
}
if (strlen($password) < 8) {
    $errors['password'] = 'Password must be at least 8 characters.';
}
if (!in_array($userType, ['NEW', 'EXISTING', 'COMPLETE'], true)) {
    $errors['user_type'] = "user_type must be one of: NEW, EXISTING, COMPLETE.";
}

// --- User type logic ------------------------------------------------------

$currentPage = 0;

if ($userType === 'EXISTING') {
    $inputPage = $data['current_hifz_page'] ?? null;
    if (!is_int($inputPage) && !(is_string($inputPage) && ctype_digit($inputPage))) {
        $errors['current_hifz_page'] = "current_hifz_page is required for EXISTING users (1-604).";
    } else {
        $currentPage = (int) $inputPage;
        if ($currentPage < 1 || $currentPage > 604) {
            $errors['current_hifz_page'] = 'current_hifz_page must be between 1 and 604.';
        }
    }
} elseif ($userType === 'COMPLETE') {
    $currentPage = 604;
} else { // NEW
    $currentPage = 0;
}

// Schema changes are handled by config/migrate_v7.php (and setup.php).

$murajaahDays = $data['murajaah_days'] ?? 6;
if (is_string($murajaahDays) && ctype_digit($murajaahDays)) {
    $murajaahDays = (int) $murajaahDays;
}
if (!is_int($murajaahDays) || $murajaahDays < 1 || $murajaahDays > 6) {
    $murajaahDays = 6;
}

$dailyTarget = $data['daily_murajaah_target_pages'] ?? null;
if ($dailyTarget !== null && (is_int($dailyTarget) || (is_string($dailyTarget) && ctype_digit((string) $dailyTarget)))) {
    $dailyTarget = (int) $dailyTarget;
} else {
    // Automatically calculate from days
    $murTotal = 0;
    if ($userType === 'COMPLETE') {
        $murTotal = 604;
    } elseif ($userType === 'EXISTING' && $currentPage > 30) {
        $murTotal = max(0, $currentPage - 30);
    }
    $dailyTarget = $murTotal > 0 ? (int) ceil($murTotal / $murajaahDays) : 100;
}

if ($errors) {
    http_response_code(400);
    echo json_encode(['success' => false, 'errors' => $errors], JSON_UNESCAPED_UNICODE);
    exit;
}

// --- Insert ---------------------------------------------------------------

$passwordHash = password_hash($password, PASSWORD_DEFAULT);

$sql = 'INSERT INTO `users`
            (`name`, `email`, `password_hash`, `user_type`,
             `current_hifz_page`, `daily_murajaah_target_pages`, `murajaah_days`, `rabt_extra_pages`, `last_tikrar_page`)
        VALUES (:name, :email, :password_hash, :user_type,
                :current_hifz_page, :daily_murajaah_target_pages, :murajaah_days, 0, :last_tikrar_page)';

try {
    $stmt = $pdo->prepare($sql);
    $stmt->execute([
        ':name'                        => $name,
        ':email'                       => $email,
        ':password_hash'               => $passwordHash,
        ':user_type'                   => $userType,
        ':current_hifz_page'           => $currentPage,
        ':daily_murajaah_target_pages' => $dailyTarget,
        ':murajaah_days'               => $murajaahDays,
        ':last_tikrar_page'            => $currentPage,
    ]);
    $userId = (int) $pdo->lastInsertId();
} catch (PDOException $e) {
    if ($e->getCode() === '23000') {
        http_response_code(400);
        echo json_encode(['success' => false, 'errors' => ['email' => 'This email is already registered.']], JSON_UNESCAPED_UNICODE);
        exit;
    }
    error_log('[Register Failed] ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Server error. Please try again.'], JSON_UNESCAPED_UNICODE);
    exit;
}

// --- Session --------------------------------------------------------------

require_once __DIR__ . '/../../config/auth.php';
rh_session_start();
session_regenerate_id(true);
$_SESSION['user_id'] = $userId;
$_SESSION['rh_activity_ts'] = time();

// --- Response -------------------------------------------------------------

http_response_code(200);
echo json_encode([
    'success' => true,
    'user' => [
        'id'                          => $userId,
        'name'                        => $name,
        'email'                       => $email,
        'user_type'                   => $userType,
        'role'                        => 'USER',
        'status'                      => 'ACTIVE',
        'must_change_password'        => false,
        'current_hifz_page'           => $currentPage,
        'last_tikrar_page'            => $currentPage,
        'daily_murajaah_target_pages' => $dailyTarget,
        'murajaah_days'               => $murajaahDays,
        'rabt_extra_pages'            => 0,
    ],
], JSON_UNESCAPED_UNICODE);
