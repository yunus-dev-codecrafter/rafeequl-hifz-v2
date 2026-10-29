<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Practice a Mistake (40-repetition model)
 * POST JSON: user_id, mistake_id, result ('CORRECT'|'SLIP')
 *            (legacy) grade ('AGAIN'|'HARD'|'GOOD'|'EASY')
 *            (legacy) action ('MASTERED' -> CORRECT, 'KEEP_PRACTICING' -> SLIP)
 *
 * CORRECT adds one repetition; when the counter reaches `practice_target` (40)
 * the card is archived automatically and leaves the practice deck.
 * SLIP records the stumble but does not add a repetition.
 */

require __DIR__ . '/../../config/database.php';
require __DIR__ . '/_practice.php';

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

require_once __DIR__ . '/../../config/auth.php';

// Session is authoritative. A client-supplied user_id is accepted only from an
// administrator (so the admin panel can act on other accounts).
$authUser = rh_require_login($pdo);
$userId   = rh_resolve_user_id($pdo, $authUser, $input['user_id'] ?? null);

$mistakeId = $input['mistake_id'] ?? null;
if (is_string($mistakeId) && ctype_digit($mistakeId)) {
    $mistakeId = (int) $mistakeId;
}
if (!is_int($mistakeId) || $mistakeId < 1) {
    json_out(400, ['success' => false, 'errors' => ['mistake_id' => 'mistake_id must be a positive integer.']]);
}

// Result (with legacy grade/action fallback so a cached client keeps working).
$result = strtoupper((string) ($input['result'] ?? ''));
if ($result === '') {
    $grade = strtoupper((string) ($input['grade'] ?? ''));
    if ($grade === 'GOOD' || $grade === 'EASY')      { $result = 'CORRECT'; }
    elseif ($grade === 'AGAIN' || $grade === 'HARD') { $result = 'SLIP'; }

    if ($result === '') {
        $action = strtoupper((string) ($input['action'] ?? ''));
        if ($action === 'MASTERED')             { $result = 'CORRECT'; }
        elseif ($action === 'KEEP_PRACTICING')  { $result = 'SLIP'; }
    }
}
if (!in_array($result, ['CORRECT', 'SLIP'], true)) {
    json_out(400, [
        'success' => false,
        'errors'  => ['result' => "result must be 'CORRECT' or 'SLIP'."],
    ]);
}

try {
    $stmt = $pdo->prepare('SELECT * FROM `mistakes` WHERE `id` = :id AND `user_id` = :u');
    $stmt->execute([':id' => $mistakeId, ':u' => $userId]);
    $m = $stmt->fetch();
    if (!$m) {
        json_out(400, ['success' => false, 'error' => 'Mistake not found.']);
    }

    if ($m['status'] === 'ARCHIVED') {
        json_out(400, [
            'success' => false,
            'error'   => 'Mistake is already completed. Log it again to restart practice.',
        ]);
    }

    $prev     = practice_prev_state($m);
    $count    = (int) $m['practice_count'];
    $target   = (int) $m['practice_target'];
    $next     = practice_apply($count, $target, $result);

    $newStatus   = $next['completed'] ? 'ARCHIVED' : 'ACTIVE';
    $graduatedAt = $next['completed'] ? date('Y-m-d H:i:s') : $m['graduated_at'];
    $mastery     = (int) $m['mastery_count'] + ($result === 'CORRECT' ? 1 : 0);
    $lapses      = (int) $m['lapses'] + ($result === 'SLIP' ? 1 : 0);

    $stmt = $pdo->prepare(
        "UPDATE `mistakes`
         SET `practice_count`   = :pc,
             `practice_target`  = :pt,
             `status`           = :status,
             `graduated_at`     = :grad,
             `mastery_count`    = :mc,
             `lapses`           = :lp,
             `last_reviewed_at` = NOW(),
             `due_at`           = NOW()
         WHERE `id` = :id AND `user_id` = :u"
    );
    $stmt->execute([
        ':pc'     => $next['count'],
        ':pt'     => $next['target'],
        ':status' => $newStatus,
        ':grad'   => $graduatedAt,
        ':mc'     => $mastery,
        ':lp'     => $lapses,
        ':id'     => $mistakeId,
        ':u'      => $userId,
    ]);

    // Reuse the existing audit enum: GOOD = correct repetition, AGAIN = slip,
    // MASTERED = the repetition that completed the card.
    $eventType = $next['completed'] ? 'MASTERED' : ($result === 'CORRECT' ? 'GOOD' : 'AGAIN');
    $grade     = $result === 'CORRECT' ? 2 : 0;
    practice_log_event(
        $pdo, $userId, $mistakeId, $eventType,
        $grade, $count, $next['count'], $prev
    );

    json_out(200, [
        'success'        => true,
        'result'         => $result,
        'completed'      => $next['completed'],
        'practice_count' => $next['count'],
        'practice_target' => $next['target'],
        'remaining'      => $next['remaining'],
        'status'         => $newStatus,
        'mistake'        => [
            'id'              => $mistakeId,
            'status'          => $newStatus,
            'practice_count'  => $next['count'],
            'practice_target' => $next['target'],
            'remaining'       => $next['remaining'],
            'mastery_count'   => $mastery,
            'lapses'          => $lapses,
            'graduated_at'    => $graduatedAt,
        ],
    ], JSON_UNESCAPED_UNICODE);
} catch (PDOException $e) {
    error_log('[ReviewMistake Failed] ' . $e->getMessage());
    json_out(500, ['success' => false, 'error' => 'Server error. Please try again.']);
}
