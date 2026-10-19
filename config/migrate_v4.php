<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Migration v4: authoritative accounts & administration.
 *
 * Brings an EXISTING database up to the "owner has authority" schema. It is
 * purely additive: nothing is dropped, renamed, or rewritten.
 *
 *   users            + role, status, status_reason, suspended_at,
 *                      last_login_at, last_seen_at, login_count,
 *                      must_change_password   (+ indexes)
 *   user_activity    new - one row per (user, day) driving DAU/WAU/MAU
 *   admin_audit      new - append-only log of administrator actions
 *   login_attempts   new - brute-force throttling
 *
 * Safe to run more than once (every step is checked first).
 *
 * Run (CLI):   php config/migrate_v4.php
 * Run (web):   https://your-host/config/migrate_v4.php?confirm=1
 *
 * The web mode is guarded so it cannot run by accident.
 */

require __DIR__ . '/database.php';

if (PHP_SAPI !== 'cli') {
    header('Content-Type: text/plain; charset=utf-8');
    if (($_GET['confirm'] ?? '') !== '1') {
        http_response_code(400);
        echo "Refusing to run. Append ?confirm=1 to the URL to apply the migration.\n";
        exit;
    }
}

$log = static function (string $msg): void {
    echo $msg . "\n";
    if (PHP_SAPI !== 'cli') { @ob_flush(); @flush(); }
};

$log('== Rafeequl Hifz migration v4 (accounts & administration) ==');

try {
    // -----------------------------------------------------------------------
    // 1. Columns to add to `users` (name => DDL fragment).
    // -----------------------------------------------------------------------
    $columns = [
        'role'                 => "ADD COLUMN `role` ENUM('USER','ADMIN','SUPER_ADMIN') NOT NULL DEFAULT 'USER' AFTER `user_type`",
        'status'               => "ADD COLUMN `status` ENUM('ACTIVE','SUSPENDED','DISABLED') NOT NULL DEFAULT 'ACTIVE' AFTER `role`",
        'status_reason'        => "ADD COLUMN `status_reason` VARCHAR(255) NULL AFTER `status`",
        'suspended_at'         => "ADD COLUMN `suspended_at` DATETIME NULL AFTER `status_reason`",
        'last_login_at'        => "ADD COLUMN `last_login_at` DATETIME NULL AFTER `suspended_at`",
        'last_seen_at'         => "ADD COLUMN `last_seen_at` DATETIME NULL AFTER `last_login_at`",
        'login_count'          => "ADD COLUMN `login_count` INT NOT NULL DEFAULT 0 AFTER `last_seen_at`",
        'must_change_password' => "ADD COLUMN `must_change_password` TINYINT NOT NULL DEFAULT 0 AFTER `login_count`",
    ];

    $existing = [];
    foreach ($pdo->query('SHOW COLUMNS FROM `users`') as $row) {
        $existing[strtolower((string) $row['Field'])] = true;
    }

    foreach ($columns as $name => $ddl) {
        if (isset($existing[strtolower($name)])) {
            $log("- column users.$name already present, skipping.");
            continue;
        }
        $pdo->exec("ALTER TABLE `users` $ddl");
        $log("+ added column users.$name.");
    }

    // -----------------------------------------------------------------------
    // 2. Indexes for the admin listings.
    // -----------------------------------------------------------------------
    $indexes = [];
    foreach ($pdo->query('SHOW INDEX FROM `users`') as $row) {
        $indexes[(string) $row['Key_name']] = true;
    }

    $wanted = [
        'idx_users_role'      => 'ALTER TABLE `users` ADD KEY `idx_users_role` (`role`)',
        'idx_users_status'    => 'ALTER TABLE `users` ADD KEY `idx_users_status` (`status`)',
        'idx_users_last_seen' => 'ALTER TABLE `users` ADD KEY `idx_users_last_seen` (`last_seen_at`)',
    ];
    foreach ($wanted as $name => $ddl) {
        if (isset($indexes[$name])) {
            $log("- index $name already present, skipping.");
            continue;
        }
        $pdo->exec($ddl);
        $log("+ added index $name.");
    }

    // -----------------------------------------------------------------------
    // 3. user_activity - one row per (user, day), upserted on activity.
    // -----------------------------------------------------------------------
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS `user_activity` (
            `user_id`       INT NOT NULL,
            `activity_date` DATE NOT NULL,
            `first_seen_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            `last_seen_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            `hits`          INT NOT NULL DEFAULT 0,
            PRIMARY KEY (`user_id`, `activity_date`),
            KEY `idx_user_activity_date` (`activity_date`),
            CONSTRAINT `fk_user_activity_user`
                FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
                ON DELETE CASCADE ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    $log('+ ensured table user_activity.');

    // -----------------------------------------------------------------------
    // 4. admin_audit - who did what, to whom, when.
    // -----------------------------------------------------------------------
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS `admin_audit` (
            `id`             INT NOT NULL AUTO_INCREMENT,
            `admin_user_id`  INT NOT NULL,
            `action`         VARCHAR(64) NOT NULL,
            `target_user_id` INT NULL,
            `details`        TEXT NULL,
            `ip`             VARCHAR(45) NULL,
            `created_at`     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (`id`),
            KEY `idx_admin_audit_admin` (`admin_user_id`),
            KEY `idx_admin_audit_target` (`target_user_id`),
            KEY `idx_admin_audit_created` (`created_at`),
            CONSTRAINT `fk_admin_audit_admin`
                FOREIGN KEY (`admin_user_id`) REFERENCES `users` (`id`)
                ON DELETE CASCADE ON UPDATE CASCADE,
            CONSTRAINT `fk_admin_audit_target`
                FOREIGN KEY (`target_user_id`) REFERENCES `users` (`id`)
                ON DELETE SET NULL ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    $log('+ ensured table admin_audit.');

    // -----------------------------------------------------------------------
    // 5. login_attempts - brute-force throttling.
    // -----------------------------------------------------------------------
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS `login_attempts` (
            `email`           VARCHAR(255) NOT NULL,
            `ip`              VARCHAR(45) NOT NULL DEFAULT '',
            `attempts`        INT NOT NULL DEFAULT 0,
            `last_attempt_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (`email`),
            KEY `idx_login_attempts_time` (`last_attempt_at`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    $log('+ ensured table login_attempts.');

    $log('== Migration v4 complete ==');
    $log('Next step: run config/seed_admin.php?confirm=1 to create the super admin.');
} catch (PDOException $e) {
    error_log('[MigrateV4 Failed] ' . $e->getMessage());
    http_response_code(500);
    echo 'Migration failed: ' . $e->getMessage() . "\n";
    exit(1);
}
