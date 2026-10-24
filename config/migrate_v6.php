<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Migration v6: Rub' Consolidation (RUB_TAMKIN).
 *
 * Adds:
 *   - daily_task_logs.task_type value 'RUB_TAMKIN' (+ 'MISTAKES', used only
 *     transiently but kept valid so the enum never truncates a row).
 *   - daily_task_logs.rub_id
 *   - daily_task_logs.completed_stations (JSON array of station keys)
 *   - mistakes.source_task value 'RUB_TAMKIN'
 *   - rub_history table (fair random rotation, one rub' per day)
 *
 * Safe to run more than once (idempotent). No existing rows are modified.
 *
 * Run (CLI):   php config/migrate_v6.php
 * Run (web):   https://your-host/config/migrate_v6.php?confirm=1
 */

require __DIR__ . '/database.php';

if (PHP_SAPI !== 'cli') {
    header('Content-Type: text/plain; charset=utf-8');
    if (($_GET['confirm'] ?? '') !== '1') {
        http_response_code(400);
        echo "Refusing to run. Append ?confirm=1 to the URL to apply the migration.\n";
        exit;
    }
}

$log = static function (string $msg): void {
    echo $msg . "\n";
    if (PHP_SAPI !== 'cli') { @ob_flush(); @flush(); }
};

$columnExists = static function (PDO $pdo, string $table, string $column): bool {
    $stmt = $pdo->prepare(
        'SELECT COUNT(*) FROM `information_schema`.`COLUMNS`
         WHERE `TABLE_SCHEMA` = DATABASE() AND `TABLE_NAME` = :t AND `COLUMN_NAME` = :c'
    );
    $stmt->execute([':t' => $table, ':c' => $column]);
    return ((int) $stmt->fetchColumn()) > 0;
};

$log('== Rafeequl Hifz migration v6 (rub consolidation) ==');

try {
    // 1. daily_task_logs.task_type enum
    try {
        $pdo->exec(
            "ALTER TABLE `daily_task_logs` MODIFY COLUMN `task_type`
             ENUM('HIFZ_JADID', 'TIKRAR_AMS', 'RABT', 'MURAJAAH', 'RUB_TAMKIN', 'MISTAKES') NOT NULL"
        );
        $log('- task_type enum updated.');
    } catch (Throwable $t) {
        $log('! could not update task_type enum: ' . $t->getMessage());
    }

    // 2. rub columns
    if (!$columnExists($pdo, 'daily_task_logs', 'rub_id')) {
        $pdo->exec("ALTER TABLE `daily_task_logs` ADD COLUMN `rub_id` INT NULL AFTER `repetition_count`");
        $log('+ added daily_task_logs.rub_id');
    } else {
        $log('- daily_task_logs.rub_id already present.');
    }

    if (!$columnExists($pdo, 'daily_task_logs', 'completed_stations')) {
        $pdo->exec("ALTER TABLE `daily_task_logs` ADD COLUMN `completed_stations` TEXT NULL AFTER `rub_id`");
        $log('+ added daily_task_logs.completed_stations');
    } else {
        $log('- daily_task_logs.completed_stations already present.');
    }

    // 3. mistakes.source_task enum
    try {
        $pdo->exec(
            "ALTER TABLE `mistakes` MODIFY COLUMN `source_task`
             ENUM('HIFZ_JADID', 'TIKRAR_AMS', 'RABT', 'MURAJAAH', 'RUB_TAMKIN') NULL"
        );
        $log('- mistakes.source_task enum updated.');
    } catch (Throwable $t) {
        $log('! could not update mistakes.source_task enum: ' . $t->getMessage());
    }

    // 4. rub_history
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
    $log('- table rub_history ready.');

    // 5. Sanity: catalog present?
    $catalog = __DIR__ . '/../api/data/rub_quarters.json';
    if (is_file($catalog)) {
        $decoded = json_decode((string) file_get_contents($catalog), true);
        $count = is_array($decoded['rubs'] ?? null) ? count($decoded['rubs']) : 0;
        $log('- rub catalog: ' . $count . ' rub\'s.');
        if ($count !== 240) {
            $log('! expected 240 rub\'s; run config/build_rub_quarters.php.');
        }
    } else {
        $log('! api/data/rub_quarters.json is missing; run config/build_rub_quarters.php.');
    }

    $log('== Migration v6 complete ==');
} catch (PDOException $e) {
    error_log('[MigrateV6 Failed] ' . $e->getMessage());
    http_response_code(500);
    echo 'Migration failed: ' . $e->getMessage() . "\n";
    exit(1);
}
