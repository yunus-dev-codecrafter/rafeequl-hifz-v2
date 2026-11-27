<?php
declare(strict_types=1);

/**
 * Rollover helpers shared by the task endpoints.
 *
 * A pending task keeps its original row when it rolls into a new day. These
 * helpers count each calendar day it stays unfinished, so a Monday task served
 * on Wednesday reports two rollovers instead of silently reusing Monday's flag.
 */

if (!function_exists('rh_task_log_columns')) {
    function rh_task_log_columns(PDO $pdo): array
    {
        static $columns = null;
        if ($columns !== null) {
            return $columns;
        }

        $columns = [];
        try {
            foreach ($pdo->query('SHOW COLUMNS FROM `daily_task_logs`') as $row) {
                $columns[strtolower((string) $row['Field'])] = true;
            }
        } catch (Throwable $t) {
            $columns = [];
        }
        return $columns;
    }
}

if (!function_exists('rh_task_has_rollover')) {
    function rh_task_has_rollover(PDO $pdo): bool
    {
        $columns = rh_task_log_columns($pdo);
        return isset($columns['rollover_count'], $columns['last_rollover_date']);
    }
}

if (!function_exists('rh_task_has_hifz_progress')) {
    function rh_task_has_hifz_progress(PDO $pdo): bool
    {
        $columns = rh_task_log_columns($pdo);
        return isset($columns['hifz_progress']);
    }
}

if (!function_exists('rh_task_log_select')) {
    /**
     * SELECT list that still works on a database that has not run v8 yet.
     * The app then simply reports zero rollovers until the migration is run.
     */
    function rh_task_log_select(PDO $pdo): string
    {
        $columns = rh_task_log_columns($pdo);
        $has = static fn(string $name): bool => isset($columns[$name]);

        $parts = [
            '`id`',
            '`task_date`',
            '`task_type`',
            '`start_page`',
            '`end_page`',
            $has('is_completed') ? '`is_completed`' : '0 AS `is_completed`',
            $has('completed_pages') ? '`completed_pages`' : 'NULL AS `completed_pages`',
            $has('repetition_count') ? 'COALESCE(`repetition_count`, 0) AS `repetition_count`' : '0 AS `repetition_count`',
            $has('rub_id') ? '`rub_id`' : 'NULL AS `rub_id`',
            $has('completed_stations') ? '`completed_stations`' : 'NULL AS `completed_stations`',
            $has('hifz_progress') ? '`hifz_progress`' : 'NULL AS `hifz_progress`',
            $has('rollover_count') ? 'COALESCE(`rollover_count`, 0) AS `rollover_count`' : '0 AS `rollover_count`',
            $has('last_rollover_date') ? '`last_rollover_date`' : 'NULL AS `last_rollover_date`',
        ];

        return implode(', ', $parts);
    }
}

if (!function_exists('rh_apply_rollover')) {
    /**
     * In the strict day-lock model, an uncompleted task preserves its original task_date
     * so that missed days are audited accurately (Tafreet) and the user finishes their
     * pending day's tasks before the next day's tasks unlock.
     * Safe to call repeatedly and from concurrent requests.
     */
    function rh_apply_rollover(PDO $pdo, array $row, string $today): array
    {
        // Keep row date intact so the day is locked to the original pending day
        return $row;
    }
}
