<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Migration v15
 *
 *   - Adds `kalimaat_progress.last_tested_at`.
 *   - Creates the server-owned kalimaat test cycle tables:
 *       kalimaat_test_cycles   one row per test cycle per user
 *       kalimaat_test_attempts one row per word per cycle (the queue)
 *   - Backfills existing `test_correct` values into synthetic completed cycles
 *     so no user loses mastery progress during the switch from sessionStorage
 *     test sessions to server-owned cycles.
 *
 * The legacy `last_test_session` column is intentionally kept and ignored at
 * runtime. Safe to run more than once.
 *
 * CLI: php config/migrate_v15.php
 */

if (!isset($pdo) || !($pdo instanceof PDO)) {
    require_once __DIR__ . '/database.php';
}

if (!function_exists('rh_migrate_v15')) {
    /**
     * @return array<string,int>
     */
    function rh_migrate_v15(PDO $pdo, ?callable $log = null): array
    {
        $log = $log ?: static function (string $message): void {};
        $stats = [
            'columns_added'  => 0,
            'tables_created' => 0,
            'indexes_added'  => 0,
            'rows_updated'   => 0,
        ];

        $tableExists = static function (PDO $pdo, string $table): bool {
            // SHOW TABLES is not safely preparable on every MySQL/MariaDB
            // build, so quote the known table name instead of binding it.
            $stmt = $pdo->query('SHOW TABLES LIKE ' . $pdo->quote($table));
            return (bool) $stmt->fetchColumn();
        };

        // 1. Progress timestamp.
        try {
            $column = $pdo->query("SHOW COLUMNS FROM `kalimaat_progress` LIKE 'last_tested_at'")->fetch();
            if (!is_array($column)) {
                $pdo->exec(
                    'ALTER TABLE `kalimaat_progress`
                     ADD COLUMN `last_tested_at` DATETIME NULL AFTER `last_repeated_at`'
                );
                $stats['columns_added']++;
                $log('  + kalimaat_progress.last_tested_at');
            }
        } catch (Throwable $t) {
            throw new RuntimeException(
                'Could not add kalimaat_progress.last_tested_at: ' . $t->getMessage(),
                0,
                $t
            );
        }

        // 2. Cycles.
        try {
            $existed = $tableExists($pdo, 'kalimaat_test_cycles');
            $pdo->exec(
                "CREATE TABLE IF NOT EXISTS `kalimaat_test_cycles` (
                    `id` INT NOT NULL AUTO_INCREMENT,
                    `user_id` INT NOT NULL,
                    `cycle_no` INT NOT NULL,
                    `eligible_total` INT NOT NULL DEFAULT 0,
                    `ready_total` INT NOT NULL DEFAULT 0,
                    `zone_start` SMALLINT UNSIGNED NOT NULL DEFAULT 1,
                    `zone_end` SMALLINT UNSIGNED NOT NULL DEFAULT 604,
                    `started_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    `completed_at` DATETIME NULL,
                    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (`id`),
                    UNIQUE KEY `uq_kalimaat_cycle_no` (`user_id`, `cycle_no`),
                    KEY `idx_kalimaat_cycles_user_state` (`user_id`, `completed_at`, `cycle_no`),
                    CONSTRAINT `fk_kalimaat_cycles_user`
                        FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
                        ON DELETE CASCADE ON UPDATE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
            );
            if (!$existed) {
                $stats['tables_created']++;
            }
        } catch (Throwable $t) {
            throw new RuntimeException(
                'Could not create kalimaat_test_cycles: ' . $t->getMessage(),
                0,
                $t
            );
        }

        // 3. Attempts.
        try {
            $existed = $tableExists($pdo, 'kalimaat_test_attempts');
            $pdo->exec(
                "CREATE TABLE IF NOT EXISTS `kalimaat_test_attempts` (
                    `id` INT NOT NULL AUTO_INCREMENT,
                    `user_id` INT NOT NULL,
                    `cycle_id` INT NOT NULL,
                    `word_key` CHAR(40) NOT NULL,
                    `was_ready` TINYINT NOT NULL DEFAULT 0,
                    `correct` TINYINT NOT NULL DEFAULT 0,
                    `counted` TINYINT NOT NULL DEFAULT 0,
                    `selected_meaning` TEXT NULL,
                    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (`id`),
                    UNIQUE KEY `uq_kalimaat_attempt_word` (`cycle_id`, `word_key`),
                    KEY `idx_kalimaat_attempts_user_word` (`user_id`, `word_key`),
                    KEY `idx_kalimaat_attempts_cycle` (`cycle_id`),
                    CONSTRAINT `fk_kalimaat_attempts_user`
                        FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
                        ON DELETE CASCADE ON UPDATE CASCADE,
                    CONSTRAINT `fk_kalimaat_attempts_cycle`
                        FOREIGN KEY (`cycle_id`) REFERENCES `kalimaat_test_cycles` (`id`)
                        ON DELETE CASCADE ON UPDATE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
            );
            if (!$existed) {
                $stats['tables_created']++;
            }
        } catch (Throwable $t) {
            throw new RuntimeException(
                'Could not create kalimaat_test_attempts: ' . $t->getMessage(),
                0,
                $t
            );
        }

        // 4. Backfill existing mastery into synthetic completed cycles.
        //    Only users who have no cycles yet are touched, which keeps this
        //    block idempotent even if the migration is run repeatedly.
        try {
            $users = $pdo->query(
                "SELECT p.`user_id`, MAX(p.`test_correct`) AS `max_correct`
                   FROM `kalimaat_progress` p
                  WHERE p.`test_correct` > 0
                    AND NOT EXISTS (
                        SELECT 1 FROM `kalimaat_test_cycles` c
                         WHERE c.`user_id` = p.`user_id`
                    )
                  GROUP BY p.`user_id`"
            )->fetchAll();

            if ($users) {
                $wordStmt = $pdo->prepare(
                    "SELECT `word_key`, `meaning`, `test_correct`
                       FROM `kalimaat_progress`
                      WHERE `user_id` = :u AND `test_correct` > 0"
                );
                $cycleStmt = $pdo->prepare(
                    "INSERT INTO `kalimaat_test_cycles`
                        (`user_id`, `cycle_no`, `eligible_total`, `ready_total`,
                         `started_at`, `completed_at`)
                     VALUES (:u, :n, :eligible, :ready, NOW(), NOW())"
                );
                $attemptStmt = $pdo->prepare(
                    "INSERT INTO `kalimaat_test_attempts`
                        (`user_id`, `cycle_id`, `word_key`, `was_ready`, `correct`,
                         `counted`, `selected_meaning`)
                     VALUES (:u, :c, :k, 1, 1, 1, :m)"
                );

                foreach ($users as $userRow) {
                    $userId = (int) $userRow['user_id'];
                    $maxCorrect = max(1, min(3, (int) $userRow['max_correct']));

                    $wordStmt->execute([':u' => $userId]);
                    $words = $wordStmt->fetchAll();
                    if (!$words) {
                        continue;
                    }

                    $ownTransaction = !$pdo->inTransaction();
                    if ($ownTransaction) {
                        $pdo->beginTransaction();
                    }
                    try {
                        $cycleIds = [];
                        for ($n = 1; $n <= $maxCorrect; $n++) {
                            $eligible = 0;
                            foreach ($words as $wordRow) {
                                if (min(3, (int) $wordRow['test_correct']) >= $n) {
                                    $eligible++;
                                }
                            }
                            $cycleStmt->execute([
                                ':u' => $userId,
                                ':n' => $n,
                                ':eligible' => $eligible,
                                ':ready' => $eligible,
                            ]);
                            $cycleIds[$n] = (int) $pdo->lastInsertId();
                            $stats['rows_updated']++;
                        }

                        foreach ($words as $wordRow) {
                            $correct = max(0, min(3, (int) $wordRow['test_correct']));
                            for ($n = 1; $n <= $correct; $n++) {
                                if (!isset($cycleIds[$n])) {
                                    continue;
                                }
                                $attemptStmt->execute([
                                    ':u' => $userId,
                                    ':c' => $cycleIds[$n],
                                    ':k' => (string) $wordRow['word_key'],
                                    ':m' => (string) ($wordRow['meaning'] ?? ''),
                                ]);
                                $stats['rows_updated']++;
                            }
                        }

                        if ($ownTransaction) {
                            $pdo->commit();
                        }
                    } catch (Throwable $t) {
                        if ($ownTransaction && $pdo->inTransaction()) {
                            $pdo->rollBack();
                        }
                        throw $t;
                    }

                    $log('  ~ backfilled ' . $maxCorrect . ' cycle(s) for user #' . $userId);
                }
            }
        } catch (Throwable $t) {
            $log('  ! backfill: ' . $t->getMessage());
            // Mastery data is the one thing this migration must not lose
            // silently. The caller rolls the page back and the admin can retry;
            // each user was committed atomically, so a retry is safe.
            throw $t;
        }

        return $stats;
    }
}

if (PHP_SAPI === 'cli' && !defined('RH_MIGRATION_INCLUDED')) {
    try {
        $stats = rh_migrate_v15($pdo, static function (string $message): void {
            echo $message . PHP_EOL;
        });
        echo 'Migration v15 complete: ' . json_encode($stats, JSON_UNESCAPED_UNICODE) . PHP_EOL;
    } catch (Throwable $t) {
        fwrite(STDERR, 'Migration v15 FAILED: ' . $t->getMessage() . PHP_EOL);
        exit(1);
    }
}
