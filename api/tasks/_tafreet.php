<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Penalty (يوم تفريط) and Planned Absence Engine
 *
 * Rules:
 *   1. A missed day without an authorized planned absence counts as 1 يوم تفريط.
 *   2. Warnings are issued at 10, 20, and 24 missed days.
 *   3. At 25 missed days, the student's account is permanently deleted.
 *   4. A student can schedule up to 30 days of planned absence.
 *   5. During planned absence, Hifz Jadid & Tikrar Ams are paused, while Rabt & Muraja'ah continue.
 */

if (!function_exists('rh_today')) {
    function rh_today(?int $timestamp = null): string
    {
        $ts = $timestamp ?? time();
        $offset = (int) (defined('RH_DAY_CUTOFF_HOUR') ? RH_DAY_CUTOFF_HOUR : 6) * 3600;
        return date('Y-m-d', $ts - $offset);
    }
}

if (!function_exists('rh_is_absence_day')) {
    function rh_is_absence_day(PDO $pdo, int $userId, string $date): bool
    {
        try {
            $stmt = $pdo->prepare('SELECT COUNT(*) FROM `user_absences` WHERE `user_id` = :u AND `absence_date` = :d');
            $stmt->execute([':u' => $userId, ':d' => $date]);
            return ((int) $stmt->fetchColumn()) > 0;
        } catch (Throwable $t) {
            return false;
        }
    }
}

if (!function_exists('rh_get_user_absences')) {
    /**
     * @return array{absences: array<string>, total: int, remaining: int, max: int}
     */
    function rh_get_user_absences(PDO $pdo, int $userId): array
    {
        $max = 30;
        $dates = [];
        try {
            $stmt = $pdo->prepare(
                'SELECT `absence_date`, `notes` FROM `user_absences`
                 WHERE `user_id` = :u
                 ORDER BY `absence_date` ASC'
            );
            $stmt->execute([':u' => $userId]);
            $rows = $stmt->fetchAll();
            foreach ($rows as $r) {
                $dates[] = (string) $r['absence_date'];
            }
        } catch (Throwable $t) {
            $dates = [];
        }

        $total = count($dates);
        return [
            'absences'  => $dates,
            'total'     => $total,
            'remaining' => max(0, $max - $total),
            'max'       => $max,
        ];
    }
}

if (!function_exists('rh_add_user_absence')) {
    /**
     * @return array{success: bool, error?: string}
     */
    function rh_add_user_absence(PDO $pdo, int $userId, string $date, ?string $notes = null): array
    {
        $today = function_exists('rh_today') ? rh_today() : date('Y-m-d');
        if ($date < $today) {
            return ['success' => false, 'error' => 'لا يمكن تسجيل غياب لتاريخ مضى.'];
        }

        $info = rh_get_user_absences($pdo, $userId);
        if ($info['remaining'] <= 0 && !in_array($date, $info['absences'], true)) {
            return ['success' => false, 'error' => 'لقد بلغت الحد الأقصى لأيام الغياب المسموح بها (٣٠ يوماً).'];
        }

        try {
            $stmt = $pdo->prepare(
                'INSERT IGNORE INTO `user_absences` (`user_id`, `absence_date`, `notes`)
                 VALUES (:u, :d, :n)'
            );
            $stmt->execute([
                ':u' => $userId,
                ':d' => $date,
                ':n' => $notes,
            ]);
            return ['success' => true];
        } catch (Throwable $t) {
            return ['success' => false, 'error' => 'تعذر حفظ يوم الغياب: ' . $t->getMessage()];
        }
    }
}

if (!function_exists('rh_remove_user_absence')) {
    function rh_remove_user_absence(PDO $pdo, int $userId, string $date): bool
    {
        try {
            $stmt = $pdo->prepare('DELETE FROM `user_absences` WHERE `user_id` = :u AND `absence_date` = :d');
            $stmt->execute([':u' => $userId, ':d' => $date]);
            return $stmt->rowCount() > 0;
        } catch (Throwable $t) {
            return false;
        }
    }
}

if (!function_exists('rh_evaluate_tafreet')) {
    /**
     * Audit past missed calendar days and apply penalties.
     *
     * @return array{
     *   deleted: bool,
     *   tafreet_count: int,
     *   warning_level: string,
     *   new_penalties: int,
     *   max: int
     * }
     */
    function rh_evaluate_tafreet(PDO $pdo, int $userId, string $today): array
    {
        $defaultResult = [
            'deleted'       => false,
            'tafreet_count' => 0,
            'warning_level' => 'NONE',
            'new_penalties' => 0,
            'max'           => 25,
        ];

        try {
            $stmt = $pdo->prepare(
                'SELECT `id`, `tafreet_count`, `last_tafreet_check_date`, `created_at`
                 FROM `users` WHERE `id` = :u'
            );
            $stmt->execute([':u' => $userId]);
            $user = $stmt->fetch();
            if (!$user) {
                return $defaultResult;
            }

            $userCreatedAt = $user['created_at'] ? (string) $user['created_at'] : null;
            $userRegDate   = $userCreatedAt ? rh_today(strtotime($userCreatedAt)) : null;

            // Heal any previous false-positive strikes where all core tasks were actually completed
            // (e.g. caused by auxiliary tasks like PAGE_TAMKIN being marked incomplete)
            try {
                $healStmt = $pdo->prepare(
                    "DELETE FROM `tafreet_logs`
                     WHERE `user_id` = :u
                       AND `missed_date` IN (
                           SELECT `comp`.`task_date`
                           FROM (
                               SELECT `task_date`,
                                      COUNT(*) AS `total_core`,
                                      SUM(CASE WHEN `is_completed` = 1 THEN 1 ELSE 0 END) AS `completed_core`,
                                      MAX(COALESCE(`last_rollover_date`, `task_date`)) AS `latest_completion_date`
                               FROM `daily_task_logs`
                               WHERE `user_id` = :u2
                                 AND `task_type` IN ('HIFZ_JADID', 'TIKRAR_AMS', 'RABT', 'MURAJAAH')
                               GROUP BY `task_date`
                               HAVING `total_core` > 0
                                  AND `total_core` = `completed_core`
                                  AND `latest_completion_date` <= `task_date`
                           ) AS `comp`
                       )"
                );
                $healStmt->execute([':u' => $userId, ':u2' => $userId]);
            } catch (Throwable $t) {
                // Ignore healing error if subquery unsupported
            }

            // Also heal any false-positive strikes on planned absence days
            try {
                $healAbsence = $pdo->prepare(
                    "DELETE FROM `tafreet_logs`
                     WHERE `user_id` = :u
                       AND `missed_date` IN (
                           SELECT `absence_date` FROM `user_absences` WHERE `user_id` = :u2
                       )"
                );
                $healAbsence->execute([':u' => $userId, ':u2' => $userId]);
            } catch (Throwable $t) {}

            // Recalculate true current count from tafreet_logs
            $cntStmt = $pdo->prepare('SELECT COUNT(*) FROM `tafreet_logs` WHERE `user_id` = :u');
            $cntStmt->execute([':u' => $userId]);
            $currentCount = (int) $cntStmt->fetchColumn();

            $lastCheck = $user['last_tafreet_check_date'] ? (string) $user['last_tafreet_check_date'] : null;

            // First audit for this user: initialize baseline to yesterday so we don't retroactively penalize
            if ($lastCheck === null) {
                $yesterday = date('Y-m-d', strtotime('-1 day', strtotime($today)));
                $baseline = ($userRegDate && $userRegDate > $yesterday) ? $userRegDate : $yesterday;
                $stmt = $pdo->prepare('UPDATE `users` SET `last_tafreet_check_date` = :d, `tafreet_count` = :cnt WHERE `id` = :u');
                $stmt->execute([':d' => $baseline, ':cnt' => $currentCount, ':u' => $userId]);
                $lastCheck = $baseline;
            }

            $yesterday = date('Y-m-d', strtotime('-1 day', strtotime($today)));
            if ($lastCheck >= $yesterday) {
                // Keep tafreet_count in users table synchronized with actual count
                if ($currentCount !== (int) ($user['tafreet_count'] ?? 0)) {
                    $updSync = $pdo->prepare('UPDATE `users` SET `tafreet_count` = :cnt WHERE `id` = :u');
                    $updSync->execute([':cnt' => $currentCount, ':u' => $userId]);
                }

                // Already checked up to yesterday
                return [
                    'deleted'       => false,
                    'tafreet_count' => $currentCount,
                    'warning_level' => rh_get_warning_level($currentCount),
                    'new_penalties' => 0,
                    'max'           => 25,
                ];
            }

            // Iterate over all unchecked calendar days up to yesterday
            $newPenalties = 0;
            $cursorTime = strtotime('+1 day', strtotime($lastCheck));
            $endTime = strtotime($yesterday);

            // Cap iteration to max 60 days to prevent excessive loops if account was dormant
            $maxDaysCheck = 60;
            $daysIterated = 0;

            while ($cursorTime <= $endTime && $daysIterated < $maxDaysCheck) {
                $daysIterated++;
                $checkDate = date('Y-m-d', $cursorTime);

                // 0. Do not penalize days before user registration
                if ($userRegDate !== null && $checkDate < $userRegDate) {
                    $cursorTime = strtotime('+1 day', $cursorTime);
                    continue;
                }

                // 1. Check if user had a planned absence on this day
                if (rh_is_absence_day($pdo, $userId, $checkDate)) {
                    $cursorTime = strtotime('+1 day', $cursorTime);
                    continue; // Planned absence is exempt
                }

                // 2. Check task completion on this day
                // Only core recitation tasks (HIFZ_JADID, TIKRAR_AMS, RABT, MURAJAAH)
                // determine day completion. Auxiliary tasks (PAGE_TAMKIN, RUB_TAMKIN, MISTAKES)
                // must NEVER trigger a Tafreet strike.
                $tStmt = $pdo->prepare(
                    "SELECT `task_type`, `is_completed` FROM `daily_task_logs`
                     WHERE `user_id` = :u AND `task_date` = :d
                       AND `task_type` IN ('HIFZ_JADID', 'TIKRAR_AMS', 'RABT', 'MURAJAAH')"
                );
                $tStmt->execute([':u' => $userId, ':d' => $checkDate]);
                $tasksOnDate = $tStmt->fetchAll();

                $dayCompleted = false;
                if (!empty($tasksOnDate)) {
                    // Group by task_type: each distinct core task assigned on this date must be completed
                    $byType = [];
                    foreach ($tasksOnDate as $tRow) {
                        $type = (string) $tRow['task_type'];
                        if (!isset($byType[$type])) {
                            $byType[$type] = false;
                        }
                        if ((int) $tRow['is_completed'] === 1) {
                            $byType[$type] = true;
                        }
                    }
                    $allCompleted = true;
                    foreach ($byType as $done) {
                        if (!$done) {
                            $allCompleted = false;
                            break;
                        }
                    }
                    $dayCompleted = $allCompleted;
                }

                // If not completed or user didn't even log in / have tasks completed
                if (!$dayCompleted) {
                    $ins = $pdo->prepare(
                        'INSERT IGNORE INTO `tafreet_logs` (`user_id`, `missed_date`, `reason`)
                         VALUES (:u, :d, :r)'
                    );
                    $ins->execute([
                        ':u' => $userId,
                        ':d' => $checkDate,
                        ':r' => empty($tasksOnDate) ? 'NO_ACTIVITY' : 'INCOMPLETE_TASKS',
                    ]);

                    if ($ins->rowCount() > 0) {
                        $newPenalties++;
                        $currentCount++;
                    }
                }

                $cursorTime = strtotime('+1 day', $cursorTime);
            }

            // Update user record
            $upd = $pdo->prepare(
                'UPDATE `users`
                 SET `tafreet_count` = :cnt, `last_tafreet_check_date` = :d
                 WHERE `id` = :u'
            );
            $upd->execute([
                ':cnt' => $currentCount,
                ':d'   => $yesterday,
                ':u'   => $userId,
            ]);

            // Check permanent deletion threshold (25 strikes)
            if ($currentCount >= 25) {
                // Permanently delete user account and all cascaded data
                $del = $pdo->prepare('DELETE FROM `users` WHERE `id` = :u');
                $del->execute([':u' => $userId]);

                return [
                    'deleted'       => true,
                    'tafreet_count' => $currentCount,
                    'warning_level' => 'DELETED',
                    'new_penalties' => $newPenalties,
                    'max'           => 25,
                ];
            }

            return [
                'deleted'       => false,
                'tafreet_count' => $currentCount,
                'warning_level' => rh_get_warning_level($currentCount),
                'new_penalties' => $newPenalties,
                'max'           => 25,
            ];
        } catch (Throwable $t) {
            error_log('[Tafreet Audit Error] ' . $t->getMessage());
            return $defaultResult;
        }
    }
}

if (!function_exists('rh_get_warning_level')) {
    function rh_get_warning_level(int $count): string
    {
        if ($count >= 24) {
            return 'FINAL_24';
        }
        if ($count >= 20) {
            return 'URGENT_20';
        }
        if ($count >= 10) {
            return 'WARNING_10';
        }
        return 'NONE';
    }
}
