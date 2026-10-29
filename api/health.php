<?php
declare(strict_types=1);

/**
 * Lightweight health check for monitoring and for distinguishing a code/API
 * problem from a host-level 502. It never exposes credentials or user data.
 *
 * 200 = PHP + database + v10 schema ready
 * 503 = database or schema not ready
 *
 * The per-rub' tafsir bundle and the kalimaat catalog are reported separately
 * (`tafsir_ok`, `kalimaat_ok`); they are static content and never change the
 * health status, so a missing upload only hides the optional feature.
 */

require __DIR__ . '/../config/database.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, max-age=0');

$required = [
    'users' => [
        'role', 'status', 'must_change_password',
        'murajaah_days', 'rabt_extra_pages', 'last_tikrar_page',
        'gate_mistake_id', 'gate_mistake_locked_at',
    ],
    'daily_task_logs' => [
        'completed_pages', 'repetition_count', 'rub_id', 'completed_stations',
        'hifz_progress', 'rollover_count', 'last_rollover_date',
    ],
    'madinah_pages_meta' => ['page_number'],
    'mistakes' => ['id', 'status', 'due_at', 'practice_count', 'practice_target'],
    'rub_history' => ['id', 'user_id', 'rub_id'],
    'kalimaat_progress' => ['id', 'user_id', 'word_key', 'repeat_count', 'status', 'last_test_session'],
];

$missing = [];
foreach ($required as $table => $columns) {
    try {
        $found = [];
        foreach ($pdo->query('SHOW COLUMNS FROM `' . str_replace('`', '', $table) . '`') as $row) {
            $found[strtolower((string) $row['Field'])] = true;
        }
        foreach ($columns as $column) {
            if (!isset($found[strtolower($column)])) {
                $missing[] = $table . '.' . $column;
            }
        }
    } catch (Throwable $t) {
        $missing[] = $table;
    }
}

$dbOk = false;
try {
    $dbOk = (int) $pdo->query('SELECT 1')->fetchColumn() === 1;
} catch (Throwable $t) {
    $dbOk = false;
}

$schemaOk = count($missing) === 0;
$ok = $dbOk && $schemaOk;

$tafsirFiles = glob(__DIR__ . '/data/tafsir/*.json');
$tafsirOk = is_array($tafsirFiles)
    && count($tafsirFiles) === 240
    && is_readable(__DIR__ . '/data/tafsir/1.json')
    && is_readable(__DIR__ . '/data/tafsir/240.json');

$kalimaatOk = is_readable(__DIR__ . '/../web/data/kalimaat/meta.json')
    && is_readable(__DIR__ . '/../web/data/kalimaat/juz/1.json')
    && is_readable(__DIR__ . '/../web/data/kalimaat/juz/30.json');

http_response_code($ok ? 200 : 503);
echo json_encode([
    'success'     => $ok,
    'status'      => $ok ? 'ok' : 'degraded',
    'php'         => PHP_VERSION,
    'timezone'    => defined('RH_APP_TIMEZONE') ? RH_APP_TIMEZONE : date_default_timezone_get(),
    'db'          => $dbOk,
    'schema_ok'   => $schemaOk,
    'tafsir_ok'   => $tafsirOk,
    'kalimaat_ok' => $kalimaatOk,
    'missing'     => $missing,
    'time'        => date('c'),
], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
