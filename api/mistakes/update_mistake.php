<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Update Mistake (edit a logged mistake)
 * POST JSON: user_id, mistake_id, mistake_type, notes, severity,
 *            confused_with_surah, confused_with_ayah
 *
 * Records an EDITED audit event with the previous snapshot so the change is
 * traceable. Does not touch scheduling (use review_mistake.php for that).
 */

require __DIR__ . '/../../config/database.php';
require __DIR__ . '/_srs.php';

const MISTAKE_TYPES = ['TRANSITION_FAILURE', 'MUTASHABIHAT', 'TAWAQQUF', 'TASHKEEL', 'LAFDH'];

function json_out(int $code, array $payload): void
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

function read_optional_int($value): ?int
{
    if ($value === null || $value === '') return null;
    if (is_string($value) && ctype_digit($value)) return (int) $value;
    return is_int($value) ? $value : null;
}

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

require_once __DIR__ . '/../../config/auth.php';

// Session is authoritative. A client-supplied user_id is accepted only from an
// administrator (so the admin panel can act on other accounts).
$authUser = rh_require_login($pdo);
$userId   = rh_resolve_user_id($pdo, $authUser, $input['user_id'] ?? null);

$mistakeId = $input['mistake_id'] ?? null;
if (is_string($mistakeId) && ctype_digit($mistakeId)) $mistakeId = (int) $mistakeId;
if (!is_int($mistakeId) || $mistakeId < 1) {
    json_out(400, ['success' => false, 'errors' => ['mistake_id' => 'mistake_id must be a positive integer.']]);
}

$errors = [];

$mistakeType = (string) ($input['mistake_type'] ?? '');
if (!in_array($mistakeType, MISTAKE_TYPES, true)) {
    $errors['mistake_type'] = 'mistake_type must be one of: ' . implode(', ', MISTAKE_TYPES) . '.';
}

$severity = read_optional_int($input['severity'] ?? null);
if ($severity === null) $severity = 1;
if ($severity < 1 || $severity > 3) {
    $errors['severity'] = 'severity must be between 1 and 3.';
}

$confusedSurah = read_optional_int($input['confused_with_surah'] ?? null);
$confusedAyah  = read_optional_int($input['confused_with_ayah'] ?? null);
if ($confusedSurah !== null && ($confusedSurah < 1 || $confusedSurah > 114)) {
    $errors['confused_with_surah'] = 'confused_with_surah must be between 1 and 114.';
}
if ($confusedAyah !== null && ($confusedAyah < 1 || $confusedAyah > 286)) {
    $errors['confused_with_ayah'] = 'confused_with_ayah must be between 1 and 286.';
}

$notes = $input['notes'] ?? null;
if ($notes !== null && !is_string($notes)) $notes = null;
if ($notes !== null && mb_strlen($notes) > 5000) {
    $errors['notes'] = 'notes must be at most 5000 characters.';
}
$notes = ($notes !== null && $notes !== '') ? $notes : null;

// A paired verse is only meaningful for a forgotten next verse (transition) or
// a confusable verse (mutashabihat). Never persist it on other mistake types.
if (!in_array($mistakeType, ['TRANSITION_FAILURE', 'MUTASHABIHAT'], true)) {
    $confusedSurah = null;
    $confusedAyah = null;
}

if ($errors) {
    json_out(400, ['success' => false, 'errors' => $errors]);
}

try {
    $stmt = $pdo->prepare('SELECT * FROM `mistakes` WHERE `id` = :id AND `user_id` = :u');
    $stmt->execute([':id' => $mistakeId, ':u' => $userId]);
    $m = $stmt->fetch();
    if (!$m) {
        json_out(400, ['success' => false, 'error' => 'Mistake not found.']);
    }

    $stmt = $pdo->prepare(
        "UPDATE `mistakes`
         SET `mistake_type` = :t, `notes` = :n, `severity` = :sev,
             `confused_with_surah` = :cs, `confused_with_ayah` = :ca
         WHERE `id` = :id AND `user_id` = :u"
    );
    $stmt->execute([
        ':t' => $mistakeType, ':n' => $notes, ':sev' => $severity,
        ':cs' => $confusedSurah, ':ca' => $confusedAyah,
        ':id' => $mistakeId, ':u' => $userId,
    ]);

    srs_log_event($pdo, $userId, $mistakeId, 'EDITED', null, null, null, srs_prev_state($m));

    json_out(200, [
        'success' => true,
        'message' => 'Mistake updated successfully.',
        'mistake' => [
            'id'                 => $mistakeId,
            'mistake_type'       => $mistakeType,
            'notes'              => $notes,
            'severity'           => $severity,
            'confused_with_surah' => $confusedSurah,
            'confused_with_ayah'  => $confusedAyah,
        ],
    ], JSON_UNESCAPED_UNICODE);
} catch (PDOException $e) {
    error_log('[UpdateMistake Failed] ' . $e->getMessage());
    json_out(500, ['success' => false, 'error' => 'Server error. Please try again.']);
}
