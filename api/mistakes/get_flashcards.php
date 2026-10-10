<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Active Flashcard Queue (Task 4: المعالجة)
 * Fetches all ACTIVE mistakes as flashcard objects:
 *   front -> Surah name, page, ayah, mistake tag label (page context from meta)
 *   back  -> notes/hints recorded during recitation
 */

require __DIR__ . '/../../config/database.php';
$labels = require __DIR__ . '/../data/labels.php';

$surahs  = $labels['surahs'];
$mTypes  = $labels['mistake_types'];

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
// Fetch active mistakes -> flashcards
// ---------------------------------------------------------------------------

try {
    $stmt = $pdo->prepare(
        'SELECT m.`id`, m.`page_number`, m.`surah_number`, m.`ayah_number`,
                m.`mistake_type`, m.`notes`, m.`mastery_count`, m.`created_at`,
                p.`juz_number`, p.`hizb_number`, p.`rub_el_hizb`
         FROM `mistakes` m
         LEFT JOIN `madinah_pages_meta` p ON p.`page_number` = m.`page_number`
         WHERE m.`user_id` = :u AND m.`status` = \'ACTIVE\'
         ORDER BY m.`created_at` ASC, m.`id` ASC'
    );
    $stmt->execute([':u' => $userId]);
    $rows = $stmt->fetchAll();
} catch (PDOException $e) {
    error_log('[GetFlashcards Failed] ' . $e->getMessage());
    json_out(500, ['success' => false, 'error' => 'Server error. Please try again.']);
}

$cards = [];
foreach ($rows as $row) {
    $surahNum  = (int) $row['surah_number'];
    $type      = (string) $row['mistake_type'];
    $surahName = $surahs[$surahNum]['ar'] ?? ('سورة ' . $surahNum);

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
            'juz_number'     => $row['juz_number'] !== null ? (int) $row['juz_number'] : null,
            'hizb_number'    => $row['hizb_number'] !== null ? (int) $row['hizb_number'] : null,
            'rub_el_hizb'    => $row['rub_el_hizb'] !== null ? (int) $row['rub_el_hizb'] : null,
        ],
        'back' => [
            'notes'         => $row['notes'],
            'mastery_count' => (int) $row['mastery_count'],
            'logged_at'     => $row['created_at'],
        ],
    ];
}

json_out(200, [
    'success' => true,
    'count'   => count($cards),
    'cards'   => $cards,
]);
