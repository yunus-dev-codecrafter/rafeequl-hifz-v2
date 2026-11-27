<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Migration v18
 *
 *   - Creates `prayer_recitations` table for the "تلاوة الصلاة" (Prayer Recitation Companion).
 *   - Enables students to select short, medium, or long portions from their memorized range
 *     with suitable beginnings (الابتداء الحسن), and tracks passages requiring repetition.
 *
 * Safe to run more than once (idempotent).
 *
 * CLI: php config/migrate_v18.php
 */

if (!isset($pdo) || !($pdo instanceof PDO)) {
    require_once __DIR__ . '/database.php';
}

if (!function_exists('rh_migrate_v18')) {
    /**
     * @return array<string,int>
     */
    function rh_migrate_v18(PDO $pdo, ?callable $log = null): array
    {
        $log = $log ?: static function (string $message): void {};
        $stats = [
            'tables_created' => 0,
        ];

        $tableExists = static function (PDO $pdo, string $table): bool {
            try {
                $stmt = $pdo->prepare('SHOW TABLES LIKE :t');
                $stmt->execute([':t' => $table]);
                return (bool) $stmt->fetchColumn();
            } catch (Throwable $t) {
                return false;
            }
        };

        if (!$tableExists($pdo, 'prayer_recitations')) {
            try {
                $pdo->exec(
                    "CREATE TABLE IF NOT EXISTS `prayer_recitations` (
                        `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                        `user_id` INT NOT NULL,
                        `surah_number` SMALLINT UNSIGNED NOT NULL,
                        `start_ayah` SMALLINT UNSIGNED NOT NULL,
                        `end_ayah` SMALLINT UNSIGNED NOT NULL,
                        `length_type` ENUM('SHORT', 'MEDIUM', 'LONG') NOT NULL DEFAULT 'SHORT',
                        `cycle_number` INT UNSIGNED NOT NULL DEFAULT 1,
                        `status` ENUM('PRESENTED', 'PENDING_RETRY', 'MASTERED') NOT NULL DEFAULT 'PRESENTED',
                        `attempts` INT UNSIGNED NOT NULL DEFAULT 1,
                        `last_recited_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                        `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        KEY `idx_pr_user_cycle` (`user_id`, `cycle_number`, `status`),
                        KEY `idx_pr_user_status` (`user_id`, `status`),
                        KEY `idx_pr_user_surah` (`user_id`, `surah_number`),
                        CONSTRAINT `fk_prayer_recitations_user`
                            FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
                            ON DELETE CASCADE ON UPDATE CASCADE
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
                );
                $stats['tables_created']++;
                $log('  + created table `prayer_recitations`');
            } catch (Throwable $t) {
                $log('  ! error creating `prayer_recitations`: ' . $t->getMessage());
            }
        } else {
            $log('  ~ table `prayer_recitations` already exists');
            // Check for cycle_number column
            try {
                $cStmt = $pdo->prepare("SHOW COLUMNS FROM `prayer_recitations` LIKE 'cycle_number'");
                $cStmt->execute();
                if (!$cStmt->fetch()) {
                    $pdo->exec("ALTER TABLE `prayer_recitations` ADD COLUMN `cycle_number` INT UNSIGNED NOT NULL DEFAULT 1 AFTER `length_type`");
                    $pdo->exec("ALTER TABLE `prayer_recitations` ADD KEY `idx_pr_user_cycle` (`user_id`, `cycle_number`, `status`)");
                    $log('  + added column `cycle_number` and index to `prayer_recitations`');
                }
            } catch (Throwable $t) {
                $log('  ! warning checking cycle_number column: ' . $t->getMessage());
            }

            // Check if PRESENTED is in status enum
            try {
                $pdo->exec("ALTER TABLE `prayer_recitations` MODIFY COLUMN `status` ENUM('PRESENTED', 'PENDING_RETRY', 'MASTERED') NOT NULL DEFAULT 'PRESENTED'");
                $log('  + updated status ENUM to include PRESENTED');
            } catch (Throwable $t) {
                // If already updated or error, continue
            }
        }

        return $stats;
    }
}

if (php_sapi_name() === 'cli' && realpath($argv[0] ?? '') === __FILE__) {
    echo "Running migration v18...\n";
    $log = static function (string $msg): void {
        echo $msg . "\n";
    };
    try {
        $stats = rh_migrate_v18($pdo, $log);
        echo "Migration v18 finished: " . json_encode($stats) . "\n";
    } catch (Throwable $t) {
        fwrite(STDERR, "Migration v18 failed: " . $t->getMessage() . "\n");
        exit(1);
    }
}
