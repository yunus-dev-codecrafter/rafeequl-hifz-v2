<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Migration v17
 *
 *   - Updates `users.rabt_base_pages` DEFAULT to 10 (reduced from 30).
 *   - Adjusts existing users whose `rabt_base_pages` was at or above 30 down to 10.
 *   - Enforces the sustainable Rabt window: Base 10 pages, expanding up to
 *     16 pages (for 6-day muraja'ah) or 20 pages (for 10-day muraja'ah).
 *
 * Safe to run more than once (idempotent).
 *
 * CLI: php config/migrate_v17.php
 */

if (!isset($pdo) || !($pdo instanceof PDO)) {
    require_once __DIR__ . '/database.php';
}

if (!function_exists('rh_migrate_v17')) {
    /**
     * @return array<string,int>
     */
    function rh_migrate_v17(PDO $pdo, ?callable $log = null): array
    {
        $log = $log ?: static function (string $message): void {};
        $stats = [
            'columns_modified' => 0,
            'rows_updated'     => 0,
        ];

        // 1. Change DEFAULT value of rabt_base_pages on `users` table to 10
        try {
            $pdo->exec("ALTER TABLE `users` ALTER COLUMN `rabt_base_pages` SET DEFAULT 10");
            $stats['columns_modified']++;
            $log('  + updated DEFAULT `users.rabt_base_pages` = 10');
        } catch (Throwable $t) {
            // Some MariaDB/MySQL versions prefer MODIFY COLUMN
            try {
                $pdo->exec("ALTER TABLE `users` MODIFY COLUMN `rabt_base_pages` INT NOT NULL DEFAULT 10");
                $stats['columns_modified']++;
                $log('  + modified `users.rabt_base_pages` INT NOT NULL DEFAULT 10');
            } catch (Throwable $t2) {
                $log('  ! warning: could not alter default for rabt_base_pages: ' . $t2->getMessage());
            }
        }

        // 2. Update existing users who have rabt_base_pages > 10 (e.g. legacy default of 30) down to 10
        try {
            $stmt = $pdo->prepare('UPDATE `users` SET `rabt_base_pages` = 10 WHERE `rabt_base_pages` > 10');
            $stmt->execute();
            $updated = $stmt->rowCount();
            $stats['rows_updated'] += $updated;
            if ($updated > 0) {
                $log("  + adjusted {$updated} user(s) with legacy rabt_base_pages to 10");
            }
        } catch (Throwable $t) {
            $log('  ! warning: could not update users rabt_base_pages: ' . $t->getMessage());
        }

        return $stats;
    }
}

// Direct CLI invocation
if (php_sapi_name() === 'cli' && isset($argv[0]) && realpath($argv[0]) === __FILE__) {
    echo "Running migration v17...\n";
    $log = static function (string $msg): void {
        echo $msg . "\n";
    };
    try {
        $stats = rh_migrate_v17($pdo, $log);
        echo "Migration v17 completed successfully: " . json_encode($stats) . "\n";
    } catch (Throwable $t) {
        fwrite(STDERR, "Migration v17 failed: " . $t->getMessage() . "\n");
        exit(1);
    }
}
