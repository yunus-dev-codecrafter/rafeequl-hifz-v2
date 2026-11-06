<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Migration v12
 *
 * Adds the structured Rub' Consolidation session store:
 *   - `rub_sessions`     one row per revision attempt (plan + progress + totals)
 *   - `rub_results`      one idempotent row per answered exercise item
 *   - `rub_verse_stats`  per-user / per-rub / per-verse spaced-repetition state
 *   - `rub_word_misses`  frequently missed words inside a rub'
 *
 * The existing `daily_task_logs.completed_stations` column keeps holding the
 * legacy word-arrangement progress. Nothing is migrated or deleted here.
 *
 * Safe to run more than once.
 *
 * CLI:   php config/migrate_v12.php
 * Setup: setup.php includes this file and calls rh_migrate_v12().
 */

if (!isset($pdo) || !($pdo instanceof PDO)) {
    require_once __DIR__ . '/database.php';
}
require_once __DIR__ . '/migrate_v11.php';

if (!function_exists('rh_migrate_v12')) {
    /**
     * @return array<string,int> counts of applied changes
     */
    function rh_migrate_v12(PDO $pdo, ?callable $log = null): array
    {
        $log = $log ?? static function (string $message): void {
            echo $message . "\n";
            if (PHP_SAPI !== 'cli') {
                @ob_flush();
                @flush();
            }
        };

        $stats = [
            'tables_created' => 0,
        ];

        $log('== Rafeequl Hifz migration v12 ==');

        $tables = [
            'rub_sessions' => "CREATE TABLE IF NOT EXISTS `rub_sessions` (
                `id` INT NOT NULL AUTO_INCREMENT,
                `user_id` INT NOT NULL,
                `task_id` INT NOT NULL,
                `rub_id` INT NOT NULL,
                `attempt_no` SMALLINT UNSIGNED NOT NULL DEFAULT 1,
                `difficulty` ENUM('BEGINNER','INTERMEDIATE','ADVANCED') NOT NULL DEFAULT 'INTERMEDIATE',
                `status` ENUM('IN_PROGRESS','COMPLETED','ABANDONED') NOT NULL DEFAULT 'IN_PROGRESS',
                `exercises` JSON NOT NULL,
                `plan_json` JSON NOT NULL,
                `progress_json` JSON NULL,
                `sample_size` SMALLINT UNSIGNED NOT NULL DEFAULT 6,
                `allow_outside_rub` TINYINT NOT NULL DEFAULT 1,
                `correct_count` INT NOT NULL DEFAULT 0,
                `wrong_count` INT NOT NULL DEFAULT 0,
                `skipped_count` INT NOT NULL DEFAULT 0,
                `duration_seconds` INT NOT NULL DEFAULT 0,
                `started_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                `completed_at` DATETIME NULL,
                `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (`id`),
                KEY `idx_rub_sessions_user_task` (`user_id`, `task_id`, `status`),
                KEY `idx_rub_sessions_user_rub` (`user_id`, `rub_id`, `completed_at`),
                CONSTRAINT `fk_rub_sessions_user`
                    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
                    ON DELETE CASCADE ON UPDATE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",

            'rub_results' => "CREATE TABLE IF NOT EXISTS `rub_results` (
                `id` INT NOT NULL AUTO_INCREMENT,
                `session_id` INT NOT NULL,
                `user_id` INT NOT NULL,
                `rub_id` INT NOT NULL,
                `exercise` ENUM('WORD_ORDER','MISSING_WORDS','CONTINUE_AYAH','MUTASHABIHAT','PROGRESSIVE_HIDE','INTERRUPT','RANDOM_START','CONNECTION','REVERSE','ERROR_DETECT','NO_PREVIEW') NOT NULL,
                `item_id` VARCHAR(80) NOT NULL,
                `verse_key` VARCHAR(20) NOT NULL,
                `surah_number` SMALLINT UNSIGNED NOT NULL,
                `ayah_number` SMALLINT UNSIGNED NOT NULL,
                `difficulty` ENUM('BEGINNER','INTERMEDIATE','ADVANCED') NOT NULL DEFAULT 'INTERMEDIATE',
                `status` ENUM('ANSWERED','SKIPPED','BOUNDARY_SKIPPED') NOT NULL DEFAULT 'ANSWERED',
                `is_correct` TINYINT NOT NULL DEFAULT 0,
                `attempts` SMALLINT UNSIGNED NOT NULL DEFAULT 1,
                `duration_seconds` INT NOT NULL DEFAULT 0,
                `hint_used` TINYINT NOT NULL DEFAULT 0,
                `outside_rub` TINYINT NOT NULL DEFAULT 0,
                `details` JSON NULL,
                `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (`id`),
                UNIQUE KEY `uq_rub_results_item` (`session_id`, `exercise`, `item_id`),
                KEY `idx_rub_results_user_verse` (`user_id`, `rub_id`, `verse_key`),
                KEY `idx_rub_results_session` (`session_id`),
                CONSTRAINT `fk_rub_results_session`
                    FOREIGN KEY (`session_id`) REFERENCES `rub_sessions` (`id`)
                    ON DELETE CASCADE ON UPDATE CASCADE,
                CONSTRAINT `fk_rub_results_user`
                    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
                    ON DELETE CASCADE ON UPDATE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",

            'rub_verse_stats' => "CREATE TABLE IF NOT EXISTS `rub_verse_stats` (
                `id` INT NOT NULL AUTO_INCREMENT,
                `user_id` INT NOT NULL,
                `rub_id` INT NOT NULL,
                `verse_key` VARCHAR(20) NOT NULL,
                `surah_number` SMALLINT UNSIGNED NOT NULL,
                `ayah_number` SMALLINT UNSIGNED NOT NULL,
                `correct_count` INT NOT NULL DEFAULT 0,
                `wrong_count` INT NOT NULL DEFAULT 0,
                `streak` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
                `interval_days` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
                `ease` DECIMAL(4,2) NOT NULL DEFAULT 2.50,
                `due_at` DATE NULL,
                `last_result` ENUM('CORRECT','WRONG') NULL,
                `last_seen_at` DATETIME NULL,
                `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (`id`),
                UNIQUE KEY `uq_rub_verse_stats_user_verse` (`user_id`, `rub_id`, `verse_key`),
                KEY `idx_rub_verse_stats_user_due` (`user_id`, `due_at`),
                CONSTRAINT `fk_rub_verse_stats_user`
                    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
                    ON DELETE CASCADE ON UPDATE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",

            'rub_word_misses' => "CREATE TABLE IF NOT EXISTS `rub_word_misses` (
                `id` INT NOT NULL AUTO_INCREMENT,
                `user_id` INT NOT NULL,
                `rub_id` INT NOT NULL,
                `verse_key` VARCHAR(20) NOT NULL,
                `word_index` SMALLINT UNSIGNED NOT NULL,
                `word_text` VARCHAR(190) NOT NULL,
                `miss_count` INT NOT NULL DEFAULT 1,
                `last_missed_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (`id`),
                UNIQUE KEY `uq_rub_word_misses_user_word` (`user_id`, `rub_id`, `verse_key`, `word_index`),
                KEY `idx_rub_word_misses_user_rub` (`user_id`, `rub_id`, `miss_count`),
                CONSTRAINT `fk_rub_word_misses_user`
                    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
                    ON DELETE CASCADE ON UPDATE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        ];

        foreach ($tables as $table => $sql) {
            $exists = false;
            try {
                $exists = (bool) $pdo->query("SHOW TABLES LIKE '" . $table . "'")->fetchColumn();
            } catch (Throwable $t) {
                $exists = false;
            }
            if ($exists) {
                continue;
            }
            try {
                $pdo->exec($sql);
                $stats['tables_created']++;
                $log('  + table ' . $table);
            } catch (Throwable $t) {
                $log('  ! could not create ' . $table . ': ' . $t->getMessage());
            }
        }

        $log(sprintf('== Done: %d table(s) created ==', $stats['tables_created']));

        return $stats;
    }
}

// Run automatically only when this file is invoked directly.
$rhV12IsDirect = basename((string) ($_SERVER['SCRIPT_FILENAME'] ?? '')) === 'migrate_v12.php';
if ($rhV12IsDirect) {
    if (PHP_SAPI !== 'cli') {
        header('Content-Type: text/plain; charset=utf-8');
        if (($_GET['confirm'] ?? '') !== '1') {
            http_response_code(400);
            echo "Refusing to run. Append ?confirm=1 to the URL to apply the migration.\n";
            exit;
        }
    }

    try {
        rh_migrate_v12($pdo);
    } catch (Throwable $e) {
        error_log('[Migration v12] ' . $e->getMessage());
        if (PHP_SAPI !== 'cli') {
            http_response_code(500);
        }
        echo "Migration v12 failed: " . $e->getMessage() . "\n";
        exit(1);
    }
}
