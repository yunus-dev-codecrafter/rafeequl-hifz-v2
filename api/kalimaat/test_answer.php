<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Grade one kalimaat test answer.
 * POST JSON: word_key, selected_meaning, test_session
 *
 * The client generates one 32-hex `test_session` per app session. Three correct
 * answers in three separate app sessions mark the word mastered.
 * A wrong answer is recorded as an attempt but does not remove the word from the
 * test pool.
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
    $session = strtolower(trim((string) ($input['test_session'] ?? '')));
    if (strlen($key) !== 40 || $selected === '' || !preg_match('/^[a-f0-9]{32}$/i', $session)) {
        kal_json_out(400, ['success' => false, 'error' => 'Invalid word_key, selected_meaning, or test_session.']);
    }

    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare(
            'SELECT * FROM `kalimaat_progress` WHERE `user_id` = :u AND `word_key` = :k FOR UPDATE'
        );
        $stmt->execute([':u' => $userId, ':k' => $key]);
        $row = $stmt->fetch();

        if (!$row) {
            $pdo->rollBack();
            kal_json_out(404, ['success' => false, 'error' => 'Word not found.']);
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
        if ((string) $row['status'] !== 'READY') {
            $pdo->rollBack();
            kal_json_out(409, [
                'success' => false,
                'code' => 'NOT_READY',
                'error' => 'Reach 1000 repetitions before testing this word.',
                'word' => kal_word_payload([], $row),
            ]);
        }

        $correctMeaning = (string) $row['meaning'];
        $correct = kal_norm_key($selected) === kal_norm_key($correctMeaning);
        $attempts = (int) $row['test_attempts'] + 1;

        // Only the first correct answer in a test session counts. This enforces
        // "three correct answers across separate sessions" even if the user
        // clicks the same option repeatedly.
        $counted = $correct && (string) ($row['last_test_session'] ?? '') !== $session;
        $correctCount = (int) $row['test_correct'] + ($counted ? 1 : 0);
        $mastered = $correct && $correctCount >= KALIMAAT_TEST_MASTERY_CORRECT;
        $status = $mastered ? 'MASTERED' : 'READY';

        $stmt = $pdo->prepare(
            "UPDATE `kalimaat_progress`
             SET `test_attempts` = :attempts,
                 `test_correct` = :correct_count,
                 `last_test_session` = :session,
                 `status` = :status,
                 `mastered_at` = :mastered_at
             WHERE `id` = :id AND `user_id` = :u"
        );
        $stmt->execute([
            ':attempts' => $attempts,
            ':correct_count' => $correctCount,
            ':session' => $correct ? $session : ($row['last_test_session'] ?? null),
            ':status' => $status,
            ':mastered_at' => $mastered ? date('Y-m-d H:i:s') : null,
            ':id' => (int) $row['id'],
            ':u' => $userId,
        ]);

        $stmt = $pdo->prepare('SELECT * FROM `kalimaat_progress` WHERE `id` = :id LIMIT 1');
        $stmt->execute([':id' => (int) $row['id']]);
        $fresh = $stmt->fetch() ?: $row;
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }

    kal_json_out(200, [
        'success' => true,
        'correct' => $correct,
        'counted' => $counted,
        'correct_meaning' => $correctMeaning,
        'mastered' => $mastered,
        'mastery_correct' => KALIMAAT_TEST_MASTERY_CORRECT,
        'word' => kal_word_payload([], $fresh),
        'stats' => kal_user_stats($pdo, $userId),
    ]);
} catch (Throwable $e) {
    error_log('[Kalimaat test_answer] ' . $e->getMessage());
    kal_json_out(500, ['success' => false, 'error' => 'Server error. Please try again.']);
}
