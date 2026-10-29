<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Add repetitions to the locked kalimaat word.
 * POST JSON: word_key, amount (default 1, max 50)
 */

require __DIR__ . '/../../config/database.php';
require_once __DIR__ . '/../../config/auth.php';
require_once __DIR__ . '/_catalog.php';

try {
    $input = kal_require_post();
    $authUser = rh_require_login($pdo);
    $userId = (int) $authUser['id'];

    $key = trim((string) ($input['word_key'] ?? ''));
    if (strlen($key) !== 40) {
        kal_json_out(400, ['success' => false, 'error' => 'Invalid word_key.']);
    }

    $amount = (int) ($input['amount'] ?? 1);
    $amount = max(1, min(50, $amount));

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
        if ((string) $row['status'] !== 'LOCKED') {
            $pdo->rollBack();
            kal_json_out(409, [
                'success' => false,
                'code' => 'NOT_LOCKED',
                'error' => 'This word is not currently locked for practice.',
                'word' => kal_word_payload([], $row),
            ]);
        }

        $count = (int) $row['repeat_count'];
        $next = min(KALIMAAT_TARGET, $count + $amount);
        $status = $next >= KALIMAAT_TARGET ? 'READY' : 'LOCKED';
        $completed = $next >= KALIMAAT_TARGET;

        $stmt = $pdo->prepare(
            "UPDATE `kalimaat_progress`
             SET `repeat_count` = :n,
                 `status` = :status,
                 `last_repeated_at` = NOW(),
                 `mastered_at` = NULL
             WHERE `id` = :id AND `user_id` = :u"
        );
        $stmt->execute([
            ':n' => $next,
            ':status' => $status,
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
        'completed' => $completed,
        'word' => kal_word_payload([], $fresh),
        'stats' => kal_user_stats($pdo, $userId),
    ]);
} catch (Throwable $e) {
    error_log('[Kalimaat repeat] ' . $e->getMessage());
    kal_json_out(500, ['success' => false, 'error' => 'Server error. Please try again.']);
}
