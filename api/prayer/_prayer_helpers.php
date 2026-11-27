<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Shared Prayer Recitation Helpers
 */

/**
 * Load Uthmani verse texts for [startAyah..endAyah] in surah.
 * @return array<array{surah:int, ayah:int, text:string}>
 */
function rh_prayer_load_verses(int $surah, int $startAyah, int $endAyah): array
{
    static $quran = null;
    if ($quran === null) {
        $file = __DIR__ . '/../../web/data/quran-uthmani.json';
        $quran = json_decode(file_get_contents($file), true) ?: [];
    }

    $out = [];
    $surahList = $quran[(string) $surah] ?? [];
    for ($a = $startAyah; $a <= $endAyah; $a++) {
        $text = $surahList[$a - 1] ?? '';
        $out[] = [
            'surah' => $surah,
            'ayah'  => $a,
            'text'  => $text,
        ];
    }
    return $out;
}

/**
 * Load Arabic & English surah names.
 */
function rh_prayer_load_labels(): array
{
    static $labels = null;
    if ($labels === null) {
        require __DIR__ . '/../../api/data/labels.php';
    }
    return $labels;
}

/**
 * Build ordered list of all memorized verses for a user.
 * @return array{verses: array<array{surah:int, ayah:int, page:int}>, keySet: array<string,bool>, maxPage: int}
 */
function rh_prayer_get_all_memorized_verses(PDO $pdo, int $userId): array
{
    $uStmt = $pdo->prepare('SELECT `user_type`, `current_hifz_page` FROM `users` WHERE `id` = :id');
    $uStmt->execute([':id' => $userId]);
    $userRow = $uStmt->fetch();

    $utype = (string) ($userRow['user_type'] ?? 'NEW');
    $maxPage = ($utype === 'COMPLETE') ? 604 : max(1, (int) ($userRow['current_hifz_page'] ?? 1));

    $pageMapFile = __DIR__ . '/../../web/js/madinah_page_verses.json';
    $pageMap = is_file($pageMapFile) ? json_decode(file_get_contents($pageMapFile), true) : [];
    if (!is_array($pageMap)) $pageMap = [];

    $allVerses = [];
    $keySet = [];
    $cappedPage = min($maxPage, count($pageMap));

    for ($p = 0; $p < $cappedPage; $p++) {
        $sections = $pageMap[$p];
        if (!is_array($sections)) continue;
        $pageNumber = $p + 1;
        foreach ($sections as $sec) {
            $s = (int) $sec[0];
            $startA = (int) $sec[1];
            $endA = (int) $sec[2];
            for ($a = $startA; $a <= $endA; $a++) {
                $k = "{$s}:{$a}";
                if (!isset($keySet[$k])) {
                    $keySet[$k] = true;
                    $allVerses[] = [
                        'surah' => $s,
                        'ayah'  => $a,
                        'page'  => $pageNumber,
                    ];
                }
            }
        }
    }

    if (empty($allVerses)) {
        for ($a = 1; $a <= 7; $a++) {
            $allVerses[] = ['surah' => 1, 'ayah' => $a, 'page' => 1];
            $keySet["1:{$a}"] = true;
        }
    }

    return [
        'verses'  => $allVerses,
        'keySet'  => $keySet,
        'maxPage' => $maxPage,
    ];
}

/**
 * Compute cycle statistics for a user and cycle.
 */
function rh_prayer_get_cycle_stats(PDO $pdo, int $userId, int $cycleNumber): array
{
    $mem = rh_prayer_get_all_memorized_verses($pdo, $userId);
    $totalVerses = count($mem['verses']);
    $memorizedKeySet = $mem['keySet'];

    $mStmt = $pdo->prepare(
        "SELECT `surah_number`, `start_ayah`, `end_ayah` 
         FROM `prayer_recitations` 
         WHERE `user_id` = :u AND `status` = 'MASTERED' AND `cycle_number` = :c"
    );
    $mStmt->execute([':u' => $userId, ':c' => $cycleNumber]);
    $rows = $mStmt->fetchAll();

    $masteredKeys = [];
    foreach ($rows as $r) {
        $s = (int) $r['surah_number'];
        $sa = (int) $r['start_ayah'];
        $ea = (int) $r['end_ayah'];
        for ($a = $sa; $a <= $ea; $a++) {
            $k = "{$s}:{$a}";
            if (isset($memorizedKeySet[$k])) {
                $masteredKeys[$k] = true;
            }
        }
    }
    $masteredCount = count($masteredKeys);
    $percent = ($totalVerses > 0) ? min(100, (int) round(($masteredCount / $totalVerses) * 100)) : 0;

    return [
        'cycle_number'           => $cycleNumber,
        'total_memorized_verses' => $totalVerses,
        'mastered_verses'        => $masteredCount,
        'remaining_verses'       => max(0, $totalVerses - $masteredCount),
        'percent'                => $percent,
        'cycle_completed'        => ($masteredCount >= $totalVerses && $totalVerses > 0),
    ];
}
