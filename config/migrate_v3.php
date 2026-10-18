<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Migration v3: Per-page recall notes ("بطاقة تثبيت الصفحة").
 *
 * Creates the `page_notes` table which stores one quick-recall note per
 * (user, mushaf page). Nothing else is touched and no data is modified.
 *
 * Safe to run more than once (idempotent).
 *
 * Run (CLI):   php config/migrate_v3.php
 * Run (web):   https://your-host/config/migrate_v3.php?confirm=1
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

$log('== Rafeequl Hifz migration v3 (page notes) ==');

try {
    $exists = false;
    foreach ($pdo->query("SHOW TABLES LIKE 'page_notes'") as $row) {
        $exists = true;
        break;
    }

    if ($exists) {
        $log('- table page_notes already present, skipping.');
    } else {
        $pdo->exec(
            "CREATE TABLE IF NOT EXISTS `page_notes` (
                `id` INT NOT NULL AUTO_INCREMENT,
                `user_id` INT NOT NULL,
                `page_number` INT NOT NULL,
                `note` TEXT NULL,
                `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (`id`),
                UNIQUE KEY `uq_page_notes_user_page` (`user_id`, `page_number`),
                CONSTRAINT `fk_page_notes_user`
                    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
                    ON DELETE CASCADE ON UPDATE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );
        $log('+ created table page_notes.');
    }

    $log('== Migration v3 complete ==');
} catch (PDOException $e) {
    error_log('[MigrateV3 Failed] ' . $e->getMessage());
    http_response_code(500);
    echo 'Migration failed: ' . $e->getMessage() . "\n";
    exit(1);
}
