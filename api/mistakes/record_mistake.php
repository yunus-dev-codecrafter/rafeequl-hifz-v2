<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Record Mistake
 * POST JSON: user_id, page_number, surah_number, ayah_number, mistake_type, notes
 * Saves an ACTIVE mistake record for later remediation (Task 4).
 */

require __DIR__ . '/../../config/database.php';

const MISTAKE_TYPES = [
    'TRANSITION_FAILURE',
    'MUTASHABIHAT',
    'TAWAQQUF',
    'TASHKEEL',
    'LAFDH',
];

function json_out(int $code, array $payload): void
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

// ---------------------------------------------------------------------------
// Method & input
// ---------------------------------------------------------------------------

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    json_out(400, ['success' => false, 'error' => 'Method not allowed. Use POST.']);
}

$input = $_GET;
$raw   = file_get_contents('php://input');
if (is_string($raw) && $raw !== '') {
    $json = json_decode($raw, true);
    if (!is_array($json)) {
        json_out(400, ['success' => false, 'error' => 'Invalid JSON payload.']);
    }
    $input = array_merge($input, $json);
} elseif (!empty($_POST)) {
    $input = array_merge($input, $_POST);
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function read_int($value): int
{
    if (is_string($value) && ctype_digit($value)) {
        $value = (int) $value;
    }
    return is_int($value) ? $value : -1;
}

$errors = [];

$pageNumber = read_int($input['page_number'] ?? null);
if ($pageNumber < 1 || $pageNumber > 604) {
    $errors['page_number'] = 'page_number must be an integer between 1 and 604.';
}

$surahNumber = read_int($input['surah_number'] ?? null);
if ($surahNumber < 1 || $surahNumber > 114) {
    $errors['surah_number'] = 'surah_number must be an integer between 1 and 114.';
}

$ayahNumber = read_int($input['ayah_number'] ?? null);
if ($ayahNumber < 1 || $ayahNumber > 286) {
    $errors['ayah_number'] = 'ayah_number must be an integer between 1 and 286.';
}

$mistakeType = (string) ($input['mistake_type'] ?? '');
if (!in_array($mistakeType, MISTAKE_TYPES, true)) {
    $errors['mistake_type'] = 'mistake_type must be one of: ' . implode(', ', MISTAKE_TYPES) . '.';
}

$notes = $input['notes'] ?? null;
if ($notes !== null && !is_string($notes)) {
    $errors['notes'] = 'notes must be a string.';
    $notes = null;
}
if ($notes !== null && mb_strlen($notes) > 5000) {
    $errors['notes'] = 'notes must be at most 5000 characters.';
}
$notes = $notes !== null && $notes !== '' ? $notes : null;

if ($errors) {
    json_out(400, ['success' => false, 'errors' => $errors]);
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

try {
    $stmt = $pdo->prepare('SELECT `id` FROM `users` WHERE `id` = :id');
    $stmt->execute([':id' => $userId]);
    if (!$stmt->fetch()) {
        json_out(401, ['success' => false, 'error' => 'Authentication required.']);
    }

    $stmt = $pdo->prepare(
        'INSERT INTO `mistakes`
            (`user_id`, `page_number`, `surah_number`, `ayah_number`, `mistake_type`, `notes`, `status`)
         VALUES (:u, :p, :s, :a, :t, :n, \'ACTIVE\')'
    );
    $stmt->execute([
        ':u' => $userId,
        ':p' => $pageNumber,
        ':s' => $surahNumber,
        ':a' => $ayahNumber,
        ':t' => $mistakeType,
        ':n' => $notes,
    ]);
    $mistakeId = (int) $pdo->lastInsertId();

    $stmt = $pdo->prepare(
        'SELECT `id`, `page_number`, `surah_number`, `ayah_number`, `mistake_type`,
                `notes`, `status`, `mastery_count`, `created_at`
         FROM `mistakes` WHERE `id` = :id'
    );
    $stmt->execute([':id' => $mistakeId]);
    $mistake = $stmt->fetch();
} catch (PDOException $e) {
    error_log('[RecordMistake Failed] ' . $e->getMessage());
    json_out(500, ['success' => false, 'error' => 'Server error. Please try again.']);
}

json_out(200, [
    'success' => true,
    'message' => 'Mistake logged successfully.',
    'mistake' => [
        'id'             => (int) $mistake['id'],
        'page_number'    => (int) $mistake['page_number'],
        'surah_number'   => (int) $mistake['surah_number'],
        'ayah_number'    => (int) $mistake['ayah_number'],
        'mistake_type'   => $mistake['mistake_type'],
        'notes'          => $mistake['notes'],
        'status'         => $mistake['status'],
        'mastery_count'  => (int) $mistake['mastery_count'],
        'created_at'     => $mistake['created_at'],
    ],
], JSON_UNESCAPED_UNICODE);
