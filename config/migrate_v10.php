<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Migration v10
 *
 * Adds the معاني كلمات القرآن progress store and the small piece of state the
 * entry gate needs to keep one mistake card locked until its 40-repetition
 * target is reached.
 *
 * The kalimaat catalog itself is static content (web/data/kalimaat/), exactly
 * like the Qur'an text and tafsir bundles. This migration only creates the
 * per-user progress table.
 *
 * Safe to run more than once.
 *
 * CLI:   php config/migrate_v10.php
 * Setup: setup.php includes this file and calls rh_migrate_v10().
 */

if (!isset($pdo) || !($pdo instanceof PDO)) {
    require_once __DIR__ . '/database.php';
}
require_once __DIR__ . '/migrate_v9.php';

if (!function_exists('rh_migrate_v10')) {
    /**
     * @return array<string,int> counts of applied changes
     */
    function rh_migrate_v10(PDO $pdo, ?callable $log = null): array
    {
        $log = $log ?? static function (string $message): void {
            echo $message . "\n";
            if (PHP_SAPI !== 'cli') {
                @ob_flush();
                @flush();
            }
        };

        $stats = [
            'columns_added' => 0,
            'indexes_added' => 0,
            'tables_created' => 0,
        ];

        $log('== Rafeequl Hifz migration v10 ==');

        // 1. Per-user kalimaat progress.
        $exists = false;
        try {
            $exists = (bool) $pdo->query("SHOW TABLES LIKE 'kalimaat_progress'")->fetchColumn();
        } catch (Throwable $t) {
            $exists = false;
        }

        if (!$exists) {
            $pdo->exec(
                "CREATE TABLE `kalimaat_progress` (
                    `id` INT NOT NULL AUTO_INCREMENT,
                    `user_id` INT NOT NULL,
                    `word_key` CHAR(40) NOT NULL,
                    `word_text` VARCHAR(190) NOT NULL,
                    `meaning` TEXT NOT NULL,
                    `book_name` VARCHAR(190) NULL,
                    `surah_number` SMALLINT UNSIGNED NOT NULL,
                    `ayah_number` SMALLINT UNSIGNED NOT NULL,
                    `page_number` SMALLINT UNSIGNED NOT NULL,
                    `repeat_count` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
                    `status` ENUM('LOCKED','READY','MASTERED') NOT NULL DEFAULT 'LOCKED',
                    `locked_at` DATETIME NULL,
                    `last_repeated_at` DATETIME NULL,
                    `test_attempts` INT NOT NULL DEFAULT 0,
                    `test_correct` INT NOT NULL DEFAULT 0,
                    `last_test_session` CHAR(40) NULL,
                    `mastered_at` DATETIME NULL,
                    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    PRIMARY KEY (`id`),
                    UNIQUE KEY `uq_kalimaat_user_word` (`user_id`, `word_key`),
                    KEY `idx_kalimaat_user_status` (`user_id`, `status`),
                    KEY `idx_kalimaat_user_repeat` (`user_id`, `repeat_count`),
                    KEY `idx_kalimaat_user_page` (`user_id`, `page_number`),
                    CONSTRAINT `fk_kalimaat_progress_user`
                        FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
                        ON DELETE CASCADE ON UPDATE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
            );
            $stats['tables_created']++;
            $log('  + table kalimaat_progress');
        }

        // 1b. One correct answer per test session counts toward mastery.
        if (function_exists('rh_v7_add_column')) {
            if (rh_v7_add_column($pdo, 'kalimaat_progress', 'last_test_session', 'CHAR(40) NULL', $log)) {
                $stats['columns_added']++;
            }
        } else {
            $log('  ! column helper unavailable; skipping kalimaat_progress.last_test_session');
        }

        // 2. The mistake card currently locked by the entry gate.
        if (function_exists('rh_v7_add_column')) {
            if (rh_v7_add_column($pdo, 'users', 'gate_mistake_id', 'INT NULL', $log)) {
                $stats['columns_added']++;
            }
            if (rh_v7_add_column($pdo, 'users', 'gate_mistake_locked_at', 'DATETIME NULL', $log)) {
                $stats['columns_added']++;
            }
        } else {
            $log('  ! column helper unavailable; skipping users.gate_mistake_id');
        }

        $log(sprintf(
            '== Done: %d columns, %d indexes, %d tables ==',
            $stats['columns_added'],
            $stats['indexes_added'],
            $stats['tables_created']
        ));

        return $stats;
    }
}

// Run automatically only when this file is invoked directly.
$rhV10IsDirect = basename((string) ($_SERVER['SCRIPT_FILENAME'] ?? '')) === 'migrate_v10.php';
if ($rhV10IsDirect) {
    if (PHP_SAPI !== 'cli') {
        header('Content-Type: text/plain; charset=utf-8');
        if (($_GET['confirm'] ?? '') !== '1') {
            http_response_code(400);
            echo "Refusing to run. Append ?confirm=1 to the URL to apply the migration.\n";
            exit;
        }
    }

    try {
        rh_migrate_v10($pdo);
    } catch (Throwable $e) {
        error_log('[Migration v10] ' . $e->getMessage());
        if (PHP_SAPI !== 'cli') {
            http_response_code(500);
        }
        echo "Migration v10 failed: " . $e->getMessage() . "\n";
        exit(1);
    }
}
