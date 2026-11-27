<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Prayer Recitation Companion (تلاوة الصلاة)
 * GET or POST JSON: length ('SHORT', 'MEDIUM', 'LONG'), force_new (bool)
 *
 * Full Coverage Cycle System (الدورة الشاملة لتلاوة الصلاة):
 * 1. Prioritizes passages marked as PENDING_RETRY from previous prayers.
 * 2. Traverses student's full memorized range without repeating mastered portions
 *    until 100% of the memorized verses have been touched across prayers.
 * 3. Selects portions with suitable beginnings (الابتداء الحسن): Surah starts,
 *    Quarter/Hizb starts, or smooth sequential continuation.
 * 4. Once all memorized verses are mastered, automatically advances to the next cycle.
 */

require __DIR__ . '/../../config/database.php';
require_once __DIR__ . '/../../config/auth.php';
require_once __DIR__ . '/_prayer_helpers.php';

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
// SHORT: 2-3 verses, MEDIUM: 5-6 verses, LONG: 7-10 verses
$targetVerseCounts = [
    'SHORT'  => [2, 3],
    'MEDIUM' => [5, 6],
    'LONG'   => [7, 8, 9, 10],
];
$possibleCounts = $targetVerseCounts[$lengthType];
$targetCount = $possibleCounts[array_rand($possibleCounts)];

try {
    // 1. Ensure table and columns exist
    require_once __DIR__ . '/../../config/migrate_v18.php';
    rh_migrate_v18($pdo);

    // If forcing new, delete any previous unprayed record (status = 'PRESENTED')
    if ($forceNew) {
        $cleanStmt = $pdo->prepare(
            "DELETE FROM `prayer_recitations` 
             WHERE `user_id` = :u AND `status` = 'PRESENTED'"
        );
        $cleanStmt->execute([':u' => $userId]);
    }

    // 2. Priority 1: Check for pending retry in priority queue (unless forcing new)
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

            // Load cycle progress stats
            $cycleNum = (int) ($retry['cycle_number'] ?? 1);
            $stats = rh_prayer_get_cycle_stats($pdo, $userId, $cycleNum);

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
                'cycle'          => $stats,
            ]);
        }
    }

    // 3. User memorized range
    $memData = rh_prayer_get_all_memorized_verses($pdo, $userId);
    $allMemorizedVerses = $memData['verses'];
    $memorizedKeySet = $memData['keySet'];
    $maxPage = $memData['maxPage'];
    $totalMemorizedCount = count($allMemorizedVerses);

    $totalMemorizedCount = count($allMemorizedVerses);

    // 5. Determine Current Prayer Cycle
    $cycleStmt = $pdo->prepare(
        "SELECT COALESCE(MAX(`cycle_number`), 1) FROM `prayer_recitations` WHERE `user_id` = :u"
    );
    $cycleStmt->execute([':u' => $userId]);
    $currentCycle = (int) ($cycleStmt->fetchColumn() ?: 1);

    // Load verses already mastered in this cycle
    $mStmt = $pdo->prepare(
        "SELECT `surah_number`, `start_ayah`, `end_ayah` 
         FROM `prayer_recitations` 
         WHERE `user_id` = :u AND `status` = 'MASTERED' AND `cycle_number` = :c"
    );
    $mStmt->execute([':u' => $userId, ':c' => $currentCycle]);
    $masteredRows = $mStmt->fetchAll();

    $masteredAyahKeys = [];
    foreach ($masteredRows as $mr) {
        $s = (int) $mr['surah_number'];
        $sa = (int) $mr['start_ayah'];
        $ea = (int) $mr['end_ayah'];
        for ($a = $sa; $a <= $ea; $a++) {
            $masteredAyahKeys["{$s}:{$a}"] = true;
        }
    }

    $masteredCount = 0;
    foreach ($allMemorizedVerses as $mv) {
        if (isset($masteredAyahKeys["{$mv['surah']}:{$mv['ayah']}"])) {
            $masteredCount++;
        }
    }

    // Check if the entire memorized range has been covered & mastered in this cycle
    $cycleJustCompleted = false;
    if ($masteredCount >= $totalMemorizedCount && $totalMemorizedCount > 0) {
        // Complete cycle achieved! Start fresh cycle!
        $currentCycle++;
        $masteredAyahKeys = [];
        $masteredCount = 0;
        $cycleJustCompleted = true;
    }

    // 6. Assemble Untouched Verses pool in current cycle
    $untouchedVerses = [];
    $untouchedKeySet = [];
    foreach ($allMemorizedVerses as $mv) {
        $k = "{$mv['surah']}:{$mv['ayah']}";
        if (!isset($masteredAyahKeys[$k])) {
            $untouchedVerses[] = $mv;
            $untouchedKeySet[$k] = true;
        }
    }

    // Safety fallback: if somehow untouched is empty, reset to all memorized verses
    if (empty($untouchedVerses)) {
        $untouchedVerses = $allMemorizedVerses;
        foreach ($allMemorizedVerses as $mv) {
            $untouchedKeySet["{$mv['surah']}:{$mv['ayah']}"] = true;
        }
    }

    // 7. Load quarter starts (بدايات الأرباع) for suitable beginnings
    $rubStartsFile = __DIR__ . '/../../api/data/rub_starts.json';
    $rubStartsMap = [];
    if (is_file($rubStartsFile)) {
        $decRub = json_decode(file_get_contents($rubStartsFile), true);
        if (is_array($decRub)) {
            foreach ($decRub as $ref) {
                $rubStartsMap[(string) $ref] = true;
            }
        }
    }

    // 8. Find Candidate Suitable Beginnings (الابتداء الحسن) among untouched verses
    $candidateStarts = [];

    // Check last recited verse for natural sequential continuity
    $lastStmt = $pdo->prepare(
        "SELECT `surah_number`, `end_ayah` FROM `prayer_recitations`
         WHERE `user_id` = :u AND `status` = 'MASTERED' AND `cycle_number` = :c
         ORDER BY `last_recited_at` DESC LIMIT 1"
    );
    $lastStmt->execute([':u' => $userId, ':c' => $currentCycle]);
    $lastMastered = $lastStmt->fetch();

    foreach ($untouchedVerses as $idx => $v) {
        $s = $v['surah'];
        $a = $v['ayah'];
        $k = "{$s}:{$a}";

        // A. Surah start: weight 10
        if ($a === 1) {
            $candidateStarts[] = ['surah' => $s, 'ayah' => $a, 'weight' => 10];
            continue;
        }

        // B. Quarter / Hizb start: weight 9
        if (isset($rubStartsMap[$k])) {
            $candidateStarts[] = ['surah' => $s, 'ayah' => $a, 'weight' => 9];
            continue;
        }

        // C. Direct sequential continuation after previous prayer: weight 8
        if ($lastMastered && (int) $lastMastered['surah_number'] === $s && (int) $lastMastered['end_ayah'] + 1 === $a) {
            $candidateStarts[] = ['surah' => $s, 'ayah' => $a, 'weight' => 8];
            continue;
        }

        // D. Beginning of a contiguous untouched run: weight 6
        $prevKey = "{$s}:" . ($a - 1);
        if (!isset($untouchedKeySet[$prevKey])) {
            $candidateStarts[] = ['surah' => $s, 'ayah' => $a, 'weight' => 6];
            continue;
        }
    }

    // If no weighted candidates found, any untouched verse is acceptable
    if (empty($candidateStarts)) {
        $candidateStarts[] = ['surah' => $untouchedVerses[0]['surah'], 'ayah' => $untouchedVerses[0]['ayah'], 'weight' => 5];
    }

    // Sort candidates by weight descending, shuffle within highest weight
    usort($candidateStarts, function ($a, $b) {
        return $b['weight'] <=> $a['weight'];
    });
    $maxWeight = $candidateStarts[0]['weight'];
    $topCandidates = array_values(array_filter($candidateStarts, function ($c) use ($maxWeight) {
        return $c['weight'] === $maxWeight;
    }));
    $chosenStart = $topCandidates[array_rand($topCandidates)];

    $selectedSurah = $chosenStart['surah'];
    $selectedStart = $chosenStart['ayah'];

    // 9. Determine portion end ayah (consecutive untouched verses in same surah)
    $availCount = 1;
    while ($availCount < $targetCount) {
        $nextAyah = $selectedStart + $availCount;
        $nextKey = "{$selectedSurah}:{$nextAyah}";
        if (!isset($untouchedKeySet[$nextKey])) {
            break;
        }
        $availCount++;
    }
    $selectedEnd = $selectedStart + $availCount - 1;

    $verses = rh_prayer_load_verses($selectedSurah, $selectedStart, $selectedEnd);
    $labels = rh_prayer_load_labels();

    // 10. Record presented recitation in prayer_recitations
    $ins = $pdo->prepare(
        "INSERT INTO `prayer_recitations`
            (`user_id`, `surah_number`, `start_ayah`, `end_ayah`, `length_type`, `cycle_number`, `status`, `attempts`)
         VALUES (:u, :s, :sa, :ea, :l, :c, 'PRESENTED', 1)"
    );
    $ins->execute([
        ':u'  => $userId,
        ':s'  => $selectedSurah,
        ':sa' => $selectedStart,
        ':ea' => $selectedEnd,
        ':l'  => $lengthType,
        ':c'  => $currentCycle,
    ]);
    $recitationId = (int) $pdo->lastInsertId();

    $cyclePercent = ($totalMemorizedCount > 0) ? min(100, (int) round(($masteredCount / $totalMemorizedCount) * 100)) : 0;
    $remainingVerses = max(0, $totalMemorizedCount - $masteredCount);

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
        'attempts'       => 0,
        'verses'         => $verses,
        'cycle'          => [
            'cycle_number'           => $currentCycle,
            'total_memorized_verses' => $totalMemorizedCount,
            'mastered_verses'        => $masteredCount,
            'remaining_verses'       => $remainingVerses,
            'percent'                => $cyclePercent,
            'cycle_completed'        => $cycleJustCompleted,
        ],
    ]);
} catch (Throwable $t) {
    error_log('[Prayer Recitation Error] ' . $t->getMessage());
    json_out(500, ['success' => false, 'error' => 'تعذر تجهيز تلاوة الصلاة: ' . $t->getMessage()]);
}


