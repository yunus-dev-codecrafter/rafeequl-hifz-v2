<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Seed the super administrator account.
 *
 * Creates (or repairs) the single "president" account that owns the platform.
 * This account is NOT a learner: it is excluded from the user listings and is
 * used only to administer other accounts from web/admin.html.
 *
 * Security:
 *  - The password is never stored in this file. By default a strong random one
 *    is generated and printed ONCE, to the operator running this script.
 *  - The account is flagged `must_change_password = 1`; the app forces a change
 *    on first login.
 *  - Idempotent: running it again only ensures the role/status, and never
 *    silently resets an existing password (use ?reset=1 for that).
 *
 * Requirements: migration v4 must have been applied first.
 *
 * Run (web):  https://your-host/config/seed_admin.php?confirm=1
 *             https://your-host/config/seed_admin.php?confirm=1&password=YourStrongPass
 *             https://your-host/config/seed_admin.php?confirm=1&reset=1
 * Run (CLI):  php config/seed_admin.php
 *             php config/seed_admin.php password=YourStrongPass
 *             php config/seed_admin.php reset=1
 *
 * The web mode is guarded so it cannot run by accident.
 */

require __DIR__ . '/database.php';

/** Parse "key=value" CLI args into $_GET-compatible pairs. */
$cliArgs = [];
if (PHP_SAPI === 'cli') {
    foreach (array_slice($argv, 1) as $arg) {
        if (strpos($arg, '=') !== false) {
            [$k, $v] = explode('=', $arg, 2);
            $cliArgs[$k] = $v;
        } else {
            $cliArgs[$arg] = '1';
        }
    }
}

$param = static function (string $key, string $default = '') use ($cliArgs): string {
    if (PHP_SAPI === 'cli') {
        return (string) ($cliArgs[$key] ?? $default);
    }
    return (string) ($_GET[$key] ?? $default);
};

if (PHP_SAPI !== 'cli') {
    header('Content-Type: text/plain; charset=utf-8');
    if ($param('confirm') !== '1') {
        http_response_code(400);
        echo "Refusing to run. Append ?confirm=1 to the URL to seed the administrator.\n";
        exit;
    }
}

$log = static function (string $msg): void {
    echo $msg . "\n";
    if (PHP_SAPI !== 'cli') { @ob_flush(); @flush(); }
};

$log('== Rafeequl Hifz - seed super administrator ==');

$email = trim($param('email', 'muhaffiz125@gmail.com'));
$name  = trim($param('name', 'المشرف العام'));
$reset = $param('reset') === '1';
$explicitPassword = (string) $param('password', '');

if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    http_response_code(400);
    echo "Invalid email address.\n";
    exit(1);
}

/** Strong, human-copyable password generator. */
$generatePassword = static function (int $len = 16): string {
    $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    $max = strlen($alphabet) - 1;
    $out = '';
    for ($i = 0; $i < $len; $i++) {
        $out .= $alphabet[random_int(0, $max)];
    }
    return $out;
};

try {
    // -- Require migration v4 -------------------------------------------------
    $cols = [];
    foreach ($pdo->query('SHOW COLUMNS FROM `users`') as $row) {
        $cols[strtolower((string) $row['Field'])] = true;
    }
    if (!isset($cols['role'], $cols['status'], $cols['must_change_password'])) {
        http_response_code(500);
        echo "The users table is missing the v4 columns.\n";
        echo "Run config/migrate_v4.php?confirm=1 first, then re-run this script.\n";
        exit(1);
    }

    // -- Existing account? ----------------------------------------------------
    $stmt = $pdo->prepare('SELECT `id`, `role`, `status` FROM `users` WHERE `email` = :e LIMIT 1');
    $stmt->execute([':e' => $email]);
    $existing = $stmt->fetch();

    $shouldSetPassword = !$existing || $reset || $explicitPassword !== '';

    if (!$existing) {
        $password = $explicitPassword !== '' ? $explicitPassword : $generatePassword();
        $hash = password_hash($password, PASSWORD_DEFAULT);

        $ins = $pdo->prepare(
            'INSERT INTO `users`
                (`name`, `email`, `password_hash`, `user_type`, `role`, `status`,
                 `current_hifz_page`, `daily_murajaah_target_pages`, `murajaah_days`,
                 `rabt_extra_pages`, `last_tikrar_page`, `must_change_password`)
             VALUES
                (:name, :email, :hash, \'COMPLETE\', \'SUPER_ADMIN\', \'ACTIVE\',
                 0, 100, 6, 0, 0, 1)'
        );
        $ins->execute([':name' => $name, ':email' => $email, ':hash' => $hash]);
        $newId = (int) $pdo->lastInsertId();

        $log("+ created SUPER_ADMIN #$newId <$email>.");
    } else {
        $newId = (int) $existing['id'];

        $upd = $pdo->prepare(
            "UPDATE `users`
             SET `role` = 'SUPER_ADMIN',
                 `status` = 'ACTIVE',
                 `status_reason` = NULL,
                 `suspended_at` = NULL
             WHERE `id` = :id"
        );
        $upd->execute([':id' => $newId]);
        $log("= existing account #$newId <$email> ensured SUPER_ADMIN / ACTIVE.");

        if ($shouldSetPassword) {
            $password = $explicitPassword !== '' ? $explicitPassword : $generatePassword();
            $hash = password_hash($password, PASSWORD_DEFAULT);
            $pdo->prepare('UPDATE `users` SET `password_hash` = :h, `must_change_password` = 1 WHERE `id` = :id')
                ->execute([':h' => $hash, ':id' => $newId]);
            $log('+ password was reset.');
        } else {
            $log('- password left unchanged (pass ?reset=1 or ?password=... to change it).');
        }
    }

    $log('');
    $log('Sign in at web/index.html with:');
    $log('  email:    ' . $email);
    if ($shouldSetPassword) {
        $log('  password: ' . $password);
        $log('');
        $log('! Store this password now - it is shown only once.');
        $log('! You will be asked to change it on first login.');
    } else {
        $log('  password: (unchanged)');
    }
    $log('');
    $log('== Done ==');
} catch (PDOException $e) {
    error_log('[SeedAdmin Failed] ' . $e->getMessage());
    http_response_code(500);
    echo 'Seed failed: ' . $e->getMessage() . "\n";
    exit(1);
}
