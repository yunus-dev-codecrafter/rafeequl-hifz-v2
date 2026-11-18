<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Kalimaat test cycle endpoint.
 * GET only.
 *
 *   /test.php           resume the active cycle; if the last cycle is complete,
 *                       return its summary without starting a new one
 *   /test.php?start=1   start the next cycle after a completed one
 *
 * The server owns the queue. Every started word in the user's zone
 * (LOCKED practice words + READY words) is asked once per cycle, so the round
 * always advances and no word is silently skipped.
 */

require __DIR__ . '/../../config/database.php';
require_once __DIR__ . '/../../config/auth.php';
require_once __DIR__ . '/_catalog.php';

try {
    $authUser = rh_require_login($pdo);
    $userId = (int) $authUser['id'];
    $zone = kal_zone($pdo, $userId);
    $start = (int) ($_GET['start'] ?? 0) === 1;
    $stats = kal_user_stats($pdo, $userId);

    $cycle = kal_test_active_cycle($pdo, $userId);

    if (!$cycle) {
        $last = kal_test_last_cycle($pdo, $userId);
        if ($last && !empty($last['completed_at']) && !$start) {
            kal_json_out(200, [
                'success' => true,
                'state' => 'CYCLE_COMPLETE',
                'reason' => '',
                'zone' => $zone,
                'cycle' => kal_test_cycle_payload($pdo, $last),
                'question' => null,
                'stats' => $stats,
                'mastery_correct' => KALIMAAT_TEST_MASTERY_CORRECT,
            ]);
        }

        $cycle = kal_test_create_cycle($pdo, $userId, $zone);
        if (!$cycle) {
            $noPool = kal_test_no_pool_state($pdo, $userId, $zone);
            kal_json_out(200, [
                'success' => true,
                'state' => 'NO_POOL',
                'reason' => $noPool['reason'],
                'zone' => $zone,
                'cycle' => null,
                'question' => null,
                'pool' => $noPool['pool'],
                'stats' => $stats,
                'mastery_correct' => KALIMAAT_TEST_MASTERY_CORRECT,
            ]);
        }
    }

    $cycle = kal_test_finish_if_done($pdo, $cycle);
    if (!empty($cycle['completed_at'])) {
        kal_json_out(200, [
            'success' => true,
            'state' => 'CYCLE_COMPLETE',
            'reason' => '',
            'zone' => $zone,
            'cycle' => kal_test_cycle_payload($pdo, $cycle),
            'question' => null,
            'stats' => $stats,
            'mastery_correct' => KALIMAAT_TEST_MASTERY_CORRECT,
        ]);
    }

    $row = kal_test_next_word($pdo, $userId, $cycle);
    if (!$row) {
        // No drawable word: close the cycle instead of returning a dead queue.
        $cycle = kal_test_close_cycle($pdo, $cycle);
        kal_json_out(200, [
            'success' => true,
            'state' => 'CYCLE_COMPLETE',
            'reason' => '',
            'zone' => $zone,
            'cycle' => kal_test_cycle_payload($pdo, $cycle),
            'question' => null,
            'stats' => $stats,
            'mastery_correct' => KALIMAAT_TEST_MASTERY_CORRECT,
        ]);
    }

    kal_json_out(200, [
        'success' => true,
        'state' => 'OK',
        'reason' => '',
        'zone' => $zone,
        'cycle' => kal_test_cycle_payload($pdo, $cycle),
        'question' => kal_test_question_payload($row, $cycle),
        'stats' => $stats,
        'mastery_correct' => KALIMAAT_TEST_MASTERY_CORRECT,
    ]);
} catch (Throwable $e) {
    error_log('[Kalimaat test] ' . $e->getMessage());
    kal_json_out(500, ['success' => false, 'error' => 'Server error. Please try again.']);
}
