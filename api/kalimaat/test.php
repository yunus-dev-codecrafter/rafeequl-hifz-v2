<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Draw a random test question from the user's READY words.
 * GET only.
 */

require __DIR__ . '/../../config/database.php';
require_once __DIR__ . '/../../config/auth.php';
require_once __DIR__ . '/_catalog.php';

try {
    $authUser = rh_require_login($pdo);
    $userId = (int) $authUser['id'];
    $zone = kal_zone($pdo, $userId);

    $question = kal_test_question($pdo, $userId, $zone);
    kal_json_out(200, [
        'success' => true,
        'zone' => $zone,
        'question' => $question,
        'stats' => kal_user_stats($pdo, $userId),
        'mastery_correct' => KALIMAAT_TEST_MASTERY_CORRECT,
    ]);
} catch (Throwable $e) {
    error_log('[Kalimaat test] ' . $e->getMessage());
    kal_json_out(500, ['success' => false, 'error' => 'Server error. Please try again.']);
}
