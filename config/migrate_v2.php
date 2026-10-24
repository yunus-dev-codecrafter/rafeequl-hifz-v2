<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Migration v2: Spaced-Repetition mistake model.
 *
 * Brings an EXISTING v1 database up to the v2 schema without touching data:
 *   - adds scheduling / analytics columns to `mistakes`
 *   - creates the `mistake_events` audit table
 *
 * Safe to run more than once (every step is checked first).
 *
 * Run (CLI):   php config/migrate_v2.php
 * Run (web):   https://your-host/config/migrate_v2.php?confirm=1
 *
 * The web mode is guarded so it cannot run by accident.
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

$log('== Rafeequl Hifz migration v2 ==');

// 1. Columns to add to `mistakes` (name => DDL fragment).
$columns = [
    'severity'           => "ADD COLUMN `severity` TINYINT NOT NULL DEFAULT 1 AFTER `notes`",
    'confused_with_surah' => "ADD COLUMN `confused_with_surah` INT NULL AFTER `severity`",
    'confused_with_ayah'  => "ADD COLUMN `confused_with_ayah` INT NULL AFTER `confused_with_surah`",
    'source_task'        => "ADD COLUMN `source_task` ENUM('HIFZ_JADID','TIKRAR_AMS','RABT','MURAJAAH','RUB_TAMKIN') NULL AFTER `confused_with_ayah`",
    'occurrence_count'   => "ADD COLUMN `occurrence_count` INT NOT NULL DEFAULT 1 AFTER `mastery_count`",
    'interval_days'      => "ADD COLUMN `interval_days` INT NOT NULL DEFAULT 0 AFTER `occurrence_count`",
    'ease'               => "ADD COLUMN `ease` DECIMAL(3,2) NOT NULL DEFAULT 2.50 AFTER `interval_days`",
    'lapses'             => "ADD COLUMN `lapses` INT NOT NULL DEFAULT 0 AFTER `ease`",
    'streak_correct'     => "ADD COLUMN `streak_correct` INT NOT NULL DEFAULT 0 AFTER `lapses`",
    'due_at'             => "ADD COLUMN `due_at` DATETIME NULL AFTER `streak_correct`",
    'last_reviewed_at'   => "ADD COLUMN `last_reviewed_at` DATETIME NULL AFTER `due_at`",
    'graduated_at'       => "ADD COLUMN `graduated_at` DATETIME NULL AFTER `last_reviewed_at`",
    'updated_at'         => "ADD COLUMN `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER `created_at`",
];

try {
    // Existing columns.
    $existing = [];
    foreach ($pdo->query('SHOW COLUMNS FROM `mistakes`') as $row) {
        $existing[strtolower((string) $row['Field'])] = true;
    }

    foreach ($columns as $name => $ddl) {
        if (isset($existing[strtolower($name)])) {
            $log("- column `$name` already present, skipping.");
            continue;
        }
        $pdo->exec("ALTER TABLE `mistakes` $ddl");
        $log("+ added column `$name`.");
    }

    // 2. Index for the due-queue query.
    $indexes = [];
    foreach ($pdo->query('SHOW INDEX FROM `mistakes`') as $row) {
        $indexes[(string) $row['Key_name']] = true;
    }
    if (!isset($indexes['idx_mistakes_user_due'])) {
        $pdo->exec('ALTER TABLE `mistakes` ADD KEY `idx_mistakes_user_due` (`user_id`, `status`, `due_at`)');
        $log('+ added index idx_mistakes_user_due.');
    } else {
        $log('- index idx_mistakes_user_due already present, skipping.');
    }

    // 3. Backfill: existing ACTIVE rows become due immediately so nothing hides.
    $pdo->exec("UPDATE `mistakes` SET `due_at` = COALESCE(`due_at`, `created_at`) WHERE `status` = 'ACTIVE'");
    $log('- backfilled due_at for active rows.');

    // 4. Audit table.
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS `mistake_events` (
            `id` INT NOT NULL AUTO_INCREMENT,
            `user_id` INT NOT NULL,
            `mistake_id` INT NULL,
            `event_type` ENUM('LOGGED','AGAIN','HARD','GOOD','EASY','MASTERED','REACTIVATED','EDITED','DELETED','UNDONE') NOT NULL,
            `grade` TINYINT NULL,
            `interval_before` INT NULL,
            `interval_after` INT NULL,
            `prev_state` JSON NULL,
            `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (`id`),
            KEY `idx_events_user_created` (`user_id`, `created_at`),
            KEY `idx_events_mistake` (`mistake_id`),
            CONSTRAINT `fk_events_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
            CONSTRAINT `fk_events_mistake` FOREIGN KEY (`mistake_id`) REFERENCES `mistakes` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    $log('+ ensured table mistake_events.');

    $log('== Migration v2 complete ==');
} catch (PDOException $e) {
    error_log('[MigrateV2 Failed] ' . $e->getMessage());
    http_response_code(500);
    echo 'Migration failed: ' . $e->getMessage() . "\n";
    exit(1);
}
