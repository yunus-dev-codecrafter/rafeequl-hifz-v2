<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Muraja'ah Self-Healing Runner for user "يونس عبدالحميد"
 *
 * Open this file once in your browser: https://rafeequlhifz.infy.click/fix_user_murajaah.php
 * Delete this file from the server immediately after running it.
 */

header('Content-Type: text/html; charset=utf-8');
require __DIR__ . '/config/database.php';

echo "<h2>رفيق الحفظ — إصلاح جدول المراجعة للمستخدم (يونس عبدالحميد)</h2>";

try {
    // 1. Locate user
    $stmt = $pdo->prepare("SELECT `id`, `name`, `email`, `murajaah_days` FROM `users` WHERE `name` LIKE :n OR `email` LIKE :e LIMIT 1");
    $stmt->execute([':n' => '%يونس%', ':e' => '%yunus%']);
    $user = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$user) {
        die("<p style='color:red;'>لم يتم العثور على المستخدم في قاعدة البيانات.</p>");
    }

    $userId = (int) $user['id'];
    echo "<p>المستخدم: <strong>" . htmlspecialchars($user['name']) . "</strong> (ID: $userId)</p>";

    // 2. Backup table
    $pdo->exec("CREATE TABLE IF NOT EXISTS `daily_task_logs_backup_yunus` AS SELECT * FROM `daily_task_logs` WHERE `user_id` = $userId");
    echo "<p style='color:green;'>✓ تم أخذ نسخة احتياطية من سجلات المستخدم.</p>";

    // 3. Find uncompleted Muraja'ah task for Day 2 (or past tasks)
    $today = date('Y-m-d');
    $stmt = $pdo->prepare(
        "SELECT * FROM `daily_task_logs` 
         WHERE `user_id` = :u AND `task_type` = 'MURAJAAH' AND `is_completed` = 0
         ORDER BY `task_date` ASC, `id` ASC"
    );
    $stmt->execute([':u' => $userId]);
    $uncompleted = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $fixed = 0;
    foreach ($uncompleted as $task) {
        $start = (int) $task['start_page'];
        $end = (int) $task['end_page'];
        $pages = range($start, $end);
        $json = json_encode($pages);

        $up = $pdo->prepare("UPDATE `daily_task_logs` SET `is_completed` = 1, `completed_pages` = :p WHERE `id` = :id");
        $up->execute([':p' => $json, ':id' => $task['id']]);
        $fixed++;
        echo "<p>✓ تم تصحيح واكتمال مهمة المراجعة للـ (الصفحات $start إلى $end) بتاريخ " . htmlspecialchars($task['task_date']) . ".</p>";
    }

    if ($fixed === 0) {
        echo "<p style='color:orange;'>لم توجد مهام مراجعة سابقة معلقة (قد تكون مكتملة بالفعل).</p>";
    }

    // 4. Verification of current day calculation
    $mStmt = $pdo->prepare(
        "SELECT `id`, `start_page`, `end_page` FROM `daily_task_logs`
         WHERE `user_id` = :u AND `task_type` = 'MURAJAAH' AND `is_completed` = 1
         ORDER BY `task_date` DESC, `id` DESC LIMIT 50"
    );
    $mStmt->execute([':u' => $userId]);
    $completedTasks = $mStmt->fetchAll(PDO::FETCH_ASSOC);

    $tasksInRound = 0;
    foreach ($completedTasks as $mt) {
        $tasksInRound++;
        if ((int) $mt['start_page'] === 1) break;
    }

    $currentDay = $tasksInRound + 1;
    echo "<hr><h3>النتيجة:</h3>";
    echo "<p style='font-size:18px; color:green;'><strong>أصبح جدول المراجعة الآن على اليوم: $currentDay</strong></p>";
    echo "<p>يمكنك الآن فتح لوحة التحكم والتحقق. <strong>يُرجى حذف هذا الملف (fix_user_murajaah.php) من الخادم الآن لأسباب أمنية.</strong></p>";

} catch (Throwable $e) {
    echo "<p style='color:red;'>خطأ: " . htmlspecialchars($e->getMessage()) . "</p>";
}
