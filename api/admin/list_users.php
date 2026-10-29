<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Admin: paginated user directory.
 *
 * GET params:
 *   q         search name/email
 *   status    ACTIVE | SUSPENDED | DISABLED
 *   role      USER | ADMIN | SUPER_ADMIN   (default: USER, i.e. learners)
 *   sort      created_at | last_seen_at | last_login_at | name | current_hifz_page | login_count
 *   dir       asc | desc                     (default desc)
 *   page      1-based                        (default 1)
 *   per_page  1..100                         (default 25)
 *
 * Requires an administrator session.
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

$cols    = rh_users_columns($pdo);
$hasRole = in_array('role', $cols, true);
$hasStat = in_array('status', $cols, true);
$hasSeen = in_array('last_seen_at', $cols, true);
$hasLastLogin = in_array('last_login_at', $cols, true);
$hasLogins    = in_array('login_count', $cols, true);
$hasMustChange = in_array('must_change_password', $cols, true);
$actTable = rh_table_exists($pdo, 'user_activity');

$perPage = (int) ($input['per_page'] ?? 25);
$perPage = max(1, min(100, $perPage));
$page    = max(1, (int) ($input['page'] ?? 1));
$offset  = ($page - 1) * $perPage;

$where  = [];
$params = [];

// Default to learners; an explicit role=* returns everyone.
$role = strtoupper(trim((string) ($input['role'] ?? 'USER')));
if ($hasRole && $role !== '*' && $role !== '') {
    $allowed = ['USER', 'ADMIN', 'SUPER_ADMIN'];
    if (!in_array($role, $allowed, true)) {
        $role = 'USER';
    }
    $where[] = '`role` = :role';
    $params[':role'] = $role;
}

$status = strtoupper(trim((string) ($input['status'] ?? '')));
if ($hasStat && $status !== '' && in_array($status, ['ACTIVE', 'SUSPENDED', 'DISABLED'], true)) {
    $where[] = '`status` = :status';
    $params[':status'] = $status;
}

$q = trim((string) ($input['q'] ?? ''));
if ($q !== '') {
    $where[] = '(`name` LIKE :q OR `email` LIKE :q2)';
    $params[':q']  = '%' . $q . '%';
    $params[':q2'] = '%' . $q . '%';
}

$whereSql = $where ? ('WHERE ' . implode(' AND ', $where)) : '';

$sortable = [
    'created_at'        => '`created_at`',
    'last_seen_at'      => $hasSeen ? '`last_seen_at`' : '`created_at`',
    'last_login_at'     => $hasLastLogin ? '`last_login_at`' : '`created_at`',
    'name'              => '`name`',
    'current_hifz_page' => '`current_hifz_page`',
    'login_count'       => $hasLogins ? '`login_count`' : '`created_at`',
];
$sortKey = (string) ($input['sort'] ?? 'created_at');
$sortCol = $sortable[$sortKey] ?? '`created_at`';
$dir     = strtolower((string) ($input['dir'] ?? 'desc')) === 'asc' ? 'ASC' : 'DESC';

$select = '`id`, `name`, `email`, `user_type`, `current_hifz_page`, `created_at`';
$select .= $hasRole ? ', `role`' : ", 'USER' AS `role`";
$select .= $hasStat ? ', `status`' : ", 'ACTIVE' AS `status`";
$select .= $hasSeen ? ', `last_seen_at`' : ', NULL AS `last_seen_at`';
$select .= $hasLastLogin ? ', `last_login_at`' : ', NULL AS `last_login_at`';
$select .= $hasLogins ? ', `login_count`' : ', 0 AS `login_count`';
$select .= $hasMustChange ? ', `must_change_password`' : ', 0 AS `must_change_password`';

$select .= ',
    (SELECT COUNT(*) FROM `mistakes` m WHERE m.`user_id` = `users`.`id` AND m.`status` = \'ACTIVE\') AS `active_mistakes`,
    (SELECT COALESCE(SUM(GREATEST(m.`practice_target` - m.`practice_count`, 0)), 0) FROM `mistakes` m WHERE m.`user_id` = `users`.`id` AND m.`status` = \'ACTIVE\') AS `due_now`,
    (SELECT COUNT(*) FROM `mistakes` m WHERE m.`user_id` = `users`.`id` AND m.`status` = \'ARCHIVED\') AS `graduated`';

if (rh_table_exists($pdo, 'daily_task_logs')) {
    $select .= ', (SELECT COUNT(DISTINCT d.`task_date`) FROM `daily_task_logs` d WHERE d.`user_id` = `users`.`id`) AS `task_days`';
} else {
    $select .= ', 0 AS `task_days`';
}

if ($actTable) {
    $select .= ', (SELECT COUNT(*) FROM `user_activity` a WHERE a.`user_id` = `users`.`id` AND a.`activity_date` >= (CURDATE() - INTERVAL 29 DAY)) AS `active_days_30`';
    $select .= ', (SELECT MAX(a.`last_seen_at`) FROM `user_activity` a WHERE a.`user_id` = `users`.`id`) AS `last_active_at`';
} else {
    $select .= ', 0 AS `active_days_30`, NULL AS `last_active_at`';
}

try {
    $countStmt = $pdo->prepare("SELECT COUNT(*) FROM `users` $whereSql");
    $countStmt->execute($params);
    $total = (int) $countStmt->fetchColumn();

    $sql = "SELECT $select FROM `users` $whereSql ORDER BY $sortCol $dir, `id` DESC LIMIT $perPage OFFSET $offset";
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    $users = array_map(static function (array $r): array {
        return [
            'id'                 => (int) $r['id'],
            'name'               => (string) $r['name'],
            'email'              => (string) $r['email'],
            'role'               => (string) $r['role'],
            'status'             => (string) $r['status'],
            'user_type'          => (string) $r['user_type'],
            'current_hifz_page'  => (int) $r['current_hifz_page'],
            'created_at'         => (string) $r['created_at'],
            'last_login_at'      => $r['last_login_at'] !== null ? (string) $r['last_login_at'] : null,
            'last_seen_at'       => $r['last_seen_at'] !== null ? (string) $r['last_seen_at'] : null,
            'last_active_at'     => $r['last_active_at'] !== null ? (string) $r['last_active_at'] : null,
            'login_count'        => (int) $r['login_count'],
            'must_change_password' => (int) $r['must_change_password'] === 1,
            'active_mistakes'    => (int) $r['active_mistakes'],
            'due_now'            => (int) $r['due_now'],
            'graduated'          => (int) $r['graduated'],
            'task_days'          => (int) $r['task_days'],
            'active_days_30'     => (int) $r['active_days_30'],
        ];
    }, $rows);

    rh_json_out(200, [
        'success'  => true,
        'users'    => $users,
        'total'    => $total,
        'page'     => $page,
        'per_page' => $perPage,
        'pages'    => max(1, (int) ceil($total / $perPage)),
    ]);
} catch (Throwable $e) {
    error_log('[AdminListUsers Failed] ' . $e->getMessage());
    rh_json_out(500, ['success' => false, 'error' => 'Server error. Please try again.']);
}
