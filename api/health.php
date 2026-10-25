<?php
declare(strict_types=1);

/**
 * Lightweight health check for monitoring and for distinguishing a code/API
 * problem from a host-level 502. It never exposes credentials or user data.
 *
 * 200 = PHP + database + v7 schema ready
 * 503 = database or schema not ready
 */

require __DIR__ . '/../config/database.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, max-age=0');

$required = [
    'users' => [
        'role', 'status', 'must_change_password',
        'murajaah_days', 'rabt_extra_pages', 'last_tikrar_page',
    ],
    'daily_task_logs' => [
        'completed_pages', 'repetition_count', 'rub_id', 'completed_stations',
        'rollover_count', 'last_rollover_date',
    ],
    'madinah_pages_meta' => ['page_number'],
    'mistakes' => ['id', 'status', 'due_at'],
    'rub_history' => ['id', 'user_id', 'rub_id'],
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

http_response_code($ok ? 200 : 503);
echo json_encode([
    'success'     => $ok,
    'status'      => $ok ? 'ok' : 'degraded',
    'php'         => PHP_VERSION,
    'timezone'    => defined('RH_APP_TIMEZONE') ? RH_APP_TIMEZONE : date_default_timezone_get(),
    'db'          => $dbOk,
    'schema_ok'   => $schemaOk,
    'missing'     => $missing,
    'time'        => date('c'),
], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
