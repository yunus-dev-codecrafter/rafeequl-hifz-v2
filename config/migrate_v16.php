<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Migration v16
 *
 *   - Adds `users.tafreet_count` (total penalty strikes).
 *   - Adds `users.last_tafreet_check_date` (date up to which missed days were audited).
 *   - Adds `users.rabt_base_pages` (base rabt capacity, can reduce to 0 during pause and rebuild upon resume).
 *   - Creates `tafreet_logs` table (record of every يوم تفريط).
 *   - Creates `user_absences` table (student planned absences, max 30 days).
 *
 * Safe to run more than once.
 *
 * CLI: php config/migrate_v16.php
 */

if (!isset($pdo) || !($pdo instanceof PDO)) {
    require_once __DIR__ . '/database.php';
}

if (!function_exists('rh_migrate_v16')) {
    /**
     * @return array<string,int>
     */
    function rh_migrate_v16(PDO $pdo, ?callable $log = null): array
    {
        $log = $log ?: static function (string $message): void {};
        $stats = [
            'columns_added'  => 0,
            'tables_created' => 0,
            'indexes_added'  => 0,
            'rows_updated'   => 0,
        ];

        $tableExists = static function (PDO $pdo, string $table): bool {
            $stmt = $pdo->query('SHOW TABLES LIKE ' . $pdo->quote($table));
            return (bool) $stmt->fetchColumn();
        };

        // 1. users columns
        $userCols = [
            'tafreet_count' => "ALTER TABLE `users` ADD COLUMN `tafreet_count` INT NOT NULL DEFAULT 0 AFTER `status_reason`",
            'last_tafreet_check_date' => "ALTER TABLE `users` ADD COLUMN `last_tafreet_check_date` DATE NULL AFTER `tafreet_count`",
            'rabt_base_pages' => "ALTER TABLE `users` ADD COLUMN `rabt_base_pages` INT NOT NULL DEFAULT 30 AFTER `rabt_extra_pages`",
        ];

        foreach ($userCols as $col => $sql) {
            try {
                $column = $pdo->query("SHOW COLUMNS FROM `users` LIKE '{$col}'")->fetch();
                if (!is_array($column)) {
                    $pdo->exec($sql);
                    $stats['columns_added']++;
                    $log("  + users.{$col}");
                }
            } catch (Throwable $t) {
                throw new RuntimeException("Could not add users.{$col}: " . $t->getMessage(), 0, $t);
            }
        }

        // Initialize last_tafreet_check_date to today for existing users so they don't get retroactively penalized
        try {
            $today = date('Y-m-d');
            $stmt = $pdo->prepare('UPDATE `users` SET `last_tafreet_check_date` = :today WHERE `last_tafreet_check_date` IS NULL');
            $stmt->execute([':today' => $today]);
            $stats['rows_updated'] += $stmt->rowCount();
        } catch (Throwable $t) {
            // non-fatal
        }

        // 2. tafreet_logs table
        try {
            $existed = $tableExists($pdo, 'tafreet_logs');
            $pdo->exec(
                "CREATE TABLE IF NOT EXISTS `tafreet_logs` (
                    `id` INT NOT NULL AUTO_INCREMENT,
                    `user_id` INT NOT NULL,
                    `missed_date` DATE NOT NULL,
                    `reason` VARCHAR(255) NOT NULL DEFAULT 'MISSED_DAY',
                    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (`id`),
                    UNIQUE KEY `uq_tafreet_user_date` (`user_id`, `missed_date`),
                    KEY `idx_tafreet_user` (`user_id`),
                    CONSTRAINT `fk_tafreet_logs_user`
                        FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
                        ON DELETE CASCADE ON UPDATE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
            );
            if (!$existed && $tableExists($pdo, 'tafreet_logs')) {
                $stats['tables_created']++;
                $log('  + table tafreet_logs');
            }
        } catch (Throwable $t) {
            throw new RuntimeException('Could not create tafreet_logs: ' . $t->getMessage(), 0, $t);
        }

        // 3. user_absences table
        try {
            $existed = $tableExists($pdo, 'user_absences');
            $pdo->exec(
                "CREATE TABLE IF NOT EXISTS `user_absences` (
                    `id` INT NOT NULL AUTO_INCREMENT,
                    `user_id` INT NOT NULL,
                    `absence_date` DATE NOT NULL,
                    `notes` VARCHAR(255) NULL,
                    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (`id`),
                    UNIQUE KEY `uq_absence_user_date` (`user_id`, `absence_date`),
                    KEY `idx_absence_user` (`user_id`),
                    CONSTRAINT `fk_user_absences_user`
                        FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
                        ON DELETE CASCADE ON UPDATE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
            );
            if (!$existed && $tableExists($pdo, 'user_absences')) {
                $stats['tables_created']++;
                $log('  + table user_absences');
            }
        } catch (Throwable $t) {
            throw new RuntimeException('Could not create user_absences: ' . $t->getMessage(), 0, $t);
        }

        return $stats;
    }
}

if (php_sapi_name() === 'cli' && realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    echo "Running migration v16...\n";
    try {
        $stats = rh_migrate_v16($pdo, static function (string $msg): void {
            echo "{$msg}\n";
        });
        echo "Done: " . json_encode($stats) . "\n";
    } catch (Throwable $t) {
        fwrite(STDERR, "Error: " . $t->getMessage() . "\n");
        exit(1);
    }
}
