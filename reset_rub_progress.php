<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz — admin one-off page: reset unfinished Rub' station progress.
 *
 * Required after the waqf-splitting change because station indices are derived
 * from the splitter. Only *unfinished* RUB_TAMKIN tasks are cleared; completed
 * tasks and rub_history are preserved.
 *
 * Security:
 *   - Only a signed-in ADMIN / SUPER_ADMIN may open it.
 *   - The reset runs on a CSRF-protected POST, never on GET.
 *
 * Delete this file after running it if you prefer.
 */

@ini_set('display_errors', '0');
error_reporting(E_ALL);
@set_time_limit(0);

header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store, max-age=0');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');
header('Referrer-Policy: strict-origin-when-cross-origin');

require __DIR__ . '/config/database.php';
require_once __DIR__ . '/config/auth.php';
require_once __DIR__ . '/config/reset_rub_station_progress.php';

function rr_h($value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function rr_page_start(): void
{
    ?>
<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>رفيق الحفظ — تصفير تقدّم المواقف</title>
<style>
  :root { color-scheme: light dark; --accent:#0f766e; --line:#d8e3e1; --soft:#f2f8f7; --warn:#9a5b00; --warn-soft:#fff5e6; --ok:#166534; --ok-soft:#ecfdf3; --err:#9f1239; --err-soft:#fff1f2; }
  body { font-family: system-ui, "Segoe UI", Tahoma, sans-serif; margin:0; background:#f6faf9; color:#13302d; line-height:1.9; }
  main { max-width:900px; margin:0 auto; padding:2rem 1rem 4rem; }
  h1 { font-size:1.6rem; margin:0 0 .35rem; }
  p, li { font-size:.95rem; }
  .card { background:#fff; border:1px solid var(--line); border-radius:14px; padding:1.1rem 1.2rem; margin:1rem 0; box-shadow:0 8px 24px rgba(15,118,110,.05); }
  .muted { color:#5b7370; font-size:.88rem; }
  .ok { background:var(--ok-soft); color:var(--ok); border:1px solid #b7e4c7; padding:.75rem .9rem; border-radius:10px; }
  .warn { background:var(--warn-soft); color:var(--warn); border:1px solid #f5d7a6; padding:.75rem .9rem; border-radius:10px; }
  .err { background:var(--err-soft); color:var(--err); border:1px solid #fecdd3; padding:.75rem .9rem; border-radius:10px; }
  button { border:0; border-radius:10px; padding:.7rem 1.1rem; font:inherit; font-weight:800; cursor:pointer; background:var(--accent); color:#fff; }
  code { background:#eef6f5; padding:.1rem .35rem; border-radius:5px; direction:ltr; display:inline-block; }
  .badge { display:inline-block; background:var(--soft); color:var(--accent); border:1px solid #cfe6e2; border-radius:999px; padding:.15rem .6rem; font-size:.78rem; font-weight:700; }
  a { color:var(--accent); }
</style>
</head>
<body><main>
    <?php
}

function rr_page_end(): void
{
    ?>
</main></body>
</html>
    <?php
}

try {
    $user = rh_current_user($pdo);
} catch (Throwable $t) {
    error_log('[ResetRubProgress auth] ' . $t->getMessage());
    $user = null;
}

if (!$user) {
    http_response_code(401);
    rr_page_start();
    ?>
    <span class="badge">تصفير تقدّم المواقف</span>
    <h1>يلزم تسجيل الدخول</h1>
    <div class="card">
      <p>هذه الصفحة مخصصة للمشرف. سجّل الدخول أولاً ثم أعد فتحها.</p>
      <p><a href="web/index.html">الانتقال إلى صفحة الدخول</a></p>
    </div>
    <?php
    rr_page_end();
    exit;
}

$userCols = rh_users_columns($pdo);
$hasRole = in_array('role', $userCols, true);
$active = strtoupper((string) ($user['status'] ?? 'ACTIVE')) === 'ACTIVE';
if (!$active || ($hasRole && !rh_is_admin($user))) {
    http_response_code(403);
    rr_page_start();
    ?>
    <span class="badge">تصفير تقدّم المواقف</span>
    <h1>صلاحية غير كافية</h1>
    <div class="card">
      <p>يجب تسجيل الدخول بحساب مشرف (<code>ADMIN</code> أو <code>SUPER_ADMIN</code>) لتشغيل هذا الإجراء.</p>
      <p><a href="web/index.html">العودة إلى التطبيق</a></p>
    </div>
    <?php
    rr_page_end();
    exit;
}

/* -------------------------------------------------------------------------
 * CSRF
 * ---------------------------------------------------------------------- */
rh_session_start();
if (empty($_SESSION['rh_reset_rub_csrf'])) {
    $_SESSION['rh_reset_rub_csrf'] = bin2hex(random_bytes(24));
}
$csrf = (string) $_SESSION['rh_reset_rub_csrf'];

/* -------------------------------------------------------------------------
 * Reset
 * ---------------------------------------------------------------------- */
$result = null;
$error = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!hash_equals($csrf, (string) ($_POST['csrf'] ?? ''))) {
        $error = 'انتهت صلاحية النموذج. أعد تحميل الصفحة وحاول مرة أخرى.';
    } elseif ((string) ($_POST['action'] ?? '') !== 'reset') {
        $error = 'إجراء غير معروف.';
    } else {
        try {
            $result = rh_reset_rub_station_progress($pdo);
        } catch (Throwable $t) {
            error_log('[ResetRubProgress] ' . $t->getMessage());
            $error = 'تعذر تنفيذ التصفير. راجع سجل الخادم.';
        }
    }
}

rr_page_start();
?>
<span class="badge">صيانة لمرة واحدة</span>
<h1>تصفير تقدّم المواقف لأرباع قيد الإنجاز</h1>

<div class="card">
  <p>
    بعد تغيير تقسيم الآية على علامات الوقف، تغيّر ترتيب المواقف داخل الآية.
    هذا الإجراء يمسح تقدّم المواقف فقط للمهام <strong>غير المكتملة</strong> من نوع
    <code>RUB_TAMKIN</code>، ويُبقي الربع المختار وحالة الترجيل كما هي.
  </p>
  <p class="muted">
    المهام المكتملة وسجل الأرباع (<code>rub_history</code>) لا يتأثران. الإجراء آمن
    ويمكن تشغيله أكثر من مرة.
  </p>
</div>

<?php if ($result !== null): ?>
  <?php if (!$result['available']): ?>
    <div class="warn">
      عمود <code>daily_task_logs.completed_stations</code> غير موجود؛ لا يوجد ما يُصفَّر.
    </div>
  <?php else: ?>
    <div class="ok">
      <strong>تم التصفير.</strong>
      أُعيد ضبط تقدّم <strong><?= rr_h($result['affected']) ?></strong> مهمة ربع غير مكتملة.
    </div>
  <?php endif; ?>
<?php endif; ?>

<?php if ($error !== ''): ?>
  <div class="err"><?= rr_h($error) ?></div>
<?php endif; ?>

<div class="card">
  <form method="post" action="reset_rub_progress.php" onsubmit="return confirm('هل تريد مسح تقدّم المواقف للمهام غير المكتملة؟ لا يمكن التراجع.');">
    <input type="hidden" name="csrf" value="<?= rr_h($csrf) ?>">
    <input type="hidden" name="action" value="reset">
    <button type="submit">تشغيل التصفير الآن</button>
  </form>
  <p class="muted" style="margin-bottom:0">
    بعد الانتهاء يمكنك حذف هذا الملف من الخادم.
  </p>
</div>

<?php
rr_page_end();
