<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz — reset station progress on unfinished Rub' tasks.
 *
 * One-off helper for the waqf-splitting change: station indices are derived
 * from the splitter, so adding new split points shifts what an old
 * "surah:ayah:index" key refers to. Clearing only the station progress of
 * *unfinished* RUB_TAMKIN tasks keeps their rub' and rollover state but makes
 * the user redo the stations under the new segmentation.
 *
 * Completed tasks and `rub_history` are left untouched, so consolidation
 * history is preserved. Safe to run more than once.
 *
 * Web:  sign in as ADMIN/SUPER_ADMIN, then open reset_rub_progress.php
 *       (config/ is denied over HTTP, so the runner lives at the site root).
 * CLI:  php config/reset_rub_station_progress.php
 */

if (!function_exists('rh_reset_rub_station_progress')) {
    /**
     * @return array{available:bool, affected:int}
     */
    function rh_reset_rub_station_progress(PDO $pdo): array
    {
        $hasTable = false;
        $hasColumn = false;

        $hasTable = (bool) $pdo->query("SHOW TABLES LIKE 'daily_task_logs'")->fetchColumn();
        if ($hasTable) {
            foreach ($pdo->query('SHOW COLUMNS FROM `daily_task_logs`') as $row) {
                if (strtolower((string) ($row['Field'] ?? '')) === 'completed_stations') {
                    $hasColumn = true;
                    break;
                }
            }
        }

        if (!$hasTable || !$hasColumn) {
            return ['available' => false, 'affected' => 0];
        }

        $stmt = $pdo->exec(
            "UPDATE `daily_task_logs`
             SET `completed_stations` = '[]', `is_completed` = 0
             WHERE `task_type` = 'RUB_TAMKIN'
               AND `is_completed` = 0
               AND `completed_stations` IS NOT NULL
               AND `completed_stations` <> '[]'
               AND `completed_stations` <> 'null'"
        );

        return ['available' => true, 'affected' => $stmt === false ? 0 : (int) $stmt];
    }
}

// CLI runner (the web runner is reset_rub_progress.php at the site root).
if (PHP_SAPI === 'cli') {
    require __DIR__ . '/database.php';

    @set_time_limit(0);

    echo "== Rafeequl Hifz — reset unfinished rub' station progress ==\n";

    try {
        $result = rh_reset_rub_station_progress($pdo);
    } catch (Throwable $t) {
        echo '!! reset failed: ' . $t->getMessage() . "\n";
        exit(1);
    }

    if (!$result['available']) {
        echo "- daily_task_logs.completed_stations is not present; nothing to reset.\n";
    } else {
        echo '- reset station progress on ' . $result['affected'] . " unfinished rub' task(s).\n";
    }

    echo "DONE\n";
}
