<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Migration v9
 *
 * Reworks the mistake model around the three categories the memorizer actually
 * chooses between, and replaces the SM-2 graduation rule with a fixed
 * 40-repetition practice counter:
 *
 *   1. AYAH_MISTAKE        - a slip inside one verse (absorbs TAWAQQUF,
 *                            TASHKEEL and LAFDH)
 *   2. TRANSITION_FAILURE  - forgot which verse comes next
 *   3. MUTASHABIHAT        - confused with a similar-looking verse
 *
 * A card leaves the practice deck when `practice_count` reaches
 * `practice_target` (40) and is archived; logging the same mistake again
 * reactivates it with a fresh counter.
 *
 * v9 deliberately runs v8 first, so an installation that missed v7/v8 is
 * repaired in the same pass.
 *
 * Safe to run more than once. Additive apart from the mistake_type enum
 * narrowing, whose legacy values are remapped first.
 *
 * CLI:   php config/migrate_v9.php
 * Setup: setup.php includes this file and calls rh_migrate_v9().
 * Web:   only if config/.htaccess is temporarily removed, then
 *        https://your-host/config/migrate_v9.php?confirm=1
 */

if (!isset($pdo) || !($pdo instanceof PDO)) {
    require_once __DIR__ . '/database.php';
}
require_once __DIR__ . '/migrate_v8.php';

if (!function_exists('rh_migrate_v9')) {
    /**
     * @return array<string,int> counts of applied changes
     */
    function rh_migrate_v9(PDO $pdo, ?callable $log = null): array
    {
        $log = $log ?? static function (string $message): void {
            echo $message . "\n";
            if (PHP_SAPI !== 'cli') {
                @ob_flush();
                @flush();
            }
        };

        // v9 depends on the v7/v8 columns and indexes.
        $stats = rh_migrate_v8($pdo, $log);
        $stats['enum_updates'] = $stats['enum_updates'] ?? 0;

        $log('== Rafeequl Hifz migration v9 ==');

        // 1. Practice counter columns.
        if (rh_v7_add_column($pdo, 'mistakes', 'practice_count', 'INT NOT NULL DEFAULT 0', $log)) {
            $stats['columns_added']++;
        }
        if (rh_v7_add_column($pdo, 'mistakes', 'practice_target', 'INT NOT NULL DEFAULT 40', $log)) {
            $stats['columns_added']++;
        }

        // 2. Narrow mistake_type to the three real categories. The intermediate
        //    ALTER is required because MySQL validates existing values on MODIFY.
        $cols = rh_v7_columns($pdo, 'mistakes');
        $currentType = strtolower((string) ($cols['mistake_type']['Type'] ?? ''));
        $hasLegacy = strpos($currentType, 'tawaqquf') !== false
            || strpos($currentType, 'tashkeel') !== false
            || strpos($currentType, 'lafdh') !== false;
        $hasAyahMistake = strpos($currentType, 'ayah_mistake') !== false;

        if ($currentType !== '' && ($hasLegacy || !$hasAyahMistake)) {
            $pdo->exec(
                "ALTER TABLE `mistakes`
                 MODIFY COLUMN `mistake_type`
                 ENUM('TRANSITION_FAILURE', 'MUTASHABIHAT', 'TAWAQQUF', 'TASHKEEL', 'LAFDH', 'AYAH_MISTAKE') NOT NULL"
            );
            $pdo->exec(
                "UPDATE `mistakes`
                 SET `mistake_type` = 'AYAH_MISTAKE'
                 WHERE `mistake_type` IN ('TAWAQQUF', 'TASHKEEL', 'LAFDH')"
            );
            $pdo->exec(
                "ALTER TABLE `mistakes`
                 MODIFY COLUMN `mistake_type`
                 ENUM('AYAH_MISTAKE', 'TRANSITION_FAILURE', 'MUTASHABIHAT') NOT NULL"
            );
            $stats['enum_updates']++;
            $log('  ~ mistakes.mistake_type enum updated to 3 categories');
        }

        // 3. A single-verse mistake never carries a paired verse.
        $pdo->exec(
            "UPDATE `mistakes`
             SET `confused_with_surah` = NULL, `confused_with_ayah` = NULL
             WHERE `mistake_type` = 'AYAH_MISTAKE'
               AND (`confused_with_surah` IS NOT NULL OR `confused_with_ayah` IS NOT NULL)"
        );

        // 4. Backfill: already-archived cards are shown as completed 40/40, and
        //    active counters can never exceed their target.
        $pdo->exec(
            "UPDATE `mistakes`
             SET `practice_target` = 40
             WHERE `practice_target` IS NULL OR `practice_target` < 1"
        );
        $pdo->exec(
            "UPDATE `mistakes`
             SET `practice_count` = `practice_target`
             WHERE `status` = 'ARCHIVED' AND `practice_count` < `practice_target`"
        );
        $pdo->exec(
            "UPDATE `mistakes`
             SET `practice_count` = `practice_target`
             WHERE `practice_count` > `practice_target`"
        );

        // 5. Deck query index (least-practiced first).
        if (rh_v7_add_index(
            $pdo,
            'mistakes',
            'idx_mistakes_user_status_practice',
            '(`user_id`, `status`, `practice_count`)',
            $log
        )) {
            $stats['indexes_added']++;
        }

        $log(sprintf(
            '== Done: %d columns, %d indexes, %d tables, %d enums ==',
            $stats['columns_added'],
            $stats['indexes_added'],
            $stats['tables_created'],
            $stats['enum_updates']
        ));

        return $stats;
    }
}

// Run automatically only when this file is invoked directly (not when setup.php
// includes it to reuse the migration function).
$rhV9IsDirect = basename((string) ($_SERVER['SCRIPT_FILENAME'] ?? '')) === 'migrate_v9.php';
if ($rhV9IsDirect) {
    if (PHP_SAPI !== 'cli') {
        header('Content-Type: text/plain; charset=utf-8');
        if (($_GET['confirm'] ?? '') !== '1') {
            http_response_code(400);
            echo "Refusing to run. Append ?confirm=1 to the URL to apply the migration.\n";
            exit;
        }
    }

    try {
        rh_migrate_v9($pdo);
    } catch (Throwable $e) {
        error_log('[Migration v9] ' . $e->getMessage());
        if (PHP_SAPI !== 'cli') {
            http_response_code(500);
        }
        echo "Migration v9 failed: " . $e->getMessage() . "\n";
        exit(1);
    }
}
