<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Mistake History & Weak-Point Analytics
 * - history:      full log (ACTIVE + ARCHIVED), sorted by date (newest first)
 * - weak_points:  top recurring weak Ayahs and Surahs, sorted by frequency
 */

require __DIR__ . '/../../config/database.php';
$labels = require __DIR__ . '/../data/labels.php';

$surahs = $labels['surahs'];
$mTypes = $labels['mistake_types'];

function json_out(int $code, array $payload): void
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

// ---------------------------------------------------------------------------
// Method & auth
// ---------------------------------------------------------------------------

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if (!in_array($method, ['GET', 'POST'], true)) {
    json_out(400, ['success' => false, 'error' => 'Method not allowed. Use GET or POST.']);
}

$input = $_GET;
if ($method === 'POST') {
    $raw = file_get_contents('php://input');
    if (is_string($raw) && $raw !== '') {
        $json = json_decode($raw, true);
        if (!is_array($json)) {
            json_out(400, ['success' => false, 'error' => 'Invalid JSON payload.']);
        }
        $input = array_merge($input, $json);
    } elseif (!empty($_POST)) {
        $input = array_merge($input, $_POST);
    }
}

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

$userId = $input['user_id'] ?? $_SESSION['user_id'] ?? null;
if ($userId === null || $userId === '') {
    json_out(401, ['success' => false, 'error' => 'Authentication required.']);
}
if (!filter_var($userId, FILTER_VALIDATE_INT)) {
    json_out(400, ['success' => false, 'error' => 'Invalid user_id.']);
}
$userId = (int) $userId;

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

try {
    // Summary: counts by status
    $stmt = $pdo->prepare(
        'SELECT `status`, COUNT(*) AS `cnt` FROM `mistakes`
         WHERE `user_id` = :u GROUP BY `status`'
    );
    $stmt->execute([':u' => $userId]);
    $active = 0;
    $archived = 0;
    foreach ($stmt->fetchAll() as $r) {
        if ($r['status'] === 'ACTIVE') {
            $active = (int) $r['cnt'];
        } elseif ($r['status'] === 'ARCHIVED') {
            $archived = (int) $r['cnt'];
        }
    }

    // Full history, newest first
    $stmt = $pdo->prepare(
        'SELECT `id`, `page_number`, `surah_number`, `ayah_number`, `mistake_type`,
                `notes`, `status`, `mastery_count`, `created_at`
         FROM `mistakes`
         WHERE `user_id` = :u
         ORDER BY `created_at` DESC, `id` DESC'
    );
    $stmt->execute([':u' => $userId]);
    $history = [];
    foreach ($stmt->fetchAll() as $row) {
        $surahNum = (int) $row['surah_number'];
        $type     = (string) $row['mistake_type'];
        $history[] = [
            'id'             => (int) $row['id'],
            'page_number'    => (int) $row['page_number'],
            'surah_number'   => $surahNum,
            'surah_name'     => $surahs[$surahNum]['ar'] ?? ('سورة ' . $surahNum),
            'ayah_number'    => (int) $row['ayah_number'],
            'mistake_type'   => $type,
            'mistake_label'  => $mTypes[$type]['ar'] ?? $type,
            'notes'          => $row['notes'],
            'status'         => $row['status'],
            'mastery_count'  => (int) $row['mastery_count'],
            'created_at'     => $row['created_at'],
        ];
    }

    // Top recurring weak Ayahs (surah + ayah level)
    $stmt = $pdo->prepare(
        'SELECT `surah_number`, `ayah_number`, COUNT(*) AS `freq`
         FROM `mistakes`
         WHERE `user_id` = :u
         GROUP BY `surah_number`, `ayah_number`
         ORDER BY `freq` DESC, `surah_number` ASC, `ayah_number` ASC
         LIMIT 10'
    );
    $stmt->execute([':u' => $userId]);
    $topAyahs = [];
    foreach ($stmt->fetchAll() as $r) {
        $surahNum = (int) $r['surah_number'];
        $topAyahs[] = [
            'surah_number' => $surahNum,
            'surah_name'   => $surahs[$surahNum]['ar'] ?? ('سورة ' . $surahNum),
            'ayah_number'  => (int) $r['ayah_number'],
            'count'        => (int) $r['freq'],
        ];
    }

    // Top recurring weak Surahs
    $stmt = $pdo->prepare(
        'SELECT `surah_number`, COUNT(*) AS `freq`
         FROM `mistakes`
         WHERE `user_id` = :u
         GROUP BY `surah_number`
         ORDER BY `freq` DESC, `surah_number` ASC
         LIMIT 10'
    );
    $stmt->execute([':u' => $userId]);
    $topSurahs = [];
    foreach ($stmt->fetchAll() as $r) {
        $surahNum = (int) $r['surah_number'];
        $topSurahs[] = [
            'surah_number' => $surahNum,
            'surah_name'   => $surahs[$surahNum]['ar'] ?? ('سورة ' . $surahNum),
            'count'        => (int) $r['freq'],
        ];
    }
} catch (PDOException $e) {
    error_log('[GetHistory Failed] ' . $e->getMessage());
    json_out(500, ['success' => false, 'error' => 'Server error. Please try again.']);
}

json_out(200, [
    'success' => true,
    'summary' => [
        'total'    => $active + $archived,
        'active'   => $active,
        'archived' => $archived,
    ],
    'history'      => $history,
    'weak_points'  => [
        'top_ayahs'  => $topAyahs,
        'top_surahs' => $topSurahs,
    ],
]);
