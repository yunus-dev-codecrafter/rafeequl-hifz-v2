<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Grade one kalimaat test answer.
 * POST JSON: word_key, selected_meaning
 *
 * `test_session` is still accepted from older clients but ignored: cycles are
 * server-owned now. A word is asked at most once per cycle, and only a correct
 * answer for a word that was READY when the cycle started counts toward the
 * three-cycle mastery target. LOCKED words are practice inside the same cycle.
 */

require __DIR__ . '/../../config/database.php';
require_once __DIR__ . '/../../config/auth.php';
require_once __DIR__ . '/_catalog.php';

try {
    $input = kal_require_post();
    $authUser = rh_require_login($pdo);
    $userId = (int) $authUser['id'];

    $key = trim((string) ($input['word_key'] ?? ''));
    $selected = trim((string) ($input['selected_meaning'] ?? ''));
    if (strlen($key) !== 40 || $selected === '' || mb_strlen($selected) > 500) {
        kal_json_out(400, ['success' => false, 'error' => 'Invalid word_key or selected_meaning.']);
    }

    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare(
            'SELECT * FROM `kalimaat_test_cycles`
              WHERE `user_id` = :u AND `completed_at` IS NULL
              ORDER BY `cycle_no` DESC LIMIT 1 FOR UPDATE'
        );
        $stmt->execute([':u' => $userId]);
        $cycle = $stmt->fetch();
        if (!$cycle) {
            $pdo->rollBack();
            kal_json_out(409, [
                'success' => false,
                'code' => 'NO_ACTIVE_CYCLE',
                'error' => 'There is no active test cycle. Start a new cycle.',
            ]);
        }

        // Idempotency: a word is answered once per cycle.
        $stmt = $pdo->prepare(
            'SELECT * FROM `kalimaat_test_attempts`
              WHERE `cycle_id` = :c AND `word_key` = :k LIMIT 1 FOR UPDATE'
        );
        $stmt->execute([':c' => (int) $cycle['id'], ':k' => $key]);
        $attempt = $stmt->fetch();

        $stmt = $pdo->prepare(
            'SELECT * FROM `kalimaat_progress` WHERE `user_id` = :u AND `word_key` = :k FOR UPDATE'
        );
        $stmt->execute([':u' => $userId, ':k' => $key]);
        $row = $stmt->fetch();

        if (!$row || (int) $row['repeat_count'] <= 0) {
            $pdo->rollBack();
            kal_json_out(409, [
                'success' => false,
                'code' => 'NOT_STARTED',
                'error' => 'This word has not been started yet.',
            ]);
        }

        if ($attempt) {
            $pdo->rollBack();
            kal_json_out(409, [
                'success' => false,
                'code' => 'ALREADY_ANSWERED',
                'error' => 'This word was already answered in the current cycle.',
                'attempt' => [
                    'correct' => (bool) $attempt['correct'],
                    'counted' => (bool) $attempt['counted'],
                    'created_at' => $attempt['created_at'] ?? null,
                ],
                'word' => kal_word_payload([], $row),
                'cycle' => kal_test_cycle_payload($pdo, $cycle),
            ]);
        }

        if ((string) $row['status'] === 'MASTERED') {
            $pdo->rollBack();
            kal_json_out(409, [
                'success' => false,
                'code' => 'MASTERED',
                'error' => 'This word is already mastered.',
                'word' => kal_word_payload([], $row),
            ]);
        }

        $inCycle = in_array((string) $row['status'], ['LOCKED', 'READY'], true)
            && (int) $row['page_number'] >= (int) ($cycle['zone_start'] ?? 1)
            && (int) $row['page_number'] <= (int) ($cycle['zone_end'] ?? 604)
            && (string) $row['created_at'] <= (string) $cycle['started_at'];

        if (!$inCycle) {
            $pdo->rollBack();
            kal_json_out(409, [
                'success' => false,
                'code' => 'NOT_IN_CYCLE',
                'error' => 'This word is not part of the current test cycle.',
                'word' => kal_word_payload([], $row),
                'cycle' => kal_test_cycle_payload($pdo, $cycle),
            ]);
        }

        $correctMeaning = (string) $row['meaning'];
        $correct = kal_norm_key($selected) === kal_norm_key($correctMeaning);

        // READY at cycle start = still READY and not repeated during the cycle.
        // A LOCKED word that reaches 500 mid-cycle is practice-only this round.
        $wasReady = (string) $row['status'] === 'READY'
            && (empty($row['last_repeated_at']) || (string) $row['last_repeated_at'] <= (string) $cycle['started_at']);
        $counted = $correct && $wasReady;

        $stmt = $pdo->prepare(
            "INSERT INTO `kalimaat_test_attempts`
                (`user_id`, `cycle_id`, `word_key`, `was_ready`, `correct`, `counted`, `selected_meaning`)
             VALUES (:u, :c, :k, :ready, :correct, :counted, :selected)"
        );
        $stmt->execute([
            ':u' => $userId,
            ':c' => (int) $cycle['id'],
            ':k' => $key,
            ':ready' => $wasReady ? 1 : 0,
            ':correct' => $correct ? 1 : 0,
            ':counted' => $counted ? 1 : 0,
            ':selected' => $selected,
        ]);

        $correctCount = kal_test_correct_count($pdo, $userId, $key);
        $mastered = $correct && $wasReady
            && (string) $row['status'] === 'READY'
            && $correctCount >= KALIMAAT_TEST_MASTERY_CORRECT;
        $status = $mastered ? 'MASTERED' : (string) $row['status'];
        $attempts = (int) $row['test_attempts'] + 1;

        $stmt = $pdo->prepare(
            "UPDATE `kalimaat_progress`
                SET `test_attempts` = :attempts,
                    `test_correct` = :correct_count,
                    `last_tested_at` = NOW(),
                    `status` = :status,
                    `mastered_at` = :mastered_at
              WHERE `id` = :id AND `user_id` = :u"
        );
        $stmt->execute([
            ':attempts' => $attempts,
            ':correct_count' => $correctCount,
            ':status' => $status,
            ':mastered_at' => $mastered
                ? date('Y-m-d H:i:s')
                : ($row['mastered_at'] ?? null),
            ':id' => (int) $row['id'],
            ':u' => $userId,
        ]);

        $cycle = kal_test_finish_if_done($pdo, $cycle);

        $stmt = $pdo->prepare('SELECT * FROM `kalimaat_progress` WHERE `id` = :id LIMIT 1');
        $stmt->execute([':id' => (int) $row['id']]);
        $fresh = $stmt->fetch() ?: $row;

        $cyclePayload = kal_test_cycle_payload($pdo, $cycle);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }

    kal_json_out(200, [
        'success' => true,
        'correct' => $correct,
        'counted' => $counted,
        'was_ready' => $wasReady,
        'correct_meaning' => $correctMeaning,
        'mastered' => $mastered,
        'mastery_correct' => KALIMAAT_TEST_MASTERY_CORRECT,
        'word' => kal_word_payload([], $fresh),
        'cycle' => $cyclePayload,
        'cycle_completed' => empty($cyclePayload['completed_at']) ? false : true,
        'stats' => kal_user_stats($pdo, $userId),
    ]);
} catch (Throwable $e) {
    error_log('[Kalimaat test_answer] ' . $e->getMessage());
    kal_json_out(500, ['success' => false, 'error' => 'Server error. Please try again.']);
}
