<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Record Mistake
 * POST JSON: user_id, page_number, surah_number, ayah_number, mistake_type,
 *            notes, severity, confused_with_surah, confused_with_ayah, source_task
 *
 * Deduplicates by (user, page, surah, ayah, type): logging the same mistake
 * again does not create a duplicate row, it bumps `occurrence_count`, resets
 * the SRS schedule (it is a lapse) and appends a LOGGED event.
 */

require __DIR__ . '/../../config/database.php';
require __DIR__ . '/_srs.php';

const MISTAKE_TYPES = [
    'TRANSITION_FAILURE',
    'MUTASHABIHAT',
    'TAWAQQUF',
    'TASHKEEL',
    'LAFDH',
];
const SOURCE_TASKS = ['HIFZ_JADID', 'TIKRAR_AMS', 'RABT', 'MURAJAAH', 'RUB_TAMKIN'];

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

require_once __DIR__ . '/../../config/auth.php';

// Session is authoritative. A client-supplied user_id is accepted only from an
// administrator (so the admin panel can act on other accounts).
$authUser = rh_require_login($pdo);
$userId   = rh_resolve_user_id($pdo, $authUser, $input['user_id'] ?? null);

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

function read_optional_int($value): ?int
{
    if ($value === null || $value === '') {
        return null;
    }
    if (is_string($value) && ctype_digit($value)) {
        return (int) $value;
    }
    return is_int($value) ? $value : null;
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

$severity = read_optional_int($input['severity'] ?? null);
if ($severity === null) {
    $severity = 1;
}
if ($severity < 1 || $severity > 3) {
    $errors['severity'] = 'severity must be between 1 and 3.';
    $severity = 1;
}

$confusedSurah = read_optional_int($input['confused_with_surah'] ?? null);
if ($confusedSurah !== null && ($confusedSurah < 1 || $confusedSurah > 114)) {
    $errors['confused_with_surah'] = 'confused_with_surah must be between 1 and 114.';
}

$confusedAyah = read_optional_int($input['confused_with_ayah'] ?? null);
if ($confusedAyah !== null && ($confusedAyah < 1 || $confusedAyah > 286)) {
    $errors['confused_with_ayah'] = 'confused_with_ayah must be between 1 and 286.';
}

$sourceTask = $input['source_task'] ?? null;
if ($sourceTask !== null && $sourceTask !== '' && !in_array($sourceTask, SOURCE_TASKS, true)) {
    $errors['source_task'] = 'source_task must be one of: ' . implode(', ', SOURCE_TASKS) . '.';
}
$sourceTask = ($sourceTask === '') ? null : $sourceTask;

$notes = $input['notes'] ?? null;
if ($notes !== null && !is_string($notes)) {
    $errors['notes'] = 'notes must be a string.';
    $notes = null;
}
if ($notes !== null && mb_strlen($notes) > 5000) {
    $errors['notes'] = 'notes must be at most 5000 characters.';
}
$notes = $notes !== null && $notes !== '' ? $notes : null;

// A paired verse is only meaningful for a forgotten next verse (transition) or
// a confusable verse (mutashabihat). Never persist it on other mistake types.
if (!in_array($mistakeType, ['TRANSITION_FAILURE', 'MUTASHABIHAT'], true)) {
    $confusedSurah = null;
    $confusedAyah = null;
}

if ($errors) {
    json_out(400, ['success' => false, 'errors' => $errors]);
}

// ---------------------------------------------------------------------------
// Save (dedup + merge)
// ---------------------------------------------------------------------------

$merged = false;

try {
    $stmt = $pdo->prepare('SELECT `id` FROM `users` WHERE `id` = :id');
    $stmt->execute([':id' => $userId]);
    if (!$stmt->fetch()) {
        json_out(401, ['success' => false, 'error' => 'Authentication required.']);
    }

    // Is this exact mistake already active?
    $stmt = $pdo->prepare(
        "SELECT `id`, `occurrence_count`, `severity`
         FROM `mistakes`
         WHERE `user_id` = :u AND `page_number` = :p AND `surah_number` = :s
           AND `ayah_number` = :a AND `mistake_type` = :t AND `status` = 'ACTIVE'
         LIMIT 1"
    );
    $stmt->execute([
        ':u' => $userId, ':p' => $pageNumber, ':s' => $surahNumber,
        ':a' => $ayahNumber, ':t' => $mistakeType,
    ]);
    $existing = $stmt->fetch();

    if ($existing) {
        $mistakeId = (int) $existing['id'];
        $merged = true;
        $stmt = $pdo->prepare(
            "UPDATE `mistakes`
             SET `occurrence_count` = `occurrence_count` + 1,
                 `severity`      = GREATEST(`severity`, :sev),
                 `notes`         = COALESCE(:n, `notes`),
                 `source_task`   = COALESCE(:src, `source_task`),
                 `confused_with_surah` = COALESCE(:cs, `confused_with_surah`),
                 `confused_with_ayah`  = COALESCE(:ca, `confused_with_ayah`),
                 `interval_days` = 0,
                 `streak_correct` = 0,
                 `lapses`        = `lapses` + 1,
                 `due_at`        = NOW()
             WHERE `id` = :id AND `user_id` = :u"
        );
        $stmt->execute([
            ':sev' => $severity, ':n' => $notes, ':src' => $sourceTask,
            ':cs' => $confusedSurah, ':ca' => $confusedAyah,
            ':id' => $mistakeId, ':u' => $userId,
        ]);
        srs_log_event($pdo, $userId, $mistakeId, 'LOGGED');
    } else {
        $stmt = $pdo->prepare(
            "INSERT INTO `mistakes`
                (`user_id`, `page_number`, `surah_number`, `ayah_number`, `mistake_type`,
                 `notes`, `severity`, `confused_with_surah`, `confused_with_ayah`, `source_task`,
                 `status`, `occurrence_count`, `due_at`)
             VALUES (:u, :p, :s, :a, :t, :n, :sev, :cs, :ca, :src, 'ACTIVE', 1, NOW())"
        );
        $stmt->execute([
            ':u' => $userId, ':p' => $pageNumber, ':s' => $surahNumber, ':a' => $ayahNumber,
            ':t' => $mistakeType, ':n' => $notes, ':sev' => $severity,
            ':cs' => $confusedSurah, ':ca' => $confusedAyah, ':src' => $sourceTask,
        ]);
        $mistakeId = (int) $pdo->lastInsertId();
        srs_log_event($pdo, $userId, $mistakeId, 'LOGGED');
    }

    $stmt = $pdo->prepare(
        'SELECT `id`, `page_number`, `surah_number`, `ayah_number`, `mistake_type`,
                `notes`, `severity`, `confused_with_surah`, `confused_with_ayah`, `source_task`,
                `status`, `mastery_count`, `occurrence_count`, `interval_days`, `ease`,
                `lapses`, `streak_correct`, `due_at`, `last_reviewed_at`, `created_at`
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
    'merged'  => $merged,
    'message' => $merged
        ? 'Mistake recurrence recorded (existing card updated).'
        : 'Mistake logged successfully.',
    'mistake' => [
        'id'                 => (int) $mistake['id'],
        'page_number'        => (int) $mistake['page_number'],
        'surah_number'       => (int) $mistake['surah_number'],
        'ayah_number'        => (int) $mistake['ayah_number'],
        'mistake_type'       => $mistake['mistake_type'],
        'notes'              => $mistake['notes'],
        'severity'           => (int) $mistake['severity'],
        'confused_with_surah' => $mistake['confused_with_surah'] !== null ? (int) $mistake['confused_with_surah'] : null,
        'confused_with_ayah' => $mistake['confused_with_ayah'] !== null ? (int) $mistake['confused_with_ayah'] : null,
        'source_task'        => $mistake['source_task'],
        'status'             => $mistake['status'],
        'mastery_count'      => (int) $mistake['mastery_count'],
        'occurrence_count'   => (int) $mistake['occurrence_count'],
        'interval_days'      => (int) $mistake['interval_days'],
        'due_at'             => $mistake['due_at'],
        'created_at'         => $mistake['created_at'],
    ],
]);
