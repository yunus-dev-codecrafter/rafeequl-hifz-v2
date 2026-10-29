<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Flashcard Deck Builder (Task 4: المعالجة)
 *
 * GET/POST: user_id, mistake_type, surah_number, juz_number, page_number,
 *           limit, shuffle, mode (legacy: 'due' and 'all' now behave the same)
 *
 * The deck is every ACTIVE mistake. Each card carries its 40-practice counter
 * (`practice_count` / `practice_target`); a card leaves the deck when the
 * counter reaches the target.
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

function read_int($value, int $default = 0): int
{
    if (is_string($value) && ctype_digit($value)) {
        return (int) $value;
    }
    return is_int($value) ? $value : $default;
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

$mode         = ($input['mode'] ?? 'all') === 'due' ? 'due' : 'all';
$filterType   = $input['mistake_type'] ?? null;
if (is_string($filterType)) {
    $legacyTypes = ['TAWAQQUF' => 'AYAH_MISTAKE', 'TASHKEEL' => 'AYAH_MISTAKE', 'LAFDH' => 'AYAH_MISTAKE'];
    if (isset($legacyTypes[$filterType])) {
        $filterType = $legacyTypes[$filterType];
    }
}
$filterSurah  = read_int($input['surah_number'] ?? null, 0);
$filterJuz    = read_int($input['juz_number'] ?? null, 0);
$filterPage   = read_int($input['page_number'] ?? null, 0);
$limit        = read_int($input['limit'] ?? null, 0);
$shuffle      = (string) ($input['shuffle'] ?? '0') === '1';

try {
    // ---- Global counters (unfiltered) -------------------------------------
    $stmt = $pdo->prepare(
        "SELECT
            SUM(CASE WHEN `status` = 'ACTIVE' THEN 1 ELSE 0 END) AS active,
            SUM(CASE WHEN `status` = 'ACTIVE' AND `practice_count` < `practice_target` THEN 1 ELSE 0 END) AS remaining_cards,
            SUM(CASE WHEN `status` = 'ACTIVE' AND `practice_count` = 0 THEN 1 ELSE 0 END) AS new_cards,
            SUM(CASE WHEN `status` = 'ACTIVE' THEN GREATEST(`practice_target` - `practice_count`, 0) ELSE 0 END) AS remaining_reps,
            SUM(CASE WHEN `status` = 'ARCHIVED' THEN 1 ELSE 0 END) AS completed
         FROM `mistakes` WHERE `user_id` = :u"
    );
    $stmt->execute([':u' => $userId]);
    $c = $stmt->fetch() ?: [];
    $totalActive     = (int) ($c['active'] ?? 0);
    $remainingCards  = (int) ($c['remaining_cards'] ?? 0);
    $newCount        = (int) ($c['new_cards'] ?? 0);
    $remainingReps   = (int) ($c['remaining_reps'] ?? 0);
    $completedCount  = (int) ($c['completed'] ?? 0);
    $dueCount        = $totalActive; // legacy alias: every active card is available

    // ---- Deck query -------------------------------------------------------
    $where  = ["m.`user_id` = :u", "m.`status` = 'ACTIVE'"];
    $params = [':u' => $userId];

    if (is_string($filterType) && $filterType !== '') {
        $where[] = 'm.`mistake_type` = :ft';
        $params[':ft'] = $filterType;
    }
    if ($filterSurah > 0 && $filterSurah <= 114) {
        $where[] = 'm.`surah_number` = :fs';
        $params[':fs'] = $filterSurah;
    }
    if ($filterPage > 0 && $filterPage <= 604) {
        $where[] = 'm.`page_number` = :fp';
        $params[':fp'] = $filterPage;
    }
    if ($filterJuz > 0 && $filterJuz <= 30) {
        $where[] = 'p.`juz_number` = :fj';
        $params[':fj'] = $filterJuz;
    }

    $sql = 'SELECT m.`id`, m.`page_number`, m.`surah_number`, m.`ayah_number`,
                   m.`mistake_type`, m.`notes`, m.`severity`,
                   m.`confused_with_surah`, m.`confused_with_ayah`, m.`source_task`,
                   m.`status`, m.`practice_count`, m.`practice_target`,
                   m.`mastery_count`, m.`occurrence_count`,
                   m.`interval_days`, m.`ease`, m.`lapses`, m.`streak_correct`,
                   m.`due_at`, m.`last_reviewed_at`, m.`graduated_at`, m.`created_at`,
                   p.`juz_number`, p.`hizb_number`, p.`rub_el_hizb`
            FROM `mistakes` m
            LEFT JOIN `madinah_pages_meta` p ON p.`page_number` = m.`page_number`
            WHERE ' . implode(' AND ', $where) . '
            ORDER BY m.`occurrence_count` DESC, m.`practice_count` ASC, m.`id` ASC';

    if ($limit > 0) {
        $sql .= ' LIMIT ' . (int) $limit;
    }

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    if ($shuffle) {
        shuffle($rows);
    }

    $cards = [];
    foreach ($rows as $row) {
        $surahNum  = (int) $row['surah_number'];
        $type      = (string) $row['mistake_type'];
        $surahName = $surahs[$surahNum]['ar'] ?? ('سورة ' . $surahNum);
        $practiceCount  = (int) $row['practice_count'];
        $practiceTarget = (int) $row['practice_target'];
        $remaining      = max(0, $practiceTarget - $practiceCount);

        $confusedSurah = $row['confused_with_surah'] !== null ? (int) $row['confused_with_surah'] : null;

        $cards[] = [
            'mistake_id' => (int) $row['id'],
            'front' => [
                'surah_number'   => $surahNum,
                'surah_name'     => $surahName,
                'surah_name_en'  => $surahs[$surahNum]['en'] ?? null,
                'page_number'    => (int) $row['page_number'],
                'ayah_number'    => (int) $row['ayah_number'],
                'mistake_type'   => $type,
                'mistake_label'  => $mTypes[$type]['ar'] ?? $type,
                'severity'       => (int) $row['severity'],
                'juz_number'     => $row['juz_number'] !== null ? (int) $row['juz_number'] : null,
                'hizb_number'    => $row['hizb_number'] !== null ? (int) $row['hizb_number'] : null,
                'rub_el_hizb'    => $row['rub_el_hizb'] !== null ? (int) $row['rub_el_hizb'] : null,
                'confused_with_surah' => $confusedSurah,
                'confused_with_surah_name' => $confusedSurah !== null
                    ? ($surahs[$confusedSurah]['ar'] ?? null) : null,
                'confused_with_ayah'  => $row['confused_with_ayah'] !== null ? (int) $row['confused_with_ayah'] : null,
                'source_task'    => $row['source_task'],
            ],
            'back' => [
                'notes'          => $row['notes'],
                'practice_count' => $practiceCount,
                'practice_target' => $practiceTarget,
                'remaining'      => $remaining,
                'progress_percent' => $practiceTarget > 0
                    ? (int) round(($practiceCount / $practiceTarget) * 100) : 0,
                'mastery_count'  => (int) $row['mastery_count'],
                'occurrence_count' => (int) $row['occurrence_count'],
                'interval_days'  => (int) $row['interval_days'],
                'lapses'         => (int) $row['lapses'],
                'streak_correct' => (int) $row['streak_correct'],
                'is_new'         => $practiceCount === 0,
                'due_at'         => $row['due_at'],
                'last_reviewed_at' => $row['last_reviewed_at'],
                'logged_at'      => $row['created_at'],
            ],
        ];
    }

    json_out(200, [
        'success'      => true,
        'mode'         => $mode,
        'count'        => count($cards),
        'due_count'    => $dueCount,
        'new_count'    => $newCount,
        'total_active' => $totalActive,
        'remaining_cards' => $remainingCards,
        'remaining_reps'  => $remainingReps,
        'completed_count' => $completedCount,
        'cards'        => $cards,
    ]);
} catch (PDOException $e) {
    error_log('[GetFlashcards Failed] ' . $e->getMessage());
    json_out(500, ['success' => false, 'error' => 'Server error. Please try again.']);
}
