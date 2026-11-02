<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Delete a flagged waqf.
 * POST JSON: waqf_id
 *
 * A flag can be removed in two cases:
 *   1. It has never been practised (undo an accidental flag).
 *   2. It has reached 10/10 and is already complete.
 * This prevents a user from throwing away a flag halfway through its practice.
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

if ($waqfId < 1) {
    waqf_json_out(400, ['success' => false, 'errors' => ['waqf_id' => 'waqf_id must be a positive integer.']]);
}

try {
    $row = waqf_fetch($pdo, $userId, $waqfId);
    if (!$row) {
        waqf_json_out(400, ['success' => false, 'error' => 'Flagged waqf not found.']);
    }

    $count = (int) $row['practice_count'];
    $target = max(1, (int) $row['practice_target']);
    if ($count > 0 && $count < $target) {
        waqf_json_out(400, [
            'success' => false,
            'error' => 'Complete the 10 repetitions before deleting this flag.',
        ]);
    }

    $stmt = $pdo->prepare('DELETE FROM `waqf_flags` WHERE `id` = :id AND `user_id` = :u');
    $stmt->execute([':id' => $waqfId, ':u' => $userId]);

    $pdo->prepare('UPDATE `users` SET `gate_waqf_id` = NULL, `gate_waqf_locked_at` = NULL WHERE `id` = :u AND `gate_waqf_id` = :w')
        ->execute([':u' => $userId, ':w' => $waqfId]);

    waqf_json_out(200, ['success' => true, 'deleted' => true, 'waqf_id' => $waqfId]);
} catch (PDOException $e) {
    error_log('[Waqf delete] ' . $e->getMessage());
    waqf_json_out(500, ['success' => false, 'error' => 'Server error. Please try again.']);
}
