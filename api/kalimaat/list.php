<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Browse kalimaat cards with the user's progress.
 * GET: juz=1..30, page=1..604, status=NEW|LOCKED|READY|MASTERED, q=...
 */

require __DIR__ . '/../../config/database.php';
require_once __DIR__ . '/../../config/auth.php';
require_once __DIR__ . '/_catalog.php';

try {
    $input = kal_read_input();
    $authUser = rh_require_login($pdo);
    $userId = (int) $authUser['id'];
    $zone = kal_zone($pdo, $userId);

    $meta = kal_meta();
    $pageJuz = is_array($meta['page_juz'] ?? null) ? $meta['page_juz'] : [];
    $pageCounts = is_array($meta['page_counts'] ?? null) ? $meta['page_counts'] : [];

    $page = (int) ($input['page'] ?? 0);
    $juz = (int) ($input['juz'] ?? 0);
    if ($page >= 1 && $page <= 604 && $juz < 1) {
        $juz = (int) ($pageJuz[(string) $page] ?? 0);
    }
    if ($juz < 1 || $juz > 30) {
        $juz = (int) ($pageJuz[(string) max(1, (int) $zone['end'])] ?? 1);
    }

    $candidates = $juz >= 1 ? kal_juz_words($juz) : [];
    if ($page >= 1) {
        $candidates = array_values(array_filter($candidates, static function (array $w) use ($page): bool {
            return (int) ($w['page'] ?? 0) === $page;
        }));
    }

    $statusFilter = strtoupper(trim((string) ($input['status'] ?? '')));
    if (!in_array($statusFilter, ['NEW', 'LOCKED', 'READY', 'MASTERED'], true)) {
        $statusFilter = '';
    }
    $query = trim((string) ($input['q'] ?? ''));
    $progress = kal_progress_map($pdo, $userId);

    $words = [];
    $pages = [];
    foreach ($candidates as $word) {
        $p = (int) ($word['page'] ?? 0);
        if ($p < (int) $zone['start'] || $p > (int) $zone['end']) continue;

        $row = $progress[(string) $word['key']] ?? null;
        $status = $row ? (string) $row['status'] : 'NEW';
        if ($statusFilter !== '' && $status !== $statusFilter) continue;

        if ($query !== '') {
            $hay = (string) ($word['text'] ?? '') . ' ' . (string) ($word['meaning'] ?? '');
            if (mb_stripos($hay, $query) === false) continue;
        }

        $words[] = kal_word_payload($word, $row);
        $pages[(string) $p] = (int) ($pageCounts[(string) $p] ?? 0);
    }

    usort($words, static function (array $a, array $b): int {
        return [$a['page_number'], $a['surah_number'], $a['ayah_number'], $a['text']]
            <=> [$b['page_number'], $b['surah_number'], $b['ayah_number'], $b['text']];
    });

    kal_json_out(200, [
        'success' => true,
        'zone' => $zone,
        'juz' => $juz,
        'page' => $page > 0 ? $page : null,
        'status' => $statusFilter,
        'query' => $query,
        'count' => count($words),
        'pages' => $pages,
        'words' => $words,
        'stats' => kal_user_stats($pdo, $userId),
        'locked' => ($locked = kal_locked_row($pdo, $userId)) ? kal_word_payload([], $locked) : null,
    ]);
} catch (Throwable $e) {
    error_log('[Kalimaat list] ' . $e->getMessage());
    kal_json_out(500, ['success' => false, 'error' => 'Server error. Please try again.']);
}
