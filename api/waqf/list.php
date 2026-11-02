<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - List the user's flagged waqf stations.
 * GET/POST: rub_id (optional)
 */

require __DIR__ . '/../../config/database.php';
require_once __DIR__ . '/../../config/auth.php';
require_once __DIR__ . '/_waqf.php';

$input = waqf_read_input();
$authUser = rh_require_login($pdo);
$userId = (int) $authUser['id'];
$rubId = waqf_int($input['rub_id'] ?? null);

try {
    if ($rubId > 0) {
        $stmt = $pdo->prepare(
            'SELECT * FROM `waqf_flags`
             WHERE `user_id` = :u AND `rub_id` = :r
             ORDER BY `status` ASC, `created_at` DESC, `id` DESC'
        );
        $stmt->execute([':u' => $userId, ':r' => $rubId]);
    } else {
        $stmt = $pdo->prepare(
            'SELECT * FROM `waqf_flags`
             WHERE `user_id` = :u
             ORDER BY `status` ASC, `created_at` DESC, `id` DESC'
        );
        $stmt->execute([':u' => $userId]);
    }

    $flags = [];
    $active = 0;
    $completed = 0;
    foreach ($stmt->fetchAll() as $row) {
        $payload = waqf_payload($row);
        if ($payload === null) {
            continue;
        }
        $flags[] = $payload;
        if ($payload['status'] === 'ACTIVE' && $payload['practice_count'] < $payload['practice_target']) {
            $active++;
        } else {
            $completed++;
        }
    }

    waqf_json_out(200, [
        'success' => true,
        'flags' => $flags,
        'summary' => [
            'total' => count($flags),
            'active' => $active,
            'completed' => $completed,
        ],
    ]);
} catch (PDOException $e) {
    error_log('[Waqf list] ' . $e->getMessage());
    waqf_json_out(500, ['success' => false, 'error' => 'Server error. Please try again.']);
}
