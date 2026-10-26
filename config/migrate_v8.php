<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Migration v8
 *
 * Adds the persisted verse-by-verse progress for HIFZ_JADID. v8 deliberately
 * runs v7 first, so an installation that missed the rollover migration is
 * repaired in the same pass.
 *
 * Safe to run more than once. Additive only.
 *
 * CLI:   php config/migrate_v8.php
 * Setup: setup.php includes this file and calls rh_migrate_v8().
 * Web:   only if config/.htaccess is temporarily removed, then
 *        https://your-host/config/migrate_v8.php?confirm=1
 */

if (!isset($pdo) || !($pdo instanceof PDO)) {
    require_once __DIR__ . '/database.php';
}
require_once __DIR__ . '/migrate_v7.php';

if (!function_exists('rh_migrate_v8')) {
    /**
     * @return array<string,int> counts of applied changes
     */
    function rh_migrate_v8(PDO $pdo, ?callable $log = null): array
    {
        $log = $log ?? static function (string $message): void {
            echo $message . "\n";
            if (PHP_SAPI !== 'cli') {
                @ob_flush();
                @flush();
            }
        };

        // v8 depends on the rollover columns/indexes from v7.
        $stats = rh_migrate_v7($pdo, $log);

        $log('== Rafeequl Hifz migration v8 ==');

        if (rh_v7_add_column($pdo, 'daily_task_logs', 'hifz_progress', 'TEXT NULL', $log)) {
            $stats['columns_added']++;
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

// Run automatically only when this file is invoked directly (not when setup.php
// includes it to reuse the migration function).
$rhV8IsDirect = basename((string) ($_SERVER['SCRIPT_FILENAME'] ?? '')) === 'migrate_v8.php';
if ($rhV8IsDirect) {
    if (PHP_SAPI !== 'cli') {
        header('Content-Type: text/plain; charset=utf-8');
        if (($_GET['confirm'] ?? '') !== '1') {
            http_response_code(400);
            echo "Refusing to run. Append ?confirm=1 to the URL to apply the migration.\n";
            exit;
        }
    }

    try {
        rh_migrate_v8($pdo);
    } catch (Throwable $e) {
        error_log('[Migration v8] ' . $e->getMessage());
        if (PHP_SAPI !== 'cli') {
            http_response_code(500);
        }
        echo "Migration v8 failed: " . $e->getMessage() . "\n";
        exit(1);
    }
}
