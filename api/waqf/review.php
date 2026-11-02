<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Practice a flagged waqf.
 * POST JSON: waqf_id, result ('CORRECT'|'SLIP')
 *
 * A correct repetition adds +1. At 10/10 the flag leaves the gate deck but
 * stays in the management list until the user deletes it.
 */

require __DIR__ . '/../../config/database.php';
require_once __DIR__ . '/../../config/auth.php';
require_once __DIR__ . '/_waqf.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    waqf_json_out(400, ['success' => false, 'error' => 'Method not allowed. Use POST.']);
}

$input = waqf_read_input();
$authUser = rh_require_login($pdo);
$userId = (int) $authUser['id'];

$waqfId = waqf_int($input['waqf_id'] ?? null);
$result = strtoupper((string) ($input['result'] ?? ''));

if ($waqfId < 1) {
    waqf_json_out(400, ['success' => false, 'errors' => ['waqf_id' => 'waqf_id must be a positive integer.']]);
}
if (!in_array($result, ['CORRECT', 'SLIP'], true)) {
    waqf_json_out(400, ['success' => false, 'errors' => ['result' => "result must be 'CORRECT' or 'SLIP'."]]);
}

try {
    $row = waqf_fetch($pdo, $userId, $waqfId);
    if (!$row) {
        waqf_json_out(400, ['success' => false, 'error' => 'Flagged waqf not found.']);
    }
    if ((string) $row['status'] === 'ARCHIVED') {
        waqf_json_out(400, [
            'success' => false,
            'error' => 'This waqf is already complete. You can delete it from the flagged list.',
        ]);
    }

    $count = (int) $row['practice_count'];
    $target = max(1, (int) $row['practice_target']);
    $next = practice_apply($count, $target, $result);
    $status = $next['completed'] ? 'ARCHIVED' : 'ACTIVE';
    $graduatedAt = $next['completed'] ? date('Y-m-d H:i:s') : null;

    $stmt = $pdo->prepare(
        'UPDATE `waqf_flags`
         SET `practice_count` = :pc,
             `practice_target` = :pt,
             `status` = :status,
             `graduated_at` = :grad,
             `last_reviewed_at` = NOW()
         WHERE `id` = :id AND `user_id` = :u'
    );
    $stmt->execute([
        ':pc' => $next['count'],
        ':pt' => $next['target'],
        ':status' => $status,
        ':grad' => $graduatedAt,
        ':id' => $waqfId,
        ':u' => $userId,
    ]);

    $updated = waqf_fetch($pdo, $userId, $waqfId);
    waqf_json_out(200, [
        'success' => true,
        'result' => $result,
        'completed' => $next['completed'],
        'practice_count' => $next['count'],
        'practice_target' => $next['target'],
        'remaining' => $next['remaining'],
        'status' => $status,
        'flag' => waqf_payload($updated, true),
    ]);
} catch (PDOException $e) {
    error_log('[Waqf review] ' . $e->getMessage());
    waqf_json_out(500, ['success' => false, 'error' => 'Server error. Please try again.']);
}
