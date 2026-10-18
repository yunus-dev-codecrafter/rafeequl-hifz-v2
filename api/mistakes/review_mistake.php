<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Review Mistake (Spaced Repetition)
 * POST JSON: user_id, mistake_id, grade ('AGAIN'|'HARD'|'GOOD'|'EASY')
 *            (legacy) action ('MASTERED' -> EASY, 'KEEP_PRACTICING' -> HARD)
 *
 * Applies the SRS transition, records an audit event, and reports whether the
 * card graduated (archived) or when it is next due.
 */

require __DIR__ . '/../../config/database.php';
require __DIR__ . '/_srs.php';

function json_out(int $code, array $payload): void
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
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

$mistakeId = $input['mistake_id'] ?? null;
if (is_string($mistakeId) && ctype_digit($mistakeId)) {
    $mistakeId = (int) $mistakeId;
}
if (!is_int($mistakeId) || $mistakeId < 1) {
    json_out(400, ['success' => false, 'errors' => ['mistake_id' => 'mistake_id must be a positive integer.']]);
}

// Grade (with legacy action fallback).
$grade = strtoupper((string) ($input['grade'] ?? ''));
if ($grade === '') {
    $action = strtoupper((string) ($input['action'] ?? ''));
    if ($action === 'MASTERED')      { $grade = 'EASY'; }
    elseif ($action === 'KEEP_PRACTICING') { $grade = 'HARD'; }
}
if (!array_key_exists($grade, SRS_GRADES)) {
    json_out(400, ['success' => false, 'errors' => ['grade' => "grade must be one of: AGAIN, HARD, GOOD, EASY."]]);
}

try {
    $stmt = $pdo->prepare('SELECT * FROM `mistakes` WHERE `id` = :id AND `user_id` = :u');
    $stmt->execute([':id' => $mistakeId, ':u' => $userId]);
    $m = $stmt->fetch();
    if (!$m) {
        json_out(400, ['success' => false, 'error' => 'Mistake not found.']);
    }

    $wasArchived = ($m['status'] === 'ARCHIVED');

    $prev        = srs_prev_state($m);
    $interval    = (int) $m['interval_days'];
    $ease        = (float) $m['ease'];
    $streak      = (int) $m['streak_correct'];
    $mastery     = (int) $m['mastery_count'];
    $lapses      = (int) $m['lapses'];

    $next = srs_next_schedule($interval, $ease, $grade, $streak);

    $newInterval = $next['interval'];
    $newEase     = $next['ease'];
    $newStreak   = $next['streak'];
    if ($next['lapse']) {
        $lapses++;
    }
    if ($grade === 'GOOD' || $grade === 'EASY') {
        $mastery++;
    }

    $graduate = (
        ($grade === 'GOOD' || $grade === 'EASY')
        && $newStreak >= SRS_GRADUATE_STREAK
        && $newInterval >= SRS_GRADUATE_MIN_INTERVAL
    );

    $dueAt       = srs_due_datetime($newInterval);
    $newStatus   = $graduate ? 'ARCHIVED' : 'ACTIVE';
    $graduatedAt = $graduate ? date('Y-m-d H:i:s') : $m['graduated_at'];

    $stmt = $pdo->prepare(
        "UPDATE `mistakes`
         SET `interval_days`    = :iv,
             `ease`             = :ez,
             `lapses`           = :lp,
             `streak_correct`   = :st,
             `mastery_count`    = :mc,
             `due_at`           = :due,
             `last_reviewed_at` = NOW(),
             `status`           = :status,
             `graduated_at`     = :grad
         WHERE `id` = :id AND `user_id` = :u"
    );
    $stmt->execute([
        ':iv' => $newInterval, ':ez' => $newEase, ':lp' => $lapses, ':st' => $newStreak,
        ':mc' => $mastery, ':due' => $dueAt, ':status' => $newStatus, ':grad' => $graduatedAt,
        ':id' => $mistakeId, ':u' => $userId,
    ]);

    srs_log_event(
        $pdo, $userId, $mistakeId,
        $graduate ? 'MASTERED' : $grade,
        SRS_GRADES[$grade],
        $interval, $newInterval,
        $prev
    );

    json_out(200, [
        'success'     => true,
        'graduated'   => $graduate,
        'grade'       => $grade,
        'mastery_count' => $mastery,
        'mistake'     => [
            'id'             => $mistakeId,
            'status'         => $newStatus,
            'interval_days'  => $newInterval,
            'ease'           => $newEase,
            'lapses'         => $lapses,
            'streak_correct' => $newStreak,
            'mastery_count'  => $mastery,
            'due_at'         => $dueAt,
        ],
    ], JSON_UNESCAPED_UNICODE);
} catch (PDOException $e) {
    error_log('[ReviewMistake Failed] ' . $e->getMessage());
    json_out(500, ['success' => false, 'error' => 'Server error. Please try again.']);
}
