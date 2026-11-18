<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - kalimaat test-cycle verification (CLI only).
 *
 * Runs inside a single transaction and always rolls back, so it does not keep
 * any users, progress rows, cycles, or attempts.
 *
 *   php config/verify_kalimaat_test.php
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . '/database.php';
require_once __DIR__ . '/../api/kalimaat/_catalog.php';

function kv_assert(bool $condition, string $message, array &$failures): void
{
    if ($condition) {
        echo '  ✓ ' . $message . PHP_EOL;
        return;
    }
    $failures[] = $message;
    echo '  ✗ ' . $message . PHP_EOL;
}

$failures = [];
$userId = 0;

echo 'Kalimaat test-cycle verification' . PHP_EOL;

try {
    foreach (['kalimaat_test_cycles', 'kalimaat_test_attempts'] as $table) {
        $found = (bool) $pdo->query("SHOW TABLES LIKE " . $pdo->quote($table))->fetchColumn();
        kv_assert($found, 'table exists: ' . $table, $failures);
    }

    $columns = [];
    foreach ($pdo->query('SHOW COLUMNS FROM `kalimaat_progress`') as $row) {
        $columns[strtolower((string) $row['Field'])] = true;
    }
    kv_assert(isset($columns['last_tested_at']), 'column exists: kalimaat_progress.last_tested_at', $failures);

    if ($failures) {
        echo PHP_EOL . 'Schema is not at v15. Run `php config/migrate_v15.php`'
            . ' (or open migrate.php as an admin) before this verification.' . PHP_EOL;
        exit(1);
    }

    $pdo->beginTransaction();

    $email = 'kalimaat-verify-' . bin2hex(random_bytes(6)) . '@example.invalid';
    $stmt = $pdo->prepare(
        "INSERT INTO `users` (`name`, `email`, `password_hash`, `user_type`, `current_hifz_page`)
         VALUES ('Kalimaat Verify', :email, :hash, 'NEW', 604)"
    );
    $stmt->execute([
        ':email' => $email,
        ':hash' => password_hash('verify-only', PASSWORD_DEFAULT),
    ]);
    $userId = (int) $pdo->lastInsertId();

    $keyReady = str_repeat('a', 40);
    $keyLocked = str_repeat('b', 40);
    $keyMastered = str_repeat('c', 40);
    $keyZero = str_repeat('d', 40);

    $stmt = $pdo->prepare(
        "INSERT INTO `kalimaat_progress`
            (`user_id`, `word_key`, `word_text`, `meaning`, `surah_number`,
             `ayah_number`, `page_number`, `repeat_count`, `status`,
             `last_repeated_at`, `test_correct`)
         VALUES
            (:u, :k, :t, :m, 1, 1, 1, :reps, :st, NOW(), :correct)"
    );

    $rows = [
        [$keyReady, 'جاهزة', 'كلمة جاهزة', 500, 'READY', 1],
        [$keyLocked, 'مثبتة', 'كلمة تدريب', 120, 'LOCKED', 0],
        [$keyMastered, 'متقنة', 'كلمة متقنة', 500, 'MASTERED', 3],
        [$keyZero, 'صفر', 'كلمة بلا تكرار', 0, 'LOCKED', 0],
    ];
    foreach ($rows as $index => $row) {
        $stmt->execute([
            ':u' => $userId,
            ':k' => $row[0],
            ':t' => $row[1],
            ':m' => $row[2],
            ':reps' => $row[3],
            ':st' => $row[4],
            ':correct' => $row[5],
        ]);
        // Keep creation order stable; page is only used for the zone check.
        $pdo->prepare('UPDATE `kalimaat_progress` SET `page_number` = :p WHERE `id` = :id')
            ->execute([':p' => $index + 1, ':id' => (int) $pdo->lastInsertId()]);
    }

    $zone = ['start' => 1, 'end' => 604, 'type' => 'NEW', 'current' => 604];
    $pool = kal_test_pool_counts($pdo, $userId, $zone);
    kv_assert($pool['eligible'] === 2, 'pool includes LOCKED + READY started words only', $failures);
    kv_assert($pool['ready'] === 1, 'pool reports READY words separately', $failures);

    $cycleStmt = $pdo->prepare(
        "INSERT INTO `kalimaat_test_cycles`
            (`user_id`, `cycle_no`, `eligible_total`, `ready_total`,
             `zone_start`, `zone_end`, `started_at`)
         VALUES (:u, :n, :eligible, :ready, 1, 604, NOW())"
    );
    $attemptStmt = $pdo->prepare(
        "INSERT INTO `kalimaat_test_attempts`
            (`user_id`, `cycle_id`, `word_key`, `was_ready`, `correct`, `counted`, `selected_meaning`)
         VALUES (:u, :c, :k, :ready, :correct, :counted, 'verify')"
    );

    $cycleStmt->execute([':u' => $userId, ':n' => 1, ':eligible' => 2, ':ready' => 1]);
    $cycle1 = (int) $pdo->lastInsertId();

    $first = kal_test_next_word($pdo, $userId, [
        'id' => $cycle1,
        'eligible_total' => 2,
        'ready_total' => 1,
        'zone_start' => 1,
        'zone_end' => 604,
        'started_at' => date('Y-m-d H:i:s'),
        'completed_at' => null,
    ]);
    kv_assert($first !== null && in_array($first['word_key'], [$keyReady, $keyLocked], true), 'first question comes from the cycle pool', $failures);

    $firstKey = (string) ($first['word_key'] ?? '');
    $attemptStmt->execute([
        ':u' => $userId,
        ':c' => $cycle1,
        ':k' => $firstKey,
        ':ready' => $firstKey === $keyReady ? 1 : 0,
        ':correct' => 1,
        ':counted' => $firstKey === $keyReady ? 1 : 0,
    ]);

    $second = kal_test_next_word($pdo, $userId, [
        'id' => $cycle1,
        'eligible_total' => 2,
        'ready_total' => 1,
        'zone_start' => 1,
        'zone_end' => 604,
        'started_at' => date('Y-m-d H:i:s'),
        'completed_at' => null,
    ]);
    kv_assert(
        $second !== null && $second['word_key'] !== $firstKey && in_array($second['word_key'], [$keyReady, $keyLocked], true),
        'answered word is removed from the queue',
        $failures
    );

    $secondKey = (string) ($second['word_key'] ?? '');
    $attemptStmt->execute([
        ':u' => $userId,
        ':c' => $cycle1,
        ':k' => $secondKey,
        ':ready' => $secondKey === $keyReady ? 1 : 0,
        ':correct' => 1,
        ':counted' => $secondKey === $keyReady ? 1 : 0,
    ]);
    $third = kal_test_next_word($pdo, $userId, [
        'id' => $cycle1,
        'eligible_total' => 2,
        'ready_total' => 1,
        'zone_start' => 1,
        'zone_end' => 604,
        'started_at' => date('Y-m-d H:i:s'),
        'completed_at' => null,
    ]);
    kv_assert($third === null, 'no question remains after every pool word is answered', $failures);

    $finished = kal_test_finish_if_done($pdo, [
        'id' => $cycle1,
        'eligible_total' => 2,
        'ready_total' => 1,
        'zone_start' => 1,
        'zone_end' => 604,
        'started_at' => date('Y-m-d H:i:s'),
        'completed_at' => null,
    ]);
    kv_assert(!empty($finished['completed_at']), 'cycle completes when the queue is empty', $failures);

    // Two more counted cycles -> three counted correct answers -> mastery.
    foreach ([2, 3] as $cycleNo) {
        $cycleStmt->execute([':u' => $userId, ':n' => $cycleNo, ':eligible' => 2, ':ready' => 1]);
        $cycleId = (int) $pdo->lastInsertId();
        $attemptStmt->execute([
            ':u' => $userId,
            ':c' => $cycleId,
            ':k' => $keyReady,
            ':ready' => 1,
            ':correct' => 1,
            ':counted' => 1,
        ]);
    }
    kv_assert(kal_test_correct_count($pdo, $userId, $keyReady) === KALIMAAT_TEST_MASTERY_CORRECT, 'mastery counts one correct answer per cycle', $failures);

    $zeroCount = kal_test_correct_count($pdo, $userId, $keyZero);
    kv_assert($zeroCount === 0, 'words without attempts have zero mastery', $failures);

    $cyclePayload = kal_test_cycle_payload($pdo, [
        'id' => $cycle1,
        'cycle_no' => 1,
        'eligible_total' => 2,
        'ready_total' => 1,
        'zone_start' => 1,
        'zone_end' => 604,
        'started_at' => date('Y-m-d H:i:s'),
        'completed_at' => $finished['completed_at'],
    ]);
    kv_assert($cyclePayload['done'] === 2 && $cyclePayload['remaining'] === 0, 'cycle payload reports complete coverage', $failures);
} catch (Throwable $e) {
    $failures[] = $e->getMessage();
    echo '  ✗ ' . $e->getMessage() . PHP_EOL;
} finally {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
        echo 'Rolled back verification data.' . PHP_EOL;
    }
}

if ($failures) {
    echo PHP_EOL . 'FAILED: ' . count($failures) . ' check(s).' . PHP_EOL;
    exit(1);
}

echo PHP_EOL . 'OK: all kalimaat test-cycle checks passed.' . PHP_EOL;
exit(0);
