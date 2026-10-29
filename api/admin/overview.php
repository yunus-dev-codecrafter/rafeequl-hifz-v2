<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Admin: global overview KPIs.
 *
 * GET -> platform-wide counters for the owner's dashboard.
 * Requires an administrator session.
 */

require __DIR__ . '/../../config/auth.php';

$admin = rh_require_admin($pdo);

$cols     = rh_users_columns($pdo);
$hasRole  = in_array('role', $cols, true);
$hasStat  = in_array('status', $cols, true);
$hasSeen  = in_array('last_seen_at', $cols, true);
$actTable = rh_table_exists($pdo, 'user_activity');

$one = static function (PDO $pdo, string $sql, array $params = []): int {
    try {
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        return (int) $stmt->fetchColumn();
    } catch (Throwable $t) {
        return 0;
    }
};

$learnerWhere = $hasRole ? "`role` = 'USER'" : '1 = 1';

try {
    $byStatus = ['ACTIVE' => 0, 'SUSPENDED' => 0, 'DISABLED' => 0];
    if ($hasStat) {
        foreach ($pdo->query("SELECT `status`, COUNT(*) AS c FROM `users` WHERE $learnerWhere GROUP BY `status`") as $row) {
            $byStatus[strtoupper((string) $row['status'])] = (int) $row['c'];
        }
    }

    $overview = [
        'generated_at' => date('c'),
        'users' => [
            'total'     => $one($pdo, "SELECT COUNT(*) FROM `users` WHERE $learnerWhere"),
            'admins'    => $hasRole ? $one($pdo, "SELECT COUNT(*) FROM `users` WHERE `role` IN ('ADMIN','SUPER_ADMIN')") : 1,
            'new_today' => $one($pdo, "SELECT COUNT(*) FROM `users` WHERE $learnerWhere AND DATE(`created_at`) = CURDATE()"),
            'new_7d'    => $one($pdo, "SELECT COUNT(*) FROM `users` WHERE $learnerWhere AND `created_at` >= (NOW() - INTERVAL 7 DAY)"),
            'new_30d'   => $one($pdo, "SELECT COUNT(*) FROM `users` WHERE $learnerWhere AND `created_at` >= (NOW() - INTERVAL 30 DAY)"),
            'by_status' => $byStatus,
        ],
        'usage' => [
            'tracked' => $actTable,
            'dau'     => $actTable ? $one($pdo, 'SELECT COUNT(DISTINCT `user_id`) FROM `user_activity` WHERE `activity_date` = CURDATE()') : 0,
            'wau'     => $actTable ? $one($pdo, 'SELECT COUNT(DISTINCT `user_id`) FROM `user_activity` WHERE `activity_date` >= (CURDATE() - INTERVAL 6 DAY)') : 0,
            'mau'     => $actTable ? $one($pdo, 'SELECT COUNT(DISTINCT `user_id`) FROM `user_activity` WHERE `activity_date` >= (CURDATE() - INTERVAL 29 DAY)') : 0,
            'active_last_hour' => $hasSeen
                ? $one($pdo, "SELECT COUNT(*) FROM `users` WHERE $learnerWhere AND `last_seen_at` >= (NOW() - INTERVAL 1 HOUR)")
                : 0,
        ],
        'progress' => [
            'pages_memorized'  => $one($pdo, "SELECT COALESCE(SUM(`current_hifz_page`), 0) FROM `users` WHERE $learnerWhere"),
            'active_mistakes'  => $one($pdo, "SELECT COUNT(*) FROM `mistakes` WHERE `status` = 'ACTIVE'"),
            'due_now'          => $one($pdo, "SELECT COALESCE(SUM(GREATEST(`practice_target` - `practice_count`, 0)), 0) FROM `mistakes` WHERE `status` = 'ACTIVE'"),
            'graduated'        => $one($pdo, "SELECT COUNT(*) FROM `mistakes` WHERE `status` = 'ARCHIVED'"),
            'reviews_all_time' => rh_table_exists($pdo, 'mistake_events')
                ? $one($pdo, "SELECT COUNT(*) FROM `mistake_events` WHERE `event_type` IN ('AGAIN','HARD','GOOD','EASY','MASTERED')")
                : 0,
            'task_logs'        => rh_table_exists($pdo, 'daily_task_logs')
                ? $one($pdo, 'SELECT COUNT(*) FROM `daily_task_logs`')
                : 0,
        ],
    ];

    // Recent sign-ups (nice "is anyone joining?" signal).
    $select = '`id`, `name`, `email`, `created_at`';
    $select .= $hasStat ? ', `status`' : ", 'ACTIVE' AS `status`";
    $select .= $hasSeen ? ', `last_seen_at`' : ', NULL AS `last_seen_at`';
    $where  = $hasRole ? "WHERE `role` = 'USER'" : '';
    $stmt = $pdo->query("SELECT $select FROM `users` $where ORDER BY `created_at` DESC LIMIT 8");
    $overview['recent_signups'] = array_map(static function (array $r): array {
        return [
            'id'            => (int) $r['id'],
            'name'          => (string) $r['name'],
            'email'         => (string) $r['email'],
            'status'        => (string) $r['status'],
            'created_at'    => (string) $r['created_at'],
            'last_seen_at'  => $r['last_seen_at'] !== null ? (string) $r['last_seen_at'] : null,
        ];
    }, $stmt->fetchAll());

    rh_json_out(200, ['success' => true, 'overview' => $overview]);
} catch (Throwable $e) {
    error_log('[AdminOverview Failed] ' . $e->getMessage());
    rh_json_out(500, ['success' => false, 'error' => 'Server error. Please try again.']);
}
