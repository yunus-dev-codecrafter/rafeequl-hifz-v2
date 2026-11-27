<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Prayer Recitation Companion (تلاوة الصلاة)
 * GET or POST JSON: length ('SHORT', 'MEDIUM', 'LONG'), force_new (bool)
 *
 * Sourced from student's memorized range with suitable beginnings (الابتداء الحسن).
 * Prioritizes unmastered portions from previous prayers.
 */

require __DIR__ . '/../../config/database.php';
require_once __DIR__ . '/../../config/auth.php';

function json_out(int $code, array $payload): void
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

$authUser = rh_require_login($pdo);
$userId   = (int) $authUser['id'];

$raw = file_get_contents('php://input');
$input = $_GET;
if (is_string($raw) && $raw !== '') {
    $dec = json_decode($raw, true);
    if (is_array($dec)) {
        $input = array_merge($input, $dec);
    }
}

$lengthType = strtoupper((string) ($input['length'] ?? 'SHORT'));
if (!in_array($lengthType, ['SHORT', 'MEDIUM', 'LONG'], true)) {
    $lengthType = 'SHORT';
}
$forceNew = !empty($input['force_new']);

// Target verse counts:
// SHORT: 2-3 verses, MEDIUM: 5-6 verses, LONG: max 10 (7-10 verses)
$targetVerseCounts = [
    'SHORT'  => [2, 3],
    'MEDIUM' => [5, 6],
    'LONG'   => [7, 8, 9, 10],
];
$possibleCounts = $targetVerseCounts[$lengthType];
$targetCount = $possibleCounts[array_rand($possibleCounts)];

try {
    // 1. Ensure table exists
    require_once __DIR__ . '/../../config/migrate_v18.php';
    rh_migrate_v18($pdo);

    // 2. Check for pending retry in priority queue (if not forcing new)
    if (!$forceNew) {
        $stmt = $pdo->prepare(
            "SELECT * FROM `prayer_recitations`
             WHERE `user_id` = :u AND `status` = 'PENDING_RETRY'
             ORDER BY `last_recited_at` DESC LIMIT 1"
        );
        $stmt->execute([':u' => $userId]);
        $retry = $stmt->fetch();

        if ($retry) {
            $surah = (int) $retry['surah_number'];
            $sAyah = (int) $retry['start_ayah'];
            $eAyah = (int) $retry['end_ayah'];

            $verses = rh_prayer_load_verses($surah, $sAyah, $eAyah);
            $labels = rh_prayer_load_labels();

            json_out(200, [
                'success'        => true,
                'recitation_id'  => (int) $retry['id'],
                'surah_number'   => $surah,
                'surah_name_ar'  => $labels['surahs'][$surah]['ar'] ?? ('سورة ' . $surah),
                'surah_name_en'  => $labels['surahs'][$surah]['en'] ?? ('Surah ' . $surah),
                'start_ayah'     => $sAyah,
                'end_ayah'       => $eAyah,
                'ayah_count'     => count($verses),
                'length_type'    => (string) $retry['length_type'],
                'is_retry'       => true,
                'attempts'       => (int) $retry['attempts'],
                'verses'         => $verses,
            ]);
        }
    }

    // 3. User memorized range
    $uStmt = $pdo->prepare('SELECT `user_type`, `current_hifz_page` FROM `users` WHERE `id` = :id');
    $uStmt->execute([':id' => $userId]);
    $userRow = $uStmt->fetch();

    $utype = (string) ($userRow['user_type'] ?? 'NEW');
    $maxPage = ($utype === 'COMPLETE') ? 604 : max(1, (int) ($userRow['current_hifz_page'] ?? 1));

    // 4. Load page-to-verses mapping
    $pageMapFile = __DIR__ . '/../../web/js/madinah_page_verses.json';
    if (!is_file($pageMapFile)) {
        json_out(500, ['success' => false, 'error' => 'Madinah page verses map not found.']);
    }
    $pageMap = json_decode(file_get_contents($pageMapFile), true);
    if (!is_array($pageMap)) {
        json_out(500, ['success' => false, 'error' => 'Invalid page verses map format.']);
    }

    // Build list of memorized Surah sections: [surah => [minAyah, maxAyah]]
    $memorizedSections = [];
    $cappedPage = min($maxPage, count($pageMap));
    for ($p = 0; $p < $cappedPage; $p++) {
        $sections = $pageMap[$p];
        if (!is_array($sections)) continue;
        foreach ($sections as $sec) {
            $s = (int) $sec[0];
            $startA = (int) $sec[1];
            $endA = (int) $sec[2];
            if (!isset($memorizedSections[$s])) {
                $memorizedSections[$s] = ['min' => $startA, 'max' => $endA];
            } else {
                $memorizedSections[$s]['min'] = min($memorizedSections[$s]['min'], $startA);
                $memorizedSections[$s]['max'] = max($memorizedSections[$s]['max'], $endA);
            }
        }
    }

    if (empty($memorizedSections)) {
        $memorizedSections[1] = ['min' => 1, 'max' => 7];
    }

    // 5. Load quarter starts (بدايات الأرباع) for suitable beginnings
    $rubStartsFile = __DIR__ . '/../../api/data/rub_starts.json';
    $rubStarts = [];
    if (is_file($rubStartsFile)) {
        $decRub = json_decode(file_get_contents($rubStartsFile), true);
        if (is_array($decRub)) {
            foreach ($decRub as $ref) {
                $parts = explode(':', (string) $ref);
                if (count($parts) === 2) {
                    $rubStarts[] = [(int) $parts[0], (int) $parts[1]];
                }
            }
        }
    }

    // 6. Assemble suitable beginning candidates within memorized range
    // A suitable beginning is:
    // - Ayah 1 of any memorized surah
    // - Any Quarter/Hizb start inside memorized range
    $candidates = [];

    foreach ($memorizedSections as $s => $bounds) {
        // Surah start
        if ($bounds['min'] === 1) {
            $candidates[] = [$s, 1];
        }
    }

    foreach ($rubStarts as $r) {
        $s = $r[0];
        $a = $r[1];
        if (isset($memorizedSections[$s])) {
            if ($a >= $memorizedSections[$s]['min'] && $a <= $memorizedSections[$s]['max']) {
                $candidates[] = [$s, $a];
            }
        }
    }

    // Fallback if very few candidates (e.g. beginner student with only 1 page):
    if (count($candidates) < 3) {
        foreach ($memorizedSections as $s => $bounds) {
            for ($a = $bounds['min']; $a <= $bounds['max']; $a++) {
                $candidates[] = [$s, $a];
            }
        }
    }

    // Pick a candidate start
    shuffle($candidates);
    $selectedSurah = 1;
    $selectedStart = 1;
    $selectedEnd   = 7;

    $uthmaniFile = __DIR__ . '/../../web/data/quran-uthmani.json';
    $quranText = json_decode(file_get_contents($uthmaniFile), true);

    foreach ($candidates as $cand) {
        $s = $cand[0];
        $startA = $cand[1];
        $maxA = $memorizedSections[$s]['max'];
        $surahTotalAyahs = isset($quranText[(string) $s]) ? count($quranText[(string) $s]) : $maxA;
        $effectiveMax = min($maxA, $surahTotalAyahs);

        $avail = $effectiveMax - $startA + 1;
        if ($avail >= 2) {
            $selectedSurah = $s;
            $selectedStart = $startA;
            $portionCount = min($targetCount, $avail);
            $selectedEnd = $selectedStart + $portionCount - 1;
            break;
        }
    }

    $verses = rh_prayer_load_verses($selectedSurah, $selectedStart, $selectedEnd);
    $labels = rh_prayer_load_labels();

    // 7. Save pending prayer recitation record
    $ins = $pdo->prepare(
        "INSERT INTO `prayer_recitations`
            (`user_id`, `surah_number`, `start_ayah`, `end_ayah`, `length_type`, `status`, `attempts`)
         VALUES (:u, :s, :sa, :ea, :l, 'PENDING_RETRY', 1)"
    );
    $ins->execute([
        ':u'  => $userId,
        ':s'  => $selectedSurah,
        ':sa' => $selectedStart,
        ':ea' => $selectedEnd,
        ':l'  => $lengthType,
    ]);
    $recitationId = (int) $pdo->lastInsertId();

    json_out(200, [
        'success'        => true,
        'recitation_id'  => $recitationId,
        'surah_number'   => $selectedSurah,
        'surah_name_ar'  => $labels['surahs'][$selectedSurah]['ar'] ?? ('سورة ' . $selectedSurah),
        'surah_name_en'  => $labels['surahs'][$selectedSurah]['en'] ?? ('Surah ' . $selectedSurah),
        'start_ayah'     => $selectedStart,
        'end_ayah'       => $selectedEnd,
        'ayah_count'     => count($verses),
        'length_type'    => $lengthType,
        'is_retry'       => false,
        'attempts'       => 1,
        'verses'         => $verses,
    ]);
} catch (Throwable $t) {
    error_log('[Prayer Recitation Error] ' . $t->getMessage());
    json_out(500, ['success' => false, 'error' => 'تعذر تجهيز تلاوة الصلاة: ' . $t->getMessage()]);
}

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
