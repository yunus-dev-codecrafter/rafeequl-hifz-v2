<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Admin: full detail for a single account ("know A to Z").
 *
 * GET params: id (required)
 *
 * Returns profile + progress + usage timeline + mistake analytics + a small
 * activity feed. Requires an administrator session.
 */

require __DIR__ . '/../../config/auth.php';

$admin = rh_require_admin($pdo);

$input = $_GET + (function (): array {
    $raw = file_get_contents('php://input');
    if (is_string($raw) && $raw !== '') {
        $j = json_decode($raw, true);
        if (is_array($j)) {
            return $j;
        }
    }
    return [];
})();

$targetId = $input['id'] ?? null;
if (!filter_var($targetId, FILTER_VALIDATE_INT)) {
    rh_json_out(400, ['success' => false, 'error' => 'A valid id is required.']);
}
$targetId = (int) $targetId;

$cols      = rh_users_columns($pdo);
$hasRole   = in_array('role', $cols, true);
$hasStat   = in_array('status', $cols, true);
$hasSeen   = in_array('last_seen_at', $cols, true);
$hasLast   = in_array('last_login_at', $cols, true);
$hasLogins = in_array('login_count', $cols, true);
$hasReason = in_array('status_reason', $cols, true);
$hasSusp   = in_array('suspended_at', $cols, true);
$hasMust   = in_array('must_change_password', $cols, true);
$actTable  = rh_table_exists($pdo, 'user_activity');

$select = '`id`, `name`, `email`, `user_type`, `current_hifz_page`, `daily_murajaah_target_pages`, `murajaah_days`, `rabt_extra_pages`, `last_tikrar_page`, `created_at`';
$select .= $hasRole ? ', `role`' : ", 'USER' AS `role`";
$select .= $hasStat ? ', `status`' : ", 'ACTIVE' AS `status`";
$select .= $hasReason ? ', `status_reason`' : ', NULL AS `status_reason`';
$select .= $hasSusp ? ', `suspended_at`' : ', NULL AS `suspended_at`';
$select .= $hasSeen ? ', `last_seen_at`' : ', NULL AS `last_seen_at`';
$select .= $hasLast ? ', `last_login_at`' : ', NULL AS `last_login_at`';
$select .= $hasLogins ? ', `login_count`' : ', 0 AS `login_count`';
$select .= $hasMust ? ', `must_change_password`' : ', 0 AS `must_change_password`';

try {
    $stmt = $pdo->prepare("SELECT $select FROM `users` WHERE `id` = :id LIMIT 1");
    $stmt->execute([':id' => $targetId]);
    $u = $stmt->fetch();
    if (!$u) {
        rh_json_out(404, ['success' => false, 'error' => 'User not found.']);
    }

    $profile = [
        'id'                          => (int) $u['id'],
        'name'                        => (string) $u['name'],
        'email'                       => (string) $u['email'],
        'role'                        => (string) $u['role'],
        'status'                      => (string) $u['status'],
        'status_reason'               => $u['status_reason'] !== null ? (string) $u['status_reason'] : null,
        'suspended_at'                => $u['suspended_at'] !== null ? (string) $u['suspended_at'] : null,
        'user_type'                   => (string) $u['user_type'],
        'current_hifz_page'           => (int) $u['current_hifz_page'],
        'daily_murajaah_target_pages' => (int) $u['daily_murajaah_target_pages'],
        'murajaah_days'               => (int) $u['murajaah_days'],
        'rabt_extra_pages'            => (int) $u['rabt_extra_pages'],
        'last_tikrar_page'            => (int) $u['last_tikrar_page'],
        'created_at'                  => (string) $u['created_at'],
        'last_seen_at'                => $u['last_seen_at'] !== null ? (string) $u['last_seen_at'] : null,
        'last_login_at'               => $u['last_login_at'] !== null ? (string) $u['last_login_at'] : null,
        'login_count'                 => (int) $u['login_count'],
        'must_change_password'        => (int) $u['must_change_password'] === 1,
        'is_self'                     => (int) $u['id'] === (int) $admin['id'],
    ];

    $count = static function (PDO $pdo, string $sql, array $params = []): int {
        try {
            $stmt = $pdo->prepare($sql);
            $stmt->execute($params);
            return (int) $stmt->fetchColumn();
        } catch (Throwable $t) {
            return 0;
        }
    };

    $p = [':u' => $targetId];

    $counts = [
        'active_mistakes' => $count($pdo, "SELECT COUNT(*) FROM `mistakes` WHERE `user_id` = :u AND `status` = 'ACTIVE'", $p),
        'due_now'         => $count($pdo, "SELECT COALESCE(SUM(GREATEST(`practice_target` - `practice_count`, 0)), 0) FROM `mistakes` WHERE `user_id` = :u AND `status` = 'ACTIVE'", $p),
        'graduated'       => $count($pdo, "SELECT COUNT(*) FROM `mistakes` WHERE `user_id` = :u AND `status` = 'ARCHIVED'", $p),
        'mistakes_total'  => $count($pdo, 'SELECT COUNT(*) FROM `mistakes` WHERE `user_id` = :u', $p),
        'reviews'         => rh_table_exists($pdo, 'mistake_events')
            ? $count($pdo, "SELECT COUNT(*) FROM `mistake_events` WHERE `user_id` = :u AND `event_type` IN ('AGAIN','HARD','GOOD','EASY','MASTERED')", $p)
            : 0,
        'notes'           => rh_table_exists($pdo, 'page_notes')
            ? $count($pdo, 'SELECT COUNT(*) FROM `page_notes` WHERE `user_id` = :u', $p)
            : 0,
        'task_days'       => rh_table_exists($pdo, 'daily_task_logs')
            ? $count($pdo, 'SELECT COUNT(DISTINCT `task_date`) FROM `daily_task_logs` WHERE `user_id` = :u', $p)
            : 0,
        'pages_completed' => rh_table_exists($pdo, 'daily_task_logs')
            ? $count($pdo, 'SELECT COUNT(*) FROM `daily_task_logs` WHERE `user_id` = :u AND `is_completed` = 1', $p)
            : 0,
    ];

    // -- Usage timeline (last 30 days) --------------------------------------
    $usageDays = [];
    if ($actTable) {
        $stmt = $pdo->prepare(
            'SELECT `activity_date`, `first_seen_at`, `last_seen_at`, `hits`
             FROM `user_activity`
             WHERE `user_id` = :u AND `activity_date` >= (CURDATE() - INTERVAL 29 DAY)
             ORDER BY `activity_date` ASC'
        );
        $stmt->execute($p);
        foreach ($stmt->fetchAll() as $r) {
            $usageDays[] = [
                'date'     => (string) $r['activity_date'],
                'hits'     => (int) $r['hits'],
                'first_at' => (string) $r['first_seen_at'],
                'last_at'  => (string) $r['last_seen_at'],
            ];
        }
    }

    // Current activity streak (consecutive days ending today or yesterday).
    $streak = 0;
    $dates = array_map(static fn(array $d): string => $d['date'], $usageDays);
    $cursor = strtotime('today');
    if (!in_array(date('Y-m-d', $cursor), $dates, true)) {
        $cursor = strtotime('yesterday');
    }
    while (in_array(date('Y-m-d', $cursor), $dates, true)) {
        $streak++;
        $cursor = strtotime('-1 day', $cursor);
    }

    $usage = [
        'tracked'      => $actTable,
        'days'         => $usageDays,
        'active_days_30' => count($usageDays),
        'streak'       => $streak,
        'total_hits_30' => array_sum(array_map(static fn(array $d): int => $d['hits'], $usageDays)),
    ];

    // -- Mistake analytics ---------------------------------------------------
    $typeDist = [];
    $stmt = $pdo->prepare(
        'SELECT `mistake_type`, COUNT(*) AS c FROM `mistakes` WHERE `user_id` = :u GROUP BY `mistake_type`'
    );
    $stmt->execute($p);
    foreach ($stmt->fetchAll() as $row) {
        $typeDist[] = ['type' => (string) $row['mistake_type'], 'count' => (int) $row['c']];
    }

    $weakSurahs = [];
    $stmt = $pdo->prepare(
        'SELECT `surah_number`, COUNT(*) AS c
         FROM `mistakes` WHERE `user_id` = :u
         GROUP BY `surah_number` ORDER BY c DESC, `surah_number` ASC LIMIT 8'
    );
    $stmt->execute($p);
    foreach ($stmt->fetchAll() as $row) {
        $weakSurahs[] = ['surah_number' => (int) $row['surah_number'], 'count' => (int) $row['c']];
    }

    $recentEvents = [];
    if (rh_table_exists($pdo, 'mistake_events')) {
        $stmt = $pdo->prepare(
            'SELECT `event_type`, `grade`, `interval_after`, `created_at`
             FROM `mistake_events` WHERE `user_id` = :u ORDER BY `created_at` DESC, `id` DESC LIMIT 20'
        );
        $stmt->execute($p);
        foreach ($stmt->fetchAll() as $row) {
            $recentEvents[] = [
                'event_type'     => (string) $row['event_type'],
                'grade'          => $row['grade'] !== null ? (int) $row['grade'] : null,
                'interval_after' => $row['interval_after'] !== null ? (int) $row['interval_after'] : null,
                'created_at'     => (string) $row['created_at'],
            ];
        }
    }

    $taskLogs = [];
    if (rh_table_exists($pdo, 'daily_task_logs')) {
        $stmt = $pdo->prepare(
            'SELECT `task_date`, `task_type`, `start_page`, `end_page`, `repetition_count`, `is_completed`
             FROM `daily_task_logs` WHERE `user_id` = :u ORDER BY `task_date` DESC, `id` DESC LIMIT 14'
        );
        $stmt->execute($p);
        foreach ($stmt->fetchAll() as $row) {
            $taskLogs[] = [
                'task_date'        => (string) $row['task_date'],
                'task_type'        => (string) $row['task_type'],
                'start_page'       => (int) $row['start_page'],
                'end_page'         => (int) $row['end_page'],
                'repetition_count' => (int) $row['repetition_count'],
                'is_completed'     => (int) $row['is_completed'] === 1,
            ];
        }
    }

    $audit = [];
    if (rh_table_exists($pdo, 'admin_audit')) {
        $stmt = $pdo->prepare(
            'SELECT `action`, `details`, `created_at`, `admin_user_id`
             FROM `admin_audit` WHERE `target_user_id` = :u ORDER BY `created_at` DESC, `id` DESC LIMIT 15'
        );
        $stmt->execute($p);
        foreach ($stmt->fetchAll() as $row) {
            $audit[] = [
                'action'        => (string) $row['action'],
                'details'       => $row['details'] !== null ? (string) $row['details'] : null,
                'created_at'    => (string) $row['created_at'],
                'admin_user_id'=> (int) $row['admin_user_id'],
            ];
        }
    }

    rh_json_out(200, [
        'success'   => true,
        'profile'   => $profile,
        'counts'    => $counts,
        'usage'     => $usage,
        'analytics' => [
            'type_distribution' => $typeDist,
            'weak_surahs'       => $weakSurahs,
            'recent_events'     => $recentEvents,
        ],
        'task_logs' => $taskLogs,
        'audit'     => $audit,
    ]);
} catch (Throwable $e) {
    error_log('[AdminGetUser Failed] ' . $e->getMessage());
    rh_json_out(500, ['success' => false, 'error' => 'Server error. Please try again.']);
}
