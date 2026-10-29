<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - administrator migration runner.
 *
 * Why this page exists: setup.php intentionally locks itself after the first
 * successful install, so it cannot be used for ordinary code upgrades. This
 * page applies migration v10 (including v7/v8/v9) to an existing database without
 * deleting config/installed.lock or re-enabling the installer.
 *
 * Security:
 *   - Only a signed-in administrator may run it.
 *   - The migration is triggered by a CSRF-protected POST, never by a GET.
 *   - config/ itself stays denied over HTTP.
 *
 * Delete this file after the migration if you prefer; keep it if you want a
 * safe place to apply future migrations.
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

function mh_h($value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

/** Current v10 readiness, without assuming the columns already exist. */
function mh_schema(PDO $pdo): array
{
    $out = [
        'users'           => false,
        'table'           => false,
        'practice_count'  => false,
        'practice_target' => false,
        'enum'            => '',
        'enum_values'     => [],
        'index'           => false,
        'kalimaat_table'  => false,
        'kalimaat_session' => false,
        'gate_column'     => false,
        'ready'           => false,
    ];

    try {
        $out['users'] = (bool) $pdo->query("SHOW TABLES LIKE 'users'")->fetchColumn();
        $out['kalimaat_table'] = (bool) $pdo->query("SHOW TABLES LIKE 'kalimaat_progress'")->fetchColumn();
    } catch (Throwable $t) {
        $out['users'] = false;
    }

    try {
        $userCols = [];
        foreach ($pdo->query('SHOW COLUMNS FROM `users`') as $row) {
            $userCols[strtolower((string) $row['Field'])] = true;
        }
        $out['gate_column'] = isset($userCols['gate_mistake_id'], $userCols['gate_mistake_locked_at']);
    } catch (Throwable $t) {
        $out['gate_column'] = false;
    }

    try {
        $kalCols = [];
        foreach ($pdo->query('SHOW COLUMNS FROM `kalimaat_progress`') as $row) {
            $kalCols[strtolower((string) $row['Field'])] = true;
        }
        $out['kalimaat_session'] = isset($kalCols['last_test_session']);
    } catch (Throwable $t) {
        $out['kalimaat_session'] = false;
    }

    $cols = [];
    try {
        foreach ($pdo->query('SHOW COLUMNS FROM `mistakes`') as $row) {
            $cols[strtolower((string) $row['Field'])] = $row;
        }
    } catch (Throwable $t) {
        return $out;
    }

    $out['table'] = true;
    $out['practice_count']  = isset($cols['practice_count']);
    $out['practice_target'] = isset($cols['practice_target']);
    $out['enum'] = (string) ($cols['mistake_type']['Type'] ?? '');

    if (preg_match_all("/'([^']+)'/", $out['enum'], $m)) {
        $out['enum_values'] = $m[1];
    }
    $lower = array_map('strtolower', $out['enum_values']);
    $required = ['ayah_mistake', 'transition_failure', 'mutashabihat'];
    $legacy   = ['tawaqquf', 'tashkeel', 'lafdh'];
    $hasRequired = count(array_intersect($required, $lower)) === count($required);
    $hasLegacy   = count(array_intersect($legacy, $lower)) > 0;

    $out['ready'] = $out['practice_count']
        && $out['practice_target']
        && $hasRequired
        && !$hasLegacy
        && $out['kalimaat_table']
        && $out['kalimaat_session']
        && $out['gate_column'];

    try {
        foreach ($pdo->query('SHOW INDEX FROM `mistakes`') as $row) {
            if ((string) ($row['Key_name'] ?? '') === 'idx_mistakes_user_status_practice') {
                $out['index'] = true;
                break;
            }
        }
    } catch (Throwable $t) {
        $out['index'] = false;
    }

    return $out;
}

function mh_page_start(string $title): void
{
    ?>
<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title><?= mh_h($title) ?></title>
<style>
  :root { color-scheme: light dark; --accent:#0f766e; --line:#d8e3e1; --soft:#f2f8f7; --warn:#9a5b00; --warn-soft:#fff5e6; --ok:#166534; --ok-soft:#ecfdf3; --err:#9f1239; --err-soft:#fff1f2; }
  body { font-family: system-ui, "Segoe UI", Tahoma, sans-serif; margin:0; background:#f6faf9; color:#13302d; line-height:1.9; }
  main { max-width:900px; margin:0 auto; padding:2rem 1rem 4rem; }
  h1 { font-size:1.6rem; margin:0 0 .35rem; }
  h2 { font-size:1.1rem; margin:1.5rem 0 .5rem; }
  p, li { font-size:.95rem; }
  .card { background:#fff; border:1px solid var(--line); border-radius:14px; padding:1.1rem 1.2rem; margin:1rem 0; box-shadow:0 8px 24px rgba(15,118,110,.05); }
  .muted { color:#5b7370; font-size:.88rem; }
  .ok { background:var(--ok-soft); color:var(--ok); border:1px solid #b7e4c7; padding:.75rem .9rem; border-radius:10px; }
  .warn { background:var(--warn-soft); color:var(--warn); border:1px solid #f5d7a6; padding:.75rem .9rem; border-radius:10px; }
  .err { background:var(--err-soft); color:var(--err); border:1px solid #fecdd3; padding:.75rem .9rem; border-radius:10px; }
  ul.clean { list-style:none; padding:0; margin:0; }
  ul.clean li { display:flex; justify-content:space-between; gap:1rem; padding:.35rem 0; border-bottom:1px dashed #e7efee; }
  .pass { color:var(--ok); font-weight:800; }
  .fail { color:#b91c1c; font-weight:800; }
  button { border:0; border-radius:10px; padding:.7rem 1.1rem; font:inherit; font-weight:800; cursor:pointer; background:var(--accent); color:#fff; }
  button.secondary { background:#e7f3f1; color:#0f5b55; }
  code { background:#eef6f5; padding:.1rem .35rem; border-radius:5px; direction:ltr; display:inline-block; }
  .badge { display:inline-block; background:var(--soft); color:var(--accent); border:1px solid #cfe6e2; border-radius:999px; padding:.15rem .6rem; font-size:.78rem; font-weight:700; }
  .log { background:#0f172a; color:#dbeafe; border-radius:10px; padding:.8rem 1rem; font-family:ui-monospace,Consolas,monospace; font-size:.78rem; direction:ltr; text-align:left; max-height:360px; overflow:auto; white-space:pre-wrap; }
  .row { display:flex; gap:.6rem; flex-wrap:wrap; align-items:center; }
  a { color:var(--accent); }
</style>
</head>
<body><main>
    <?php
}

function mh_page_end(): void
{
    ?>
</main></body></html>
    <?php
}

/* -------------------------------------------------------------------------
 * Authentication
 * ---------------------------------------------------------------------- */
$schema = mh_schema($pdo);

if (!$schema['users']) {
    http_response_code(503);
    mh_page_start('رفيق الحفظ — الترقية');
    ?>
    <span class="badge">ترقية قاعدة البيانات</span>
    <h1>التطبيق غير مثبت بعد</h1>
    <div class="card">
      <p>جدول <code>users</code> غير موجود، لذلك لا توجد قاعدة بيانات جاهزة للترقية.</p>
      <p>افتح <a href="setup.php">setup.php</a> لإكمال التثبيت أولاً.</p>
    </div>
    <?php
    mh_page_end();
    exit;
}

$user = null;
try {
    $user = rh_current_user($pdo);
} catch (Throwable $t) {
    error_log('[Migrate auth] ' . $t->getMessage());
}

if (!$user) {
    http_response_code(401);
    mh_page_start('رفيق الحفظ — الترقية');
    ?>
    <span class="badge">ترقية قاعدة البيانات</span>
    <h1>يلزم تسجيل الدخول</h1>
    <div class="card">
      <p>هذه الصفحة مخصصة للمشرف. سجّل الدخول أولاً ثم أعد فتحها.</p>
      <p><a href="web/index.html">الانتقال إلى صفحة الدخول</a></p>
    </div>
    <?php
    mh_page_end();
    exit;
}

$userCols = rh_users_columns($pdo);
$hasRole = in_array('role', $userCols, true);
$active = strtoupper((string) ($user['status'] ?? 'ACTIVE')) === 'ACTIVE';
if (!$active || ($hasRole && !rh_is_admin($user))) {
    http_response_code(403);
    mh_page_start('رفيق الحفظ — الترقية');
    ?>
    <span class="badge">ترقية قاعدة البيانات</span>
    <h1>صلاحية غير كافية</h1>
    <div class="card">
      <p>يجب تسجيل الدخول بحساب مشرف (<code>ADMIN</code> أو <code>SUPER_ADMIN</code>) لتشغيل الترقية.</p>
      <p><a href="web/index.html">العودة إلى التطبيق</a></p>
    </div>
    <?php
    mh_page_end();
    exit;
}

/* -------------------------------------------------------------------------
 * CSRF
 * ---------------------------------------------------------------------- */
rh_session_start();
if (empty($_SESSION['rh_migrate_csrf'])) {
    $_SESSION['rh_migrate_csrf'] = bin2hex(random_bytes(24));
}
$csrf = (string) $_SESSION['rh_migrate_csrf'];

/* -------------------------------------------------------------------------
 * Run migration
 * ---------------------------------------------------------------------- */
$logs = [];
$stats = null;
$error = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!hash_equals($csrf, (string) ($_POST['csrf'] ?? ''))) {
        $error = 'انتهت صلاحية النموذج. أعد تحميل الصفحة وحاول مرة أخرى.';
    } elseif ((string) ($_POST['action'] ?? '') !== 'migrate') {
        $error = 'إجراء غير معروف.';
    } elseif (!$schema['table']) {
        $error = 'جدول mistakes غير موجود. شغّل setup.php أولاً.';
    } else {
        try {
            require_once __DIR__ . '/config/migrate_v9.php';
            if (!function_exists('rh_migrate_v9')) {
                throw new RuntimeException('تعذر تحميل config/migrate_v9.php.');
            }
            $log = static function (string $message) use (&$logs): void {
                $logs[] = $message;
            };
            $stats = rh_migrate_v9($pdo, $log);
            require_once __DIR__ . '/config/migrate_v10.php';
            if (!function_exists('rh_migrate_v10')) {
                throw new RuntimeException('تعذر تحميل config/migrate_v10.php.');
            }
            $stats10 = rh_migrate_v10($pdo, $log);
            foreach (['columns_added', 'indexes_added', 'tables_created', 'enum_updates'] as $statKey) {
                $stats[$statKey] = (int) ($stats[$statKey] ?? 0) + (int) ($stats10[$statKey] ?? 0);
            }
        } catch (Throwable $t) {
            error_log('[Migrate v10] ' . $t->getMessage());
            $error = $t->getMessage();
        }
        $schema = mh_schema($pdo);
    }
}

$enumDisplay = $schema['enum'] !== '' ? $schema['enum'] : '—';

mh_page_start('رفيق الحفظ — ترقية قاعدة البيانات');
?>
<span class="badge">ترقية قاعدة البيانات</span>
<h1>ترقية قاعدة البيانات إلى v10</h1>
<p class="muted">
  مرحباً <?= mh_h($user['name'] ?? $user['email'] ?? '') ?>. هذه الصفحة تطبّق ترقية v10
  (وتشمل v7 و v8 و v9) على قاعدة البيانات الحالية. لا تحذف
  <code>config/installed.lock</code> ولا تعيد تفعيل المثبّت.
</p>
<p class="warn" style="margin-top:0">
  خذ نسخة احتياطية من قاعدة البيانات قبل الترقية. الترقية آمنة ومتكررة، لكن النسخة
  الاحتياطية هي الخطوة الأولى دائماً.
</p>

<?php if ($error !== ''): ?>
  <div class="err"><?= mh_h($error) ?></div>
<?php endif; ?>

<div class="card">
  <h2 style="margin-top:0">حالة قاعدة البيانات</h2>
  <ul class="clean">
    <li><span>جدول <code>users</code></span><span class="<?= $schema['users'] ? 'pass' : 'fail' ?>"><?= $schema['users'] ? '✓' : '✗' ?></span></li>
    <li><span>جدول <code>mistakes</code></span><span class="<?= $schema['table'] ? 'pass' : 'fail' ?>"><?= $schema['table'] ? '✓' : '✗' ?></span></li>
    <li><span>العمود <code>practice_count</code></span><span class="<?= $schema['practice_count'] ? 'pass' : 'fail' ?>"><?= $schema['practice_count'] ? '✓' : '✗' ?></span></li>
    <li><span>العمود <code>practice_target</code></span><span class="<?= $schema['practice_target'] ? 'pass' : 'fail' ?>"><?= $schema['practice_target'] ? '✓' : '✗' ?></span></li>
    <li><span>فهرس <code>idx_mistakes_user_status_practice</code></span><span class="<?= $schema['index'] ? 'pass' : 'fail' ?>"><?= $schema['index'] ? '✓' : '✗' ?></span></li>
    <li><span>جدول <code>kalimaat_progress</code></span><span class="<?= $schema['kalimaat_table'] ? 'pass' : 'fail' ?>"><?= $schema['kalimaat_table'] ? '✓' : '✗' ?></span></li>
    <li><span>العمود <code>kalimaat_progress.last_test_session</code></span><span class="<?= $schema['kalimaat_session'] ? 'pass' : 'fail' ?>"><?= $schema['kalimaat_session'] ? '✓' : '✗' ?></span></li>
    <li><span>عمودا <code>users.gate_mistake_*</code></span><span class="<?= $schema['gate_column'] ? 'pass' : 'fail' ?>"><?= $schema['gate_column'] ? '✓' : '✗' ?></span></li>
  </ul>
  <p class="muted" style="margin-bottom:0">نوع الخطأ الحالي: <code><?= mh_h($enumDisplay) ?></code></p>
</div>

<?php if (!$schema['table']): ?>
  <div class="warn">
    <strong>التطبيق غير مثبت بعد.</strong>
    شغّل <a href="setup.php">setup.php</a> أولاً، ثم عد إلى هذه الصفحة.
  </div>
<?php elseif ($schema['ready']): ?>
  <div class="ok">
    <strong>قاعدة البيانات جاهزة لـ v10.</strong>
    عدّاد التكرار ونوع الخطأ الجديد وجدول تقدّم معاني الكلمات موجودة. يمكنك إعادة تشغيل الترقية بأمان إذا أردت إصلاح أي شيء.
  </div>
  <?php if (!$schema['index']): ?>
    <div class="warn">
      الفهرس <code>idx_mistakes_user_status_practice</code> غير موجود. أعد تشغيل الترقية لإضافته.
    </div>
  <?php endif; ?>
  <div class="card">
    <form method="post" action="migrate.php" onsubmit="return confirm('إعادة تشغيل ترقية v10 آمنة ومتكررة. هل تريد المتابعة؟');">
      <input type="hidden" name="csrf" value="<?= mh_h($csrf) ?>">
      <input type="hidden" name="action" value="migrate">
      <button type="submit" class="secondary">إعادة تشغيل ترقية v10</button>
    </form>
  </div>
<?php else: ?>
  <div class="warn">
    <strong>الترقية مطلوبة.</strong>
    ستُضاف أعمدة عدّاد التكرار، ويُحوَّل نوع الخطأ إلى التصنيفات الثلاثة،
    وتُؤرشف البطاقات القديمة عند 40/40، ويُضاف جدول تقدّم معاني الكلمات. الترقية آمنة ومتكررة.
  </div>
  <div class="card">
    <form method="post" action="migrate.php">
      <input type="hidden" name="csrf" value="<?= mh_h($csrf) ?>">
      <input type="hidden" name="action" value="migrate">
      <button type="submit">تشغيل ترقية v10 الآن</button>
    </form>
    <p class="muted" style="margin-bottom:0">قد تستغرق الترقية بعض الثواني على قاعدة بيانات كبيرة. لا تغلق الصفحة.</p>
  </div>
<?php endif; ?>

<?php if ($stats !== null): ?>
  <div class="card">
    <h2 style="margin-top:0">نتيجة الترقية</h2>
    <div class="ok">
      <strong>تم تنفيذ الترقية.</strong>
      أعمدة مضافة: <?= (int) ($stats['columns_added'] ?? 0) ?> —
      فهارس مضافة: <?= (int) ($stats['indexes_added'] ?? 0) ?> —
      جداول منشأة: <?= (int) ($stats['tables_created'] ?? 0) ?> —
      تحديثات enum: <?= (int) ($stats['enum_updates'] ?? 0) ?>
    </div>
  </div>
<?php endif; ?>

<?php if ($logs): ?>
  <div class="card">
    <h2 style="margin-top:0">سجل التنفيذ</h2>
    <div class="log"><?= mh_h(implode("\n", $logs)) ?></div>
  </div>
<?php endif; ?>

<div class="card">
  <h2 style="margin-top:0">بعد الترقية</h2>
  <ol>
    <li>افتح <a href="api/health.php">api/health.php</a> وتأكد من <code>schema_ok: true</code>.</li>
    <li>أعد تحميل <a href="web/index.html">التطبيق</a> بقوة (أو امسح كاش المتصفح) لتحديث ملفات JavaScript وService Worker.</li>
    <li>اختبر تسجيل خطأ جديد، ثم بطاقة تدريب واحدة.</li>
  </ol>
  <p class="muted" style="margin-bottom:0">
    هذه الصفحة محمية بحساب المشرف ورمز CSRF. يمكنك حذف <code>migrate.php</code>
    بعد انتهاء الترقية، أو الاحتفاظ به للترقيات القادمة.
  </p>
</div>

<?php
mh_page_end();
