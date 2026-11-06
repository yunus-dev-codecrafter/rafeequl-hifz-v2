<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Migration v13
 *
 *   - Adds the six advanced Rub' Consolidation exercises to the
 *     `rub_results.exercise` enum.
 *   - Reduces the mistake-card repetition target from 40 to 15 and clamps any
 *     open counters so existing decks keep working.
 *
 * Safe to run more than once.
 *
 * CLI:   php config/migrate_v13.php
 */

if (!isset($pdo) || !($pdo instanceof PDO)) {
    require_once __DIR__ . '/database.php';
}

if (!function_exists('rh_migrate_v13')) {
    /**
     * @return array<string,int>
     */
    function rh_migrate_v13(PDO $pdo, ?callable $log = null): array
    {
        $log = $log ?: static function (string $message): void {};
        $stats = [
            'enum_updates'   => 0,
            'columns_added'  => 0,
            'tables_created' => 0,
            'indexes_added'  => 0,
            'rows_updated'   => 0,
        ];

        $exerciseEnum = "ENUM('WORD_ORDER','MISSING_WORDS','CONTINUE_AYAH','MUTASHABIHAT','PROGRESSIVE_HIDE','INTERRUPT','RANDOM_START','CONNECTION','REVERSE','ERROR_DETECT','NO_PREVIEW')";

        try {
            $column = $pdo->query("SHOW COLUMNS FROM `rub_results` LIKE 'exercise'")->fetch();
            if (is_array($column) && strpos((string) $column['Type'], 'INTERRUPT') === false) {
                $pdo->exec("ALTER TABLE `rub_results` MODIFY `exercise` " . $exerciseEnum . " NOT NULL");
                $stats['enum_updates']++;
                $log('  ~ rub_results.exercise enum extended with advanced challenges');
            }
        } catch (Throwable $t) {
            $log('  ! rub_results enum: ' . $t->getMessage());
        }

        try {
            $column = $pdo->query("SHOW COLUMNS FROM `mistakes` LIKE 'practice_target'")->fetch();
            if (is_array($column)) {
                $default = (string) ($column['Default'] ?? '');
                if ($default !== '15') {
                    $pdo->exec('ALTER TABLE `mistakes` MODIFY `practice_target` INT NOT NULL DEFAULT 15');
                    $stats['columns_added']++;
                    $log('  ~ mistakes.practice_target default changed to 15');
                }
            }

            $stats['rows_updated'] += $pdo->exec('UPDATE `mistakes` SET `practice_target` = 15 WHERE `practice_target` > 15 OR `practice_target` < 1') ?: 0;
            $stats['rows_updated'] += $pdo->exec('UPDATE `mistakes` SET `practice_count` = LEAST(`practice_count`, `practice_target`) WHERE `practice_count` > `practice_target`') ?: 0;
            $log('  ~ mistake-card repetition target is now 15');
        } catch (Throwable $t) {
            $log('  ! mistakes.practice_target: ' . $t->getMessage());
        }

        return $stats;
    }
}

if (PHP_SAPI === 'cli' && !defined('RH_MIGRATION_INCLUDED')) {
    $stats = rh_migrate_v13($pdo, static function (string $message): void {
        echo $message . PHP_EOL;
    });
    echo 'Migration v13 complete: ' . json_encode($stats, JSON_UNESCAPED_UNICODE) . PHP_EOL;
}
