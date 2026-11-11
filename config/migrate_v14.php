<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Migration v14
 *
 *   - Adds PAGE_TAMKIN to daily_task_logs.task_type and mistakes.source_task.
 *   - Creates the page-by-page consolidation tables:
 *       consolidation_selections  user's chosen weak surah / rub' / page
 *       consolidation_pages       per-user page state and recent history
 *
 * The legacy rub' tables are intentionally left untouched so historical data is
 * never destroyed. Runtime code stops using them.
 *
 * Safe to run more than once.
 *
 * CLI: php config/migrate_v14.php
 */

if (!isset($pdo) || !($pdo instanceof PDO)) {
    require_once __DIR__ . '/database.php';
}

if (!function_exists('rh_migrate_v14')) {
    /**
     * @return array<string,int>
     */
    function rh_migrate_v14(PDO $pdo, ?callable $log = null): array
    {
        $log = $log ?: static function (string $message): void {};
        $stats = [
            'enum_updates'   => 0,
            'columns_added'  => 0,
            'tables_created' => 0,
            'indexes_added'  => 0,
            'rows_updated'   => 0,
        ];

        $applyEnum = static function (PDO $pdo, string $table, string $column, string $definition, array $required, callable $log): bool {
            try {
                $stmt = $pdo->query(
                    "SHOW COLUMNS FROM `$table` LIKE " . $pdo->quote($column)
                );
                $row = $stmt ? $stmt->fetch() : false;
                if (!is_array($row)) {
                    return false;
                }
                $type = (string) ($row['Type'] ?? '');
                foreach ($required as $value) {
                    if (strpos($type, "'" . $value . "'") === false) {
                        $pdo->exec("ALTER TABLE `$table` MODIFY `$column` " . $definition);
                        $log('  ~ ' . $table . '.' . $column . ' enum extended');
                        return true;
                    }
                }
            } catch (Throwable $t) {
                $log('  ! ' . $table . '.' . $column . ': ' . $t->getMessage());
            }
            return false;
        };

        // 1. Task type.
        if ($applyEnum(
            $pdo,
            'daily_task_logs',
            'task_type',
            "ENUM('HIFZ_JADID','TIKRAR_AMS','RABT','MURAJAAH','RUB_TAMKIN','MISTAKES','PAGE_TAMKIN') NOT NULL",
            ['PAGE_TAMKIN'],
            $log
        )) {
            $stats['enum_updates']++;
        }

        // 2. Mistake source task.
        if ($applyEnum(
            $pdo,
            'mistakes',
            'source_task',
            "ENUM('HIFZ_JADID','TIKRAR_AMS','RABT','MURAJAAH','RUB_TAMKIN','PAGE_TAMKIN') NULL",
            ['PAGE_TAMKIN'],
            $log
        )) {
            $stats['enum_updates']++;
        }

        // 3. Tables.
        try {
            $pdo->exec(
                "CREATE TABLE IF NOT EXISTS `consolidation_selections` (
                    `id` INT NOT NULL AUTO_INCREMENT,
                    `user_id` INT NOT NULL,
                    `target_type` ENUM('SURAH','RUB','PAGE') NOT NULL,
                    `target_id` INT NOT NULL,
                    `status` ENUM('ACTIVE','COMPLETED','REMOVED') NOT NULL DEFAULT 'ACTIVE',
                    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    `completed_at` DATETIME NULL,
                    PRIMARY KEY (`id`),
                    UNIQUE KEY `uq_consolidation_selection` (`user_id`, `target_type`, `target_id`),
                    KEY `idx_consolidation_selections_user` (`user_id`, `status`, `created_at`),
                    CONSTRAINT `fk_consolidation_selections_user`
                        FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
                        ON DELETE CASCADE ON UPDATE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
            );
            $stats['tables_created']++;
            $log('  + consolidation_selections');
        } catch (Throwable $t) {
            $log('  ! consolidation_selections: ' . $t->getMessage());
        }

        try {
            $pdo->exec(
                "CREATE TABLE IF NOT EXISTS `consolidation_pages` (
                    `id` INT NOT NULL AUTO_INCREMENT,
                    `user_id` INT NOT NULL,
                    `page_number` INT NOT NULL,
                    `selection_id` INT NULL,
                    `source` ENUM('SURAH','RUB','PAGE','AUTO') NOT NULL DEFAULT 'AUTO',
                    `status` ENUM('PENDING','DONE') NOT NULL DEFAULT 'PENDING',
                    `last_result` ENUM('DONE','IMPROVE') NULL,
                    `attempts` INT NOT NULL DEFAULT 0,
                    `times_done` INT NOT NULL DEFAULT 0,
                    `last_done_date` DATE NULL,
                    `completed_at` DATETIME NULL,
                    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    PRIMARY KEY (`id`),
                    UNIQUE KEY `uq_consolidation_page` (`user_id`, `page_number`),
                    KEY `idx_consolidation_pages_user_status` (`user_id`, `status`, `last_done_date`),
                    KEY `idx_consolidation_pages_selection` (`selection_id`),
                    CONSTRAINT `fk_consolidation_pages_user`
                        FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
                        ON DELETE CASCADE ON UPDATE CASCADE,
                    CONSTRAINT `fk_consolidation_pages_selection`
                        FOREIGN KEY (`selection_id`) REFERENCES `consolidation_selections` (`id`)
                        ON DELETE SET NULL ON UPDATE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
            );
            $stats['tables_created']++;
            $log('  + consolidation_pages');
        } catch (Throwable $t) {
            $log('  ! consolidation_pages: ' . $t->getMessage());
        }

        return $stats;
    }
}

if (PHP_SAPI === 'cli' && !defined('RH_MIGRATION_INCLUDED')) {
    $stats = rh_migrate_v14($pdo, static function (string $message): void {
        echo $message . PHP_EOL;
    });
    echo 'Migration v14 complete: ' . json_encode($stats, JSON_UNESCAPED_UNICODE) . PHP_EOL;
}
