<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Muraja'ah Schedule Diagnostic (Read-Only)
 *
 * Scoped investigation script for user "يونس عبدالحميد".
 * Protected by secret diagnostic token.
 */

require __DIR__ . '/../config/database.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, max-age=0');

$token = $_GET['token'] ?? '';
if ($token !== 'rh_diag_murajaah_982734') {
    http_response_code(403);
    echo json_encode(['success' => false, 'error' => 'Forbidden']);
    exit;
}

try {
    $today = date('Y-m-d');
    $now = date('Y-m-d H:i:s');
    $tz = date_default_timezone_get();

    // 1. Locate the affected user
    $stmt = $pdo->prepare("SELECT * FROM `users` WHERE `name` LIKE :name OR `email` LIKE :email LIMIT 5");
    $stmt->execute([
        ':name'  => '%يونس%',
        ':email' => '%yunus%',
    ]);
    $matchedUsers = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // Also get all users summary to compare
    $allUsersStmt = $pdo->query("SELECT `id`, `name`, `email`, `user_type`, `murajaah_days`, `current_hifz_page`, `last_tikrar_page`, `rabt_base_pages`, `rabt_extra_pages`, `tafreet_count` FROM `users`");
    $allUsers = $allUsersStmt->fetchAll(PDO::FETCH_ASSOC);

    // Identify primary target
    $targetUser = null;
    foreach ($matchedUsers as $u) {
        if (trim($u['name']) === 'يونس عبدالحميد' || stripos($u['email'], 'yunusabdulhameed1') !== false) {
            $targetUser = $u;
            break;
        }
    }
    if (!$targetUser && !empty($matchedUsers)) {
        $targetUser = $matchedUsers[0];
    }

    if (!$targetUser) {
        echo json_encode([
            'success' => false,
            'error'   => 'User not found',
            'matched' => $matchedUsers,
            'all'     => $allUsers,
        ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
        exit;
    }

    $userId = (int) $targetUser['id'];

    // 2. Fetch all daily_task_logs for this user
    $logStmt = $pdo->prepare(
        "SELECT * FROM `daily_task_logs` WHERE `user_id` = :u ORDER BY `task_date` DESC, `id` DESC LIMIT 50"
    );
    $logStmt->execute([':u' => $userId]);
    $userLogs = $logStmt->fetchAll(PDO::FETCH_ASSOC);

    // 3. Muraja'ah simulation (exact logic from get_daily_tasks.php)
    $mStmt = $pdo->prepare(
        "SELECT `id`, `start_page`, `end_page`, `task_date`, `is_completed`, `completed_pages`
         FROM `daily_task_logs`
         WHERE `user_id` = :u AND `task_type` = 'MURAJAAH' AND `is_completed` = 1
         ORDER BY `task_date` DESC, `id` DESC
         LIMIT 50"
    );
    $mStmt->execute([':u' => $userId]);
    $completedMurTasks = $mStmt->fetchAll(PDO::FETCH_ASSOC);

    $tasksInRound = 0;
    $lastCompletedEnd = 0;
    $roundTrace = [];
    if (!empty($completedMurTasks)) {
        $lastCompletedEnd = (int) $completedMurTasks[0]['end_page'];
        foreach ($completedMurTasks as $mt) {
            $tasksInRound++;
            $isBoundary = ((int) $mt['start_page'] === 1);
            $roundTrace[] = [
                'task_id'    => (int) $mt['id'],
                'task_date'  => $mt['task_date'],
                'start_page' => (int) $mt['start_page'],
                'end_page'   => (int) $mt['end_page'],
                'boundary'   => $isBoundary,
                'count_so_far' => $tasksInRound,
            ];
            if ($isBoundary) {
                break;
            }
        }
    }

    $utype       = (string) $targetUser['user_type'];
    $murDays     = max(1, min(10, (int) ($targetUser['murajaah_days'] ?? 6)));
    $rabtExtra   = max(0, (int) ($targetUser['rabt_extra_pages'] ?? 0));
    $rabtBase    = max(0, min(30, (int) ($targetUser['rabt_base_pages'] ?? 30)));
    $lastTikrar  = (int) ($targetUser['last_tikrar_page'] ?? 0);

    $prevPoolEnd = 0;
    if ($utype === 'COMPLETE') {
        $prevPoolEnd = 604;
    } else {
        $prevRabtWin = $rabtBase + $rabtExtra;
        $prevPoolEnd = max(0, $lastTikrar - $prevRabtWin);
    }

    $cycleCompleted = false;
    $completionReason = 'none';
    if ($tasksInRound >= $murDays) {
        $cycleCompleted = true;
        $completionReason = "tasksInRound ($tasksInRound) >= murDays ($murDays)";
    } elseif ($prevPoolEnd > 0 && $lastCompletedEnd >= $prevPoolEnd) {
        $cycleCompleted = true;
        $completionReason = "lastCompletedEnd ($lastCompletedEnd) >= prevPoolEnd ($prevPoolEnd)";
    } elseif ($rabtExtra >= $murDays) {
        $cycleCompleted = true;
        $completionReason = "rabtExtra ($rabtExtra) >= murDays ($murDays)";
    }

    $currentCycleDay = $cycleCompleted ? 1 : min($murDays, $tasksInRound + 1);

    // 4. Check uncompleted Muraja'ah tasks (if any)
    $uncompStmt = $pdo->prepare(
        "SELECT * FROM `daily_task_logs` WHERE `user_id` = :u AND `task_type` = 'MURAJAAH' AND `is_completed` = 0 ORDER BY `task_date` ASC, `id` ASC"
    );
    $uncompStmt->execute([':u' => $userId]);
    $uncompletedMurTasks = $uncompStmt->fetchAll(PDO::FETCH_ASSOC);

    // 5. Compare with other users
    $otherUsersComparison = [];
    foreach ($allUsers as $ou) {
        if ((int) $ou['id'] === $userId) continue;
        $ouId = (int) $ou['id'];
        $ouMurStmt = $pdo->prepare(
            "SELECT `id`, `start_page`, `end_page`, `task_date`, `is_completed`
             FROM `daily_task_logs`
             WHERE `user_id` = :u AND `task_type` = 'MURAJAAH'
             ORDER BY `task_date` DESC, `id` DESC
             LIMIT 10"
        );
        $ouMurStmt->execute([':u' => $ouId]);
        $ouTasks = $ouMurStmt->fetchAll(PDO::FETCH_ASSOC);

        // Calculate their day
        $ouCount = 0;
        foreach ($ouTasks as $ot) {
            if ((int) $ot['is_completed'] === 1) {
                $ouCount++;
                if ((int) $ot['start_page'] === 1) break;
            }
        }
        $otherUsersComparison[] = [
            'id' => $ouId,
            'name' => $ou['name'],
            'murajaah_days' => $ou['murajaah_days'],
            'completed_tasks_in_round' => $ouCount,
            'calculated_day' => $ouCount + 1,
            'recent_tasks' => $ouTasks,
        ];
    }

    echo json_encode([
        'success' => true,
        'server_environment' => [
            'today' => $today,
            'now'   => $now,
            'timezone' => $tz,
        ],
        'affected_user' => [
            'profile' => [
                'id' => $userId,
                'name' => $targetUser['name'],
                'email' => $targetUser['email'],
                'user_type' => $targetUser['user_type'],
                'murajaah_days' => $murDays,
                'current_hifz_page' => (int) $targetUser['current_hifz_page'],
                'last_tikrar_page' => $lastTikrar,
                'rabt_base_pages' => $rabtBase,
                'rabt_extra_pages' => $rabtExtra,
            ],
            'murajaah_calculation' => [
                'tasks_in_round' => $tasksInRound,
                'last_completed_end' => $lastCompletedEnd,
                'prev_pool_end' => $prevPoolEnd,
                'cycle_completed' => $cycleCompleted,
                'completion_reason' => $completionReason,
                'current_cycle_day' => $currentCycleDay,
                'round_trace' => $roundTrace,
            ],
            'uncompleted_murajaah_tasks' => $uncompletedMurTasks,
            'all_recent_logs' => $userLogs,
        ],
        'other_users' => $otherUsersComparison,
    ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);

} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode([
        'success'   => false,
        'error'     => $e->getMessage(),
        'file'      => $e->getFile(),
        'line'      => $e->getLine(),
        'trace'     => $e->getTraceAsString(),
    ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
}
