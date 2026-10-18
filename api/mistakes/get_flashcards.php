<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Flashcard Deck Builder (Task 4: المعالجة)
 *
 * GET/POST: user_id, mode ('due'|'all'), mistake_type, surah_number,
 *           juz_number, page_number, limit, shuffle
 *
 * `due` (default) returns only cards whose schedule is due (plus brand-new
 * cards). `all` returns the whole active deck. Every card carries the full
 * SRS state so the practice engine can show intervals and history.
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

$mode         = ($input['mode'] ?? 'due') === 'all' ? 'all' : 'due';
$filterType   = $input['mistake_type'] ?? null;
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
            SUM(CASE WHEN `status` = 'ACTIVE' AND (`due_at` IS NULL OR `due_at` <= NOW()) THEN 1 ELSE 0 END) AS due,
            SUM(CASE WHEN `status` = 'ACTIVE' AND `last_reviewed_at` IS NULL THEN 1 ELSE 0 END) AS new_cards
         FROM `mistakes` WHERE `user_id` = :u"
    );
    $stmt->execute([':u' => $userId]);
    $c = $stmt->fetch() ?: ['active' => 0, 'due' => 0, 'new_cards' => 0];
    $dueCount   = (int) ($c['due'] ?? 0);
    $newCount   = (int) ($c['new_cards'] ?? 0);
    $totalActive = (int) ($c['active'] ?? 0);

    // ---- Deck query -------------------------------------------------------
    $where  = ["m.`user_id` = :u", "m.`status` = 'ACTIVE'"];
    $params = [':u' => $userId];

    if ($mode === 'due') {
        $where[] = '(m.`due_at` IS NULL OR m.`due_at` <= NOW())';
    }
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
                   m.`status`, m.`mastery_count`, m.`occurrence_count`,
                   m.`interval_days`, m.`ease`, m.`lapses`, m.`streak_correct`,
                   m.`due_at`, m.`last_reviewed_at`, m.`graduated_at`, m.`created_at`,
                   p.`juz_number`, p.`hizb_number`, p.`rub_el_hizb`
            FROM `mistakes` m
            LEFT JOIN `madinah_pages_meta` p ON p.`page_number` = m.`page_number`
            WHERE ' . implode(' AND ', $where) . '
            ORDER BY (m.`due_at` IS NULL) ASC, m.`due_at` ASC,
                     m.`occurrence_count` DESC, m.`id` ASC';

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
                'mastery_count'  => (int) $row['mastery_count'],
                'occurrence_count' => (int) $row['occurrence_count'],
                'interval_days'  => (int) $row['interval_days'],
                'lapses'         => (int) $row['lapses'],
                'streak_correct' => (int) $row['streak_correct'],
                'is_new'         => $row['last_reviewed_at'] === null,
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
        'cards'        => $cards,
    ]);
} catch (PDOException $e) {
    error_log('[GetFlashcards Failed] ' . $e->getMessage());
    json_out(500, ['success' => false, 'error' => 'Server error. Please try again.']);
}
