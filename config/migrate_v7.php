<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Migration v7
 *
 * Adds the rollover counter and the indexes used by the daily-task queries.
 * Consolidates the schema checks that used to run on every API request, which
 * was a major cause of slow requests / 502 errors on shared hosting.
 *
 * Safe to run more than once. Additive only.
 *
 * CLI:   php config/migrate_v7.php
 * Setup: setup.php includes this file and calls rh_migrate_v7().
 * Web:   only if config/.htaccess is temporarily removed, then
 *        https://your-host/config/migrate_v7.php?confirm=1
 */

if (!isset($pdo) || !($pdo instanceof PDO)) {
    require_once __DIR__ . '/database.php';
}

if (!function_exists('rh_v7_columns')) {
    function rh_v7_columns(PDO $pdo, string $table): array
    {
        $cols = [];
        foreach ($pdo->query('SHOW COLUMNS FROM `' . str_replace('`', '', $table) . '`') as $row) {
            $cols[strtolower((string) $row['Field'])] = $row;
        }
        return $cols;
    }
}

if (!function_exists('rh_v7_indexes')) {
    function rh_v7_indexes(PDO $pdo, string $table): array
    {
        $indexes = [];
        foreach ($pdo->query('SHOW INDEX FROM `' . str_replace('`', '', $table) . '`') as $row) {
            $indexes[strtolower((string) $row['Key_name'])] = true;
        }
        return $indexes;
    }
}

if (!function_exists('rh_v7_add_column')) {
    function rh_v7_add_column(PDO $pdo, string $table, string $column, string $definition, callable $log): bool
    {
        $cols = rh_v7_columns($pdo, $table);
        if (isset($cols[strtolower($column)])) {
            return false;
        }
        $pdo->exec(sprintf(
            'ALTER TABLE `%s` ADD COLUMN `%s` %s',
            str_replace('`', '', $table),
            str_replace('`', '', $column),
            $definition
        ));
        $log("  + {$table}.{$column}");
        return true;
    }
}

if (!function_exists('rh_v7_add_index')) {
    function rh_v7_add_index(PDO $pdo, string $table, string $index, string $definition, callable $log): bool
    {
        $indexes = rh_v7_indexes($pdo, $table);
        if (isset($indexes[strtolower($index)])) {
            return false;
        }
        $pdo->exec(sprintf(
            'ALTER TABLE `%s` ADD INDEX `%s` %s',
            str_replace('`', '', $table),
            str_replace('`', '', $index),
            $definition
        ));
        $log("  + index {$index}");
        return true;
    }
}

if (!function_exists('rh_migrate_v7')) {
    /**
     * @return array<string,int> counts of applied changes
     */
    function rh_migrate_v7(PDO $pdo, ?callable $log = null): array
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

        $log('== Rafeequl Hifz migration v7 ==');

        try {
            $pdo->exec('SET SESSION innodb_lock_wait_timeout = 10');
        } catch (Throwable $t) {
            // Not fatal on hosts that do not expose this variable.
        }

        // 1. daily_task_logs columns that older installs may not have.
        $taskColumns = [
            'completed_pages'    => 'TEXT NULL',
            'repetition_count'   => 'INT NOT NULL DEFAULT 0',
            'rub_id'             => 'INT NULL',
            'completed_stations' => 'TEXT NULL',
            'rollover_count'     => 'INT NOT NULL DEFAULT 0',
            'last_rollover_date' => 'DATE NULL',
        ];
        foreach ($taskColumns as $column => $definition) {
            if (rh_v7_add_column($pdo, 'daily_task_logs', $column, $definition, $log)) {
                $stats['columns_added']++;
            }
        }

        // 2. users columns used by the revision plan.
        $userColumns = [
            'murajaah_days'    => 'INT NOT NULL DEFAULT 6',
            'rabt_extra_pages' => 'INT NOT NULL DEFAULT 0',
            'last_tikrar_page' => 'INT NOT NULL DEFAULT 0',
        ];
        foreach ($userColumns as $column => $definition) {
            if (rh_v7_add_column($pdo, 'users', $column, $definition, $log)) {
                $stats['columns_added']++;
            }
        }

        // 3. task_type enum must accept RUB_TAMKIN.
        $taskCols = rh_v7_columns($pdo, 'daily_task_logs');
        $taskType = strtolower((string) ($taskCols['task_type']['Type'] ?? ''));
        if ($taskType !== '' && strpos($taskType, "'rub_tamkin'") === false) {
            $pdo->exec(
                "ALTER TABLE `daily_task_logs`
                 MODIFY COLUMN `task_type`
                 ENUM('HIFZ_JADID', 'TIKRAR_AMS', 'RABT', 'MURAJAAH', 'RUB_TAMKIN', 'MISTAKES') NOT NULL"
            );
            $log('  ~ daily_task_logs.task_type enum updated');
        }

        // 4. rub_history is used by the Rub' rotation. Create it if an old
        //    install never ran migration v6.
        $rubExists = false;
        try {
            $stmt = $pdo->query(
                "SELECT 1 FROM information_schema.TABLES
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'rub_history' LIMIT 1"
            );
            $rubExists = (bool) $stmt->fetchColumn();
        } catch (Throwable $t) {
            $rubExists = false;
        }
        if (!$rubExists) {
            $pdo->exec(
                "CREATE TABLE IF NOT EXISTS `rub_history` (
                    `id` INT NOT NULL AUTO_INCREMENT,
                    `user_id` INT NOT NULL,
                    `rub_id` INT NOT NULL,
                    `last_done_date` DATE NULL,
                    `times_done` INT NOT NULL DEFAULT 0,
                    PRIMARY KEY (`id`),
                    UNIQUE KEY `uq_rub_history_user_rub` (`user_id`, `rub_id`),
                    KEY `idx_rub_history_user_date` (`user_id`, `last_done_date`),
                    CONSTRAINT `fk_rub_history_user`
                        FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
                        ON DELETE CASCADE ON UPDATE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
            );
            $stats['tables_created']++;
            $log('  + table rub_history');
        }

        // 5. Query indexes for the daily-task rollover lookup.
        if (rh_v7_add_index(
            $pdo,
            'daily_task_logs',
            'idx_daily_task_logs_user_type_pending',
            '(`user_id`, `task_type`, `is_completed`, `task_date`)',
            $log
        )) {
            $stats['indexes_added']++;
        }
        if (rh_v7_add_index(
            $pdo,
            'daily_task_logs',
            'idx_daily_task_logs_user_type_date',
            '(`user_id`, `task_type`, `task_date`)',
            $log
        )) {
            $stats['indexes_added']++;
        }

        // 6. Backfill: a pending row starts its rollover clock at its own date.
        $pdo->exec(
            'UPDATE `daily_task_logs`
             SET `last_rollover_date` = `task_date`
             WHERE `last_rollover_date` IS NULL'
        );

        // 7. Old lazy-DDL backfill for accounts that already memorized pages.
        $pdo->exec(
            'UPDATE `users`
             SET `last_tikrar_page` = `current_hifz_page`
             WHERE `last_tikrar_page` = 0 AND `current_hifz_page` > 0'
        );

        $log(sprintf(
            '== Done: %d columns, %d indexes, %d tables ==',
            $stats['columns_added'],
            $stats['indexes_added'],
            $stats['tables_created']
        ));

        return $stats;
    }
}

// Run automatically only when this file is invoked directly (not when setup.php
// includes it to reuse the migration function).
$rhV7IsDirect = basename((string) ($_SERVER['SCRIPT_FILENAME'] ?? '')) === 'migrate_v7.php';
if ($rhV7IsDirect) {
    if (PHP_SAPI !== 'cli') {
        header('Content-Type: text/plain; charset=utf-8');
        if (($_GET['confirm'] ?? '') !== '1') {
            http_response_code(400);
            echo "Refusing to run. Append ?confirm=1 to the URL to apply the migration.\n";
            exit;
        }
    }

    try {
        rh_migrate_v7($pdo);
    } catch (Throwable $e) {
        error_log('[Migration v7] ' . $e->getMessage());
        if (PHP_SAPI !== 'cli') {
            http_response_code(500);
        }
        echo "Migration v7 failed: " . $e->getMessage() . "\n";
        exit(1);
    }
}
