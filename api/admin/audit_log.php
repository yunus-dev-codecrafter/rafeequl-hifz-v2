<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Admin: recent administrator actions (audit trail).
 *
 * GET params: limit (default 50, max 200)
 * Requires an administrator session.
 */

require __DIR__ . '/../../config/auth.php';

$admin = rh_require_admin($pdo);

if (!rh_table_exists($pdo, 'admin_audit')) {
    rh_json_out(200, ['success' => true, 'entries' => [], 'available' => false]);
}

$limit = (int) ($_GET['limit'] ?? 50);
$limit = max(1, min(200, $limit));

try {
    $stmt = $pdo->prepare(
        'SELECT a.`id`, a.`action`, a.`target_user_id`, a.`details`, a.`ip`, a.`created_at`,
                ad.`name` AS `admin_name`, ad.`email` AS `admin_email`,
                tg.`name` AS `target_name`, tg.`email` AS `target_email`
         FROM `admin_audit` a
         LEFT JOIN `users` ad ON ad.`id` = a.`admin_user_id`
         LEFT JOIN `users` tg ON tg.`id` = a.`target_user_id`
         ORDER BY a.`created_at` DESC, a.`id` DESC
         LIMIT ' . $limit
    );
    $stmt->execute();

    $entries = array_map(static function (array $r): array {
        return [
            'id'            => (int) $r['id'],
            'action'        => (string) $r['action'],
            'admin_name'    => $r['admin_name'] !== null ? (string) $r['admin_name'] : null,
            'admin_email'   => $r['admin_email'] !== null ? (string) $r['admin_email'] : null,
            'target_user_id' => $r['target_user_id'] !== null ? (int) $r['target_user_id'] : null,
            'target_name'   => $r['target_name'] !== null ? (string) $r['target_name'] : null,
            'target_email'  => $r['target_email'] !== null ? (string) $r['target_email'] : null,
            'details'       => $r['details'] !== null ? (string) $r['details'] : null,
            'ip'            => $r['ip'] !== null ? (string) $r['ip'] : null,
            'created_at'    => (string) $r['created_at'],
        ];
    }, $stmt->fetchAll());

    rh_json_out(200, ['success' => true, 'available' => true, 'entries' => $entries]);
} catch (Throwable $e) {
    error_log('[AdminAuditLog Failed] ' . $e->getMessage());
    rh_json_out(500, ['success' => false, 'error' => 'Server error. Please try again.']);
}
