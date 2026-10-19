<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Mistake History & Weak-Point Analytics
 * - history:      full log (ACTIVE + ARCHIVED), newest first, SRS-aware
 * - weak_points:  top recurring weak Ayahs and Surahs (weighted by recurrence)
 * - analytics:    type distribution, per-juz heatmap, due summary, review streak
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

require_once __DIR__ . '/../../config/auth.php';

// Session is authoritative. A client-supplied user_id is accepted only from an
// administrator (so the admin panel can act on other accounts).
$authUser = rh_require_login($pdo);
$userId   = rh_resolve_user_id($pdo, $authUser, $input['user_id'] ?? null);

$surahName = static function (int $n) use ($surahs): string {
    return $surahs[$n]['ar'] ?? ('سورة ' . $n);
};

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
        if ($r['status'] === 'ACTIVE')        { $active = (int) $r['cnt']; }
        elseif ($r['status'] === 'ARCHIVED')  { $archived = (int) $r['cnt']; }
    }

    // Full history, newest first
    $stmt = $pdo->prepare(
        'SELECT `id`, `page_number`, `surah_number`, `ayah_number`, `mistake_type`,
                `notes`, `severity`, `confused_with_surah`, `confused_with_ayah`,
                `source_task`, `status`, `mastery_count`, `occurrence_count`,
                `interval_days`, `lapses`, `streak_correct`, `due_at`,
                `last_reviewed_at`, `graduated_at`, `created_at`
         FROM `mistakes`
         WHERE `user_id` = :u
         ORDER BY `created_at` DESC, `id` DESC'
    );
    $stmt->execute([':u' => $userId]);
    $history = [];
    foreach ($stmt->fetchAll() as $row) {
        $surahNum = (int) $row['surah_number'];
        $type     = (string) $row['mistake_type'];
        $cs       = $row['confused_with_surah'] !== null ? (int) $row['confused_with_surah'] : null;
        $history[] = [
            'id'             => (int) $row['id'],
            'page_number'    => (int) $row['page_number'],
            'surah_number'   => $surahNum,
            'surah_name'     => $surahName($surahNum),
            'ayah_number'    => (int) $row['ayah_number'],
            'mistake_type'   => $type,
            'mistake_label'  => $mTypes[$type]['ar'] ?? $type,
            'notes'          => $row['notes'],
            'severity'       => (int) $row['severity'],
            'confused_with_surah' => $cs,
            'confused_with_surah_name' => $cs !== null ? $surahName($cs) : null,
            'confused_with_ayah'  => $row['confused_with_ayah'] !== null ? (int) $row['confused_with_ayah'] : null,
            'source_task'    => $row['source_task'],
            'status'         => $row['status'],
            'mastery_count'  => (int) $row['mastery_count'],
            'occurrence_count' => (int) $row['occurrence_count'],
            'interval_days'  => (int) $row['interval_days'],
            'lapses'         => (int) $row['lapses'],
            'streak_correct' => (int) $row['streak_correct'],
            'due_at'         => $row['due_at'],
            'last_reviewed_at' => $row['last_reviewed_at'],
            'graduated_at'   => $row['graduated_at'],
            'created_at'     => $row['created_at'],
        ];
    }

    // Top recurring weak Ayahs (weighted by recurrence, not raw row count)
    $stmt = $pdo->prepare(
        'SELECT `surah_number`, `ayah_number`, SUM(`occurrence_count`) AS `freq`, COUNT(*) AS `cards`
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
            'surah_name'   => $surahName($surahNum),
            'ayah_number'  => (int) $r['ayah_number'],
            'count'        => (int) $r['freq'],
            'cards'        => (int) $r['cards'],
        ];
    }

    // Top recurring weak Surahs (weighted by recurrence)
    $stmt = $pdo->prepare(
        'SELECT `surah_number`, SUM(`occurrence_count`) AS `freq`
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
            'surah_name'   => $surahName($surahNum),
            'count'        => (int) $r['freq'],
        ];
    }

    // Error type distribution (weighted)
    $stmt = $pdo->prepare(
        'SELECT `mistake_type`, SUM(`occurrence_count`) AS `freq`, COUNT(*) AS `cards`
         FROM `mistakes` WHERE `user_id` = :u GROUP BY `mistake_type`'
    );
    $stmt->execute([':u' => $userId]);
    $typeDistribution = [];
    foreach ($stmt->fetchAll() as $r) {
        $t = (string) $r['mistake_type'];
        $typeDistribution[] = [
            'mistake_type'  => $t,
            'label'         => $mTypes[$t]['ar'] ?? $t,
            'count'         => (int) $r['freq'],
            'cards'         => (int) $r['cards'],
        ];
    }
    usort($typeDistribution, static fn($a, $b) => $b['count'] <=> $a['count']);

    // Per-juz weakness heatmap (active cards, weighted)
    $stmt = $pdo->prepare(
        "SELECT p.`juz_number`, SUM(m.`occurrence_count`) AS `freq`
         FROM `mistakes` m
         JOIN `madinah_pages_meta` p ON p.`page_number` = m.`page_number`
         WHERE m.`user_id` = :u AND m.`status` = 'ACTIVE'
         GROUP BY p.`juz_number`"
    );
    $stmt->execute([':u' => $userId]);
    $freqByJuz = [];
    foreach ($stmt->fetchAll() as $r) {
        $freqByJuz[(int) $r['juz_number']] = (int) $r['freq'];
    }
    $juzHeatmap = [];
    for ($j = 1; $j <= 30; $j++) {
        $juzHeatmap[] = ['juz_number' => $j, 'count' => $freqByJuz[$j] ?? 0];
    }

    // Due summary
    $stmt = $pdo->prepare(
        "SELECT
            SUM(CASE WHEN `due_at` IS NULL OR `due_at` <= NOW() THEN 1 ELSE 0 END) AS due_now,
            SUM(CASE WHEN `last_reviewed_at` IS NULL THEN 1 ELSE 0 END) AS new_cards
         FROM `mistakes` WHERE `user_id` = :u AND `status` = 'ACTIVE'"
    );
    $stmt->execute([':u' => $userId]);
    $d = $stmt->fetch() ?: ['due_now' => 0, 'new_cards' => 0];
    $dueSummary = [
        'due_now'   => (int) ($d['due_now'] ?? 0),
        'new_cards' => (int) ($d['new_cards'] ?? 0),
        'total'     => $active,
    ];

    // Review streak (consecutive days with at least one review), ending today/yesterday
    $stmt = $pdo->prepare(
        "SELECT DISTINCT DATE(`created_at`) AS `d`
         FROM `mistake_events`
         WHERE `user_id` = :u AND `event_type` IN ('AGAIN','HARD','GOOD','EASY','MASTERED')
         ORDER BY `d` DESC LIMIT 400"
    );
    $stmt->execute([':u' => $userId]);
    $days = array_map(static fn($r) => (string) $r['d'], $stmt->fetchAll());
    $streak = 0;
    if ($days) {
        $today     = new DateTime('today');
        $yesterday = (new DateTime('today'))->modify('-1 day');
        $cursor    = new DateTime($days[0]);
        // Streak only counts if it is current (today or yesterday).
        if ($cursor == $today || $cursor == $yesterday) {
            $expected = $cursor;
            foreach ($days as $day) {
                $cur = new DateTime($day);
                if ($cur == $expected) {
                    $streak++;
                    $expected = (clone $cur)->modify('-1 day');
                } else {
                    break;
                }
            }
        }
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
    'analytics' => [
        'type_distribution' => $typeDistribution,
        'juz_heatmap'       => $juzHeatmap,
        'due_summary'       => $dueSummary,
        'streak'            => $streak,
    ],
]);
