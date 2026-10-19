<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Update Revision Plan & User Profile
 * POST JSON: user_id, daily_murajaah_target_pages, current_hifz_page (optional), user_type (optional)
 *
 * Updates user settings and recalculates pending today's tasks if requested.
 */

require __DIR__ . '/../../config/database.php';

function json_out(int $code, array $payload): void
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    json_out(400, ['success' => false, 'error' => 'Method not allowed. Use POST.']);
}

$input = $_GET;
$raw   = file_get_contents('php://input');
if (is_string($raw) && $raw !== '') {
    $json = json_decode($raw, true);
    if (!is_array($json)) {
        json_out(400, ['success' => false, 'error' => 'Invalid JSON payload.']);
    }
    $input = array_merge($input, $json);
} elseif (!empty($_POST)) {
    $input = array_merge($input, $_POST);
}

require_once __DIR__ . '/../../config/auth.php';

// Session is authoritative. A client-supplied user_id is accepted only from an
// administrator (so the admin panel can act on other accounts).
$authUser = rh_require_login($pdo);
$userId   = rh_resolve_user_id($pdo, $authUser, $input['user_id'] ?? null);

// Ensure columns exist
try {
    $pdo->exec("ALTER TABLE `users` ADD COLUMN `murajaah_days` INT NOT NULL DEFAULT 6");
} catch (Throwable $t) {}
try {
    $pdo->exec("ALTER TABLE `users` ADD COLUMN `rabt_extra_pages` INT NOT NULL DEFAULT 0");
} catch (Throwable $t) {}
try {
    $pdo->exec("ALTER TABLE `users` ADD COLUMN `last_tikrar_page` INT NOT NULL DEFAULT 0");
} catch (Throwable $t) {}

$murajaahDays = $input['murajaah_days'] ?? null;
if ($murajaahDays !== null) {
    if (is_string($murajaahDays) && ctype_digit($murajaahDays)) {
        $murajaahDays = (int) $murajaahDays;
    }
    if (!is_int($murajaahDays) || $murajaahDays < 1 || $murajaahDays > 6) {
        $errors['murajaah_days'] = 'مدة ختم المراجعة يجب أن تكون بين 1 و 6 أيام.';
    }
}

$targetPages = $input['daily_murajaah_target_pages'] ?? null;
if ($targetPages !== null) {
    if (is_string($targetPages) && ctype_digit($targetPages)) {
        $targetPages = (int) $targetPages;
    }
    if (!is_int($targetPages) || $targetPages < 1 || $targetPages > 604) {
        $errors['daily_murajaah_target_pages'] = 'Target pages must be between 1 and 604.';
    }
}

$currentPage = $input['current_hifz_page'] ?? null;
if ($currentPage !== null) {
    if (is_string($currentPage) && ctype_digit($currentPage)) {
        $currentPage = (int) $currentPage;
    }
    if (!is_int($currentPage) || $currentPage < 0 || $currentPage > 604) {
        $errors['current_hifz_page'] = 'Current page must be between 0 and 604.';
    }
}

$userType = $input['user_type'] ?? null;
if ($userType !== null && !in_array($userType, ['NEW', 'EXISTING', 'COMPLETE'], true)) {
    $errors['user_type'] = "user_type must be 'NEW', 'EXISTING', or 'COMPLETE'.";
}

if (!empty($errors)) {
    json_out(400, ['success' => false, 'errors' => $errors]);
}

try {
    $stmt = $pdo->prepare('SELECT `id`, `user_type`, `current_hifz_page`, `daily_murajaah_target_pages`, COALESCE(`murajaah_days`, 6) AS `murajaah_days`, COALESCE(`rabt_extra_pages`, 0) AS `rabt_extra_pages` FROM `users` WHERE `id` = :id');
    $stmt->execute([':id' => $userId]);
    $user = $stmt->fetch();
    if (!$user) {
        json_out(404, ['success' => false, 'error' => 'User not found.']);
    }

    $effectiveDays = $murajaahDays !== null ? $murajaahDays : (int) $user['murajaah_days'];
    $effectiveCurrent = $currentPage !== null ? $currentPage : (int) $user['current_hifz_page'];
    $effectiveType = $userType !== null ? $userType : (string) $user['user_type'];
    $effectiveExtra = (int) $user['rabt_extra_pages'];

    // If current page changed drastically, we can reset rabt_extra_pages
    if ($currentPage !== null && $currentPage !== (int) $user['current_hifz_page']) {
        $effectiveExtra = 0;
    }

    // Determine Muraja'ah pool pages
    $rabtWindow = 30 + $effectiveExtra;
    $murajaahTotalPages = 0;
    if ($effectiveType === 'COMPLETE') {
        $murajaahTotalPages = 604;
    } elseif ($effectiveType === 'EXISTING' || $effectiveType === 'NEW') {
        $rabtStart = max(1, min($effectiveCurrent + 1, 604) - ($rabtWindow - 1));
        if ($rabtStart > 1) {
            $murajaahTotalPages = $rabtStart - 1;
        }
    }

    // Compute new target pages from days if murajaahDays provided or targetPages not explicit
    if ($murajaahTotalPages > 0) {
        $computedTarget = (int) ceil($murajaahTotalPages / $effectiveDays);
        $finalTarget = max(1, $computedTarget);
    } else {
        $finalTarget = $targetPages !== null ? $targetPages : (int) $user['daily_murajaah_target_pages'];
    }

    $updates = [];
    $params = [':id' => $userId];

    $updates[] = '`daily_murajaah_target_pages` = :target';
    $params[':target'] = $finalTarget;

    if ($murajaahDays !== null) {
        $updates[] = '`murajaah_days` = :days';
        $params[':days'] = $effectiveDays;
    }
    if ($currentPage !== null) {
        $updates[] = '`current_hifz_page` = :current';
        $params[':current'] = $currentPage;
        $updates[] = '`last_tikrar_page` = :tikrar';
        $params[':tikrar'] = $currentPage;
        $updates[] = '`rabt_extra_pages` = :extra';
        $params[':extra'] = $effectiveExtra;
    }
    if ($userType !== null) {
        $updates[] = '`user_type` = :type';
        $params[':type'] = $userType;
    }

    if (!empty($updates)) {
        $sql = 'UPDATE `users` SET ' . implode(', ', $updates) . ' WHERE `id` = :id';
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
    }

    // Today's date
    $today = date('Y-m-d');

    // Recalculate pending tasks for today if requested or if current page/type/target changed
    $recalculate = (bool) ($input['recalculate_today'] ?? true);
    if ($recalculate) {
        // Delete today's pending/uncompleted tasks so they get freshly regenerated on next load with new bounds
        $stmt = $pdo->prepare("DELETE FROM `daily_task_logs` WHERE `user_id` = :u AND `task_date` = :d AND `is_completed` = 0");
        $stmt->execute([':u' => $userId, ':d' => $today]);

        // If HIFZ_JADID or TIKRAR_AMS were logged today but current_hifz_page was explicitly modified by the user,
        // clear them for today so the new current_hifz_page takes effect immediately
        if ($currentPage !== null) {
            $stmt = $pdo->prepare("DELETE FROM `daily_task_logs` WHERE `user_id` = :u AND `task_date` = :d AND `task_type` IN ('HIFZ_JADID', 'TIKRAR_AMS')");
            $stmt->execute([':u' => $userId, ':d' => $today]);
        }
    }

    // Return fresh user data
    $stmt = $pdo->prepare('SELECT `id`, `name`, `email`, `user_type`, `current_hifz_page`, COALESCE(`last_tikrar_page`, 0) AS `last_tikrar_page`, `daily_murajaah_target_pages`, COALESCE(`murajaah_days`, 6) AS `murajaah_days`, COALESCE(`rabt_extra_pages`, 0) AS `rabt_extra_pages` FROM `users` WHERE `id` = :id');
    $stmt->execute([':id' => $userId]);
    $updatedUser = $stmt->fetch();

    json_out(200, [
        'success' => true,
        'message' => 'تم تحديث خطة المراجعة وإعدادات الحفظ بنجاح.',
        'user'    => [
            'id'                          => (int) $updatedUser['id'],
            'name'                        => (string) $updatedUser['name'],
            'email'                       => (string) $updatedUser['email'],
            'user_type'                   => (string) $updatedUser['user_type'],
            'current_hifz_page'           => (int) $updatedUser['current_hifz_page'],
            'last_tikrar_page'            => (int) $updatedUser['last_tikrar_page'],
            'daily_murajaah_target_pages' => (int) $updatedUser['daily_murajaah_target_pages'],
            'murajaah_days'               => (int) $updatedUser['murajaah_days'],
            'rabt_extra_pages'            => (int) $updatedUser['rabt_extra_pages'],
            'murajaah_total_pages'        => $murajaahTotalPages,
        ],
    ]);
} catch (PDOException $e) {
    error_log('[UpdatePlan Failed] ' . $e->getMessage());
    json_out(500, ['success' => false, 'error' => 'Server error updating plan.']);
}
