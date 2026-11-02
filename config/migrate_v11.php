<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Migration v11
 *
 * Adds the "flagged waqf" feature:
 *   - `waqf_flags` stores one exact stop-station inside an ayah that the user
 *     marked after a mistake. Each flag is practised 10 times and can be
 *     deleted manually once complete.
 *   - `users.gate_waqf_id` / `users.gate_waqf_locked_at` keep one flag locked in
 *     the third step of the entry gate.
 *
 * It also applies the new completion rule for ordinary mistakes: a mistake is
 * hard-deleted when it reaches its 40-repetition target, so existing ARCHIVED
 * rows are purged now. The mistake_events audit columns keep their anonymous
 * history (the foreign key is ON DELETE SET NULL).
 *
 * Safe to run more than once.
 *
 * CLI:   php config/migrate_v11.php
 * Setup: setup.php includes this file and calls rh_migrate_v11().
 */

if (!isset($pdo) || !($pdo instanceof PDO)) {
    require_once __DIR__ . '/database.php';
}
require_once __DIR__ . '/migrate_v10.php';

if (!function_exists('rh_migrate_v11')) {
    /**
     * @return array<string,int> counts of applied changes
     */
    function rh_migrate_v11(PDO $pdo, ?callable $log = null): array
    {
        $log = $log ?? static function (string $message): void {
            echo $message . "\n";
            if (PHP_SAPI !== 'cli') {
                @ob_flush();
                @flush();
            }
        };

        $stats = [
            'columns_added'  => 0,
            'indexes_added'  => 0,
            'tables_created' => 0,
            'mistakes_purged' => 0,
        ];

        $log('== Rafeequl Hifz migration v11 ==');

        // 1. One row per flagged stop-station.
        $exists = false;
        try {
            $exists = (bool) $pdo->query("SHOW TABLES LIKE 'waqf_flags'")->fetchColumn();
        } catch (Throwable $t) {
            $exists = false;
        }

        if (!$exists) {
            $pdo->exec(
                "CREATE TABLE `waqf_flags` (
                    `id` INT NOT NULL AUTO_INCREMENT,
                    `user_id` INT NOT NULL,
                    `rub_id` INT NOT NULL,
                    `surah_number` SMALLINT UNSIGNED NOT NULL,
                    `ayah_number` SMALLINT UNSIGNED NOT NULL,
                    `page_number` SMALLINT UNSIGNED NOT NULL,
                    `segment_index` SMALLINT UNSIGNED NOT NULL,
                    `station_key` VARCHAR(32) NOT NULL,
                    `segment_text` TEXT NOT NULL,
                    `stop_sign` VARCHAR(16) NULL,
                    `notes` TEXT NULL,
                    `status` ENUM('ACTIVE','ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
                    `practice_count` INT NOT NULL DEFAULT 0,
                    `practice_target` INT NOT NULL DEFAULT 10,
                    `occurrence_count` INT NOT NULL DEFAULT 1,
                    `last_reviewed_at` DATETIME NULL,
                    `graduated_at` DATETIME NULL,
                    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    PRIMARY KEY (`id`),
                    UNIQUE KEY `uq_waqf_flags_user_station` (`user_id`, `station_key`),
                    KEY `idx_waqf_flags_user_status_practice` (`user_id`, `status`, `practice_count`),
                    KEY `idx_waqf_flags_user_rub` (`user_id`, `rub_id`),
                    CONSTRAINT `fk_waqf_flags_user`
                        FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
                        ON DELETE CASCADE ON UPDATE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
            );
            $stats['tables_created']++;
            $log('  + table waqf_flags');
        }

        // 2. The flagged waqf currently locked by the entry gate.
        if (function_exists('rh_v7_add_column')) {
            if (rh_v7_add_column($pdo, 'users', 'gate_waqf_id', 'INT NULL', $log)) {
                $stats['columns_added']++;
            }
            if (rh_v7_add_column($pdo, 'users', 'gate_waqf_locked_at', 'DATETIME NULL', $log)) {
                $stats['columns_added']++;
            }
        } else {
            $log('  ! column helper unavailable; skipping users.gate_waqf_id');
        }

        // 3. Completed mistake cards are no longer kept.
        try {
            $stats['mistakes_purged'] = (int) $pdo->exec(
                "DELETE FROM `mistakes` WHERE `status` = 'ARCHIVED'"
            );
            if ($stats['mistakes_purged'] > 0) {
                $log('  - purged ' . $stats['mistakes_purged'] . ' archived mistake(s)');
            }
        } catch (Throwable $t) {
            $log('  ! could not purge archived mistakes: ' . $t->getMessage());
        }

        $log(sprintf(
            '== Done: %d columns, %d indexes, %d tables, %d mistakes purged ==',
            $stats['columns_added'],
            $stats['indexes_added'],
            $stats['tables_created'],
            $stats['mistakes_purged']
        ));

        return $stats;
    }
}

// Run automatically only when this file is invoked directly.
$rhV11IsDirect = basename((string) ($_SERVER['SCRIPT_FILENAME'] ?? '')) === 'migrate_v11.php';
if ($rhV11IsDirect) {
    if (PHP_SAPI !== 'cli') {
        header('Content-Type: text/plain; charset=utf-8');
        if (($_GET['confirm'] ?? '') !== '1') {
            http_response_code(400);
            echo "Refusing to run. Append ?confirm=1 to the URL to apply the migration.\n";
            exit;
        }
    }

    try {
        rh_migrate_v11($pdo);
    } catch (Throwable $e) {
        error_log('[Migration v11] ' . $e->getMessage());
        if (PHP_SAPI !== 'cli') {
            http_response_code(500);
        }
        echo "Migration v11 failed: " . $e->getMessage() . "\n";
        exit(1);
    }
}
