<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz — reset station progress on unfinished Rub' tasks.
 *
 * One-off operator script for the vaqf-splitting change: station indices are
 * derived from the splitter, so adding new split points shifts what an old
 * "surah:ayah:index" key refers to. Clearing only the station progress of
 * *unfinished* RUB_TAMKIN tasks keeps their rub' and rollover state but makes
 * the user redo the stations under the new segmentation.
 *
 * Completed tasks and `rub_history` are left untouched, so consolidation
 * history is preserved. Safe to run more than once.
 *
 * Run (CLI):  php config/reset_rub_station_progress.php
 * Run (web):  https://your-host/config/reset_rub_station_progress.php?confirm=1
 */

require __DIR__ . '/database.php';

if (PHP_SAPI !== 'cli') {
    header('Content-Type: text/plain; charset=utf-8');
    if (($_GET['confirm'] ?? '') !== '1') {
        http_response_code(400);
        echo "Refusing to run. Append ?confirm=1 to the URL.\n";
        exit;
    }
}

@set_time_limit(0);

echo "== Rafeequl Hifz — reset unfinished rub' station progress ==\n";

$hasTable = false;
$hasColumn = false;
try {
    $hasTable = (bool) $pdo->query("SHOW TABLES LIKE 'daily_task_logs'")->fetchColumn();
    if ($hasTable) {
        foreach ($pdo->query('SHOW COLUMNS FROM `daily_task_logs`') as $row) {
            if (strtolower((string) ($row['Field'] ?? '')) === 'completed_stations') {
                $hasColumn = true;
                break;
            }
        }
    }
} catch (Throwable $t) {
    echo '!! could not inspect the schema: ' . $t->getMessage() . "\n";
    exit(1);
}

if (!$hasTable || !$hasColumn) {
    echo "- daily_task_logs.completed_stations is not present; nothing to reset.\n";
    exit(0);
}

try {
    $stmt = $pdo->exec(
        "UPDATE `daily_task_logs`
         SET `completed_stations` = '[]', `is_completed` = 0
         WHERE `task_type` = 'RUB_TAMKIN'
           AND `is_completed` = 0
           AND `completed_stations` IS NOT NULL
           AND `completed_stations` <> '[]'
           AND `completed_stations` <> 'null'"
    );
    $count = $stmt === false ? 0 : (int) $stmt;
    echo '- reset station progress on ' . $count . " unfinished rub' task(s).\n";
} catch (Throwable $t) {
    echo '!! reset failed: ' . $t->getMessage() . "\n";
    exit(1);
}

echo "DONE\n";
