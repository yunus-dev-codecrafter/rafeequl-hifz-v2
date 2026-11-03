<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz — Rub' Consolidation session helpers (RUB_TAMKIN v12).
 *
 * The legacy word-arrangement board (api/tasks/get_rub_verses.php +
 * update_rub.php) is kept for the "Free Practice" tab. This file powers the
 * structured five-exercise session:
 *
 *   WORD_ORDER       ترتيب الكلمات
 *   MISSING_WORDS    أكمل الآية
 *   CONTINUE_AYAH    أكمل من حيث انتهى
 *   MUTASHABIHAT     المتشابهات
 *   PROGRESSIVE_HIDE التدرج في الحفظ
 *
 * Everything is generated server-side so that:
 *   - every item belongs to the selected rub';
 *   - the mutashabihat exercise only uses the curated CC0 list;
 *   - the rub' boundary is handled once, explicitly;
 *   - the plan can be verified for all 240 rub's from the CLI.
 */

require_once __DIR__ . '/_rub.php';

/* -------------------------------------------------------------------------
 * Exercise catalog
 * ---------------------------------------------------------------------- */

function rh_rub_exercise_keys(): array
{
    return ['WORD_ORDER', 'MISSING_WORDS', 'CONTINUE_AYAH', 'MUTASHABIHAT', 'PROGRESSIVE_HIDE'];
}

function rh_rub_difficulties(): array
{
    return ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'];
}

function rh_rub_sample_sizes(): array
{
    // 999 is the "all verses" sentinel used by the client.
    return [4, 6, 8, 999];
}

/* -------------------------------------------------------------------------
 * Arabic normalisation (typed answers)
 * ---------------------------------------------------------------------- */

/**
 * Strip harakat/Quranic marks and fold common spelling variants so a typed
 * answer can be compared with the Uthmani word. The displayed text is never
 * changed; this is only for validation.
 */
function rh_rub_normalize_arabic(string $text): string
{
    $text = preg_replace(
        '/[\x{0610}-\x{061A}\x{064B}-\x{065F}\x{0670}\x{06D6}-\x{06ED}\x{0640}]/u',
        '',
        $text
    );
    if ($text === null) {
        return '';
    }
    $text = str_replace(
        ['أ', 'إ', 'آ', 'ٱ', 'ى', 'ؤ', 'ئ', 'ة', 'ء'],
        ['ا', 'ا', 'ا', 'ا', 'ي', 'و', 'ي', 'ه', ''],
        $text
    );
    $text = preg_replace('/\s+/u', ' ', $text);
    return $text === null ? '' : trim($text);
}

/** Split a verse into display words (already provided by rh_split_words). */
function rh_rub_word_objects(array $words): array
{
    $out = [];
    foreach ($words as $index => $word) {
        $out[] = [
            'i'    => (int) $index,
            'text' => (string) $word,
            'norm' => rh_rub_normalize_arabic((string) $word),
        ];
    }
    return $out;
}

/**
 * Remove decoys that duplicate a real verse word after normalisation.
 *
 * @param string[] $decoys
 * @param string[] $verseWords
 * @param string[] $already
 * @return string[]
 */
function rh_rub_filter_decoys(array $decoys, array $verseWords, array $already = []): array
{
    $seen = [];
    foreach ($verseWords as $word) {
        $norm = rh_rub_normalize_arabic((string) $word);
        if ($norm !== '') {
            $seen[$norm] = true;
        }
    }
    foreach ($already as $word) {
        $norm = rh_rub_normalize_arabic((string) $word);
        if ($norm !== '') {
            $seen[$norm] = true;
        }
    }

    $out = [];
    foreach ($decoys as $decoy) {
        $norm = rh_rub_normalize_arabic((string) $decoy);
        if ($norm === '' || isset($seen[$norm])) {
            continue;
        }
        $seen[$norm] = true;
        $out[] = (string) $decoy;
    }
    return $out;
}

/* -------------------------------------------------------------------------
 * Deterministic RNG + selection
 * ---------------------------------------------------------------------- */

function rh_rub_rng(int $seed): callable
{
    $state = $seed & 0x7fffffff;
    if ($state === 0) {
        $state = 1;
    }
    return static function () use (&$state): float {
        $state = (int) ((1103515245 * $state + 12345) & 0x7fffffff);
        return $state / 2147483647;
    };
}

function rh_rub_shuffle(array $items, int $seed): array
{
    $rand = rh_rub_rng($seed);
    for ($i = count($items) - 1; $i > 0; $i--) {
        $j = (int) floor($rand() * ($i + 1));
        $tmp = $items[$i];
        $items[$i] = $items[$j];
        $items[$j] = $tmp;
    }
    return array_values($items);
}

/**
 * Pick a deterministic, weak-verse-first sample.
 *
 * @param array<int,array<string,mixed>> $candidates
 * @param array<string,array<string,mixed>> $stats verseKey => stats row
 * @return array<int,array<string,mixed>>
 */
function rh_rub_pick_items(array $candidates, int $count, int $seed, array $stats, string $focus = 'ALL'): array
{
    if (!$candidates) {
        return [];
    }

    $today = date('Y-m-d');
    $rand = rh_rub_rng($seed);

    $scored = [];
    foreach ($candidates as $candidate) {
        $key = (string) ($candidate['key'] ?? '');
        if ($key === '') {
            continue;
        }
        $st = $stats[$key] ?? null;
        $due = 0;
        if ($st !== null && !empty($st['due_at']) && (string) $st['due_at'] <= $today) {
            $due = 60;
        }
        $wrongCount = (int) ($st['wrong_count'] ?? 0);
        $streak = (int) ($st['streak'] ?? 0);
        // A long correct streak slowly repays historical misses, so a verse
        // that was once wrong but is now consistently recalled stops being
        // treated as weak.
        $wrong = max(0, $wrongCount - $streak) * 8;
        $lowStreak = max(0, 12 - min(12, $streak));
        $seenAgo = 0;
        if ($st !== null && !empty($st['last_seen_at'])) {
            $seenAgo = min(20, (int) floor((time() - strtotime((string) $st['last_seen_at'])) / 86400));
        }
        $scored[] = [
            'item'  => $candidate,
            'key'   => $key,
            'weak'  => ($wrongCount > 0 && $streak < 3) || $due > 0,
            'score' => $due + $wrong + $lowStreak + $seenAgo + ($rand() * 6),
        ];
    }

    if ($focus === 'WEAK') {
        $weak = array_values(array_filter($scored, static fn(array $row): bool => $row['weak']));
        if ($weak) {
            $scored = $weak;
        }
    }

    usort($scored, static function (array $a, array $b): int {
        if ($a['score'] === $b['score']) {
            return strcmp($a['key'], $b['key']);
        }
        return $b['score'] <=> $a['score'];
    });

    if ($count >= 999 || $count >= count($scored)) {
        $picked = array_map(static fn(array $row): array => $row['item'], $scored);
    } else {
        $picked = array_map(static fn(array $row): array => $row['item'], array_slice($scored, 0, max(1, $count)));
    }

    // Keep mushaf order inside the session so the user still feels the rub'.
    usort($picked, static function (array $a, array $b): int {
        $as = (int) ($a['surah'] ?? 0);
        $bs = (int) ($b['surah'] ?? 0);
        if ($as === $bs) {
            return ((int) ($a['ayah'] ?? 0)) <=> ((int) ($b['ayah'] ?? 0));
        }
        return $as <=> $bs;
    });

    return $picked;
}

/* -------------------------------------------------------------------------
 * Qur'an helpers
 * ---------------------------------------------------------------------- */

function rh_rub_verse_key(int $surah, int $ayah): string
{
    return $surah . ':' . $ayah;
}

/** Next ayah after (surah, ayah), crossing surah boundaries. */
function rh_rub_next_ayah(int $surah, int $ayah): ?array
{
    $quran = rh_load_quran();
    $current = $quran[(string) $surah] ?? null;
    if (!is_array($current)) {
        return null;
    }

    if (isset($current[$ayah])) {
        return [
            'surah' => $surah,
            'ayah'  => $ayah + 1,
            'text'  => (string) $current[$ayah],
        ];
    }

    for ($next = $surah + 1; $next <= 114; $next++) {
        $ayat = $quran[(string) $next] ?? null;
        if (is_array($ayat) && $ayat) {
            return [
                'surah' => $next,
                'ayah'  => 1,
                'text'  => (string) $ayat[0],
            ];
        }
    }

    return null;
}

/* -------------------------------------------------------------------------
 * Curated mutashabihat
 * ---------------------------------------------------------------------- */

function rh_rub_curated_mutashabihat(): array
{
    static $map = null;
    if ($map !== null) {
        return $map;
    }
    $map = [];
    $path = __DIR__ . '/../../web/data/mutashabihat_curated.json';
    $raw = @file_get_contents($path);
    if ($raw === false || $raw === '') {
        return $map;
    }
    $decoded = json_decode($raw, true);
    if (!is_array($decoded) || !isset($decoded['verses']) || !is_array($decoded['verses'])) {
        return $map;
    }
    foreach ($decoded['verses'] as $key => $refs) {
        if (!is_string($key) || !is_array($refs)) {
            continue;
        }
        $clean = [];
        foreach ($refs as $ref) {
            if (!is_array($ref) || count($ref) < 2) {
                continue;
            }
            $s = (int) $ref[0];
            $a = (int) $ref[1];
            if ($s > 0 && $a > 0) {
                $clean[] = [$s, $a];
            }
        }
        if ($clean) {
            $map[$key] = $clean;
        }
    }
    return $map;
}

/**
 * Token-level diff of two real verse texts.
 *
 * @param string[] $aWords
 * @param string[] $bWords
 * @return array{a:array<int,array{text:string,changed:bool}>, b:array<int,array{text:string,changed:bool}>, changed:int}
 */
function rh_rub_word_diff(array $aWords, array $bWords): array
{
    $aNorm = array_map('rh_rub_normalize_arabic', $aWords);
    $bNorm = array_map('rh_rub_normalize_arabic', $bWords);
    $n = count($aNorm);
    $m = count($bNorm);

    $lcs = [];
    for ($i = 0; $i <= $n; $i++) {
        $lcs[$i] = array_fill(0, $m + 1, 0);
    }
    for ($i = 1; $i <= $n; $i++) {
        for ($j = 1; $j <= $m; $j++) {
            if ($aNorm[$i - 1] !== '' && $aNorm[$i - 1] === $bNorm[$j - 1]) {
                $lcs[$i][$j] = $lcs[$i - 1][$j - 1] + 1;
            } else {
                $lcs[$i][$j] = max($lcs[$i - 1][$j], $lcs[$i][$j - 1]);
            }
        }
    }

    $matchedA = [];
    $matchedB = [];
    $i = $n;
    $j = $m;
    while ($i > 0 && $j > 0) {
        if ($aNorm[$i - 1] !== '' && $aNorm[$i - 1] === $bNorm[$j - 1]) {
            $matchedA[$i - 1] = true;
            $matchedB[$j - 1] = true;
            $i--;
            $j--;
        } elseif ($lcs[$i - 1][$j] >= $lcs[$i][$j - 1]) {
            $i--;
        } else {
            $j--;
        }
    }

    $segmentsA = [];
    $changedA = 0;
    foreach ($aWords as $index => $word) {
        $isChanged = !isset($matchedA[$index]);
        if ($isChanged) {
            $changedA++;
        }
        $segmentsA[] = ['text' => (string) $word, 'changed' => $isChanged];
    }
    $segmentsB = [];
    $changedB = 0;
    foreach ($bWords as $index => $word) {
        $isChanged = !isset($matchedB[$index]);
        if ($isChanged) {
            $changedB++;
        }
        $segmentsB[] = ['text' => (string) $word, 'changed' => $isChanged];
    }

    return [
        'a' => $segmentsA,
        'b' => $segmentsB,
        'changed' => max($changedA, $changedB),
        'changed_a' => $changedA,
        'changed_b' => $changedB,
    ];
}

function rh_rub_common_prefix(array $aWords, array $bWords): int
{
    $n = min(count($aWords), count($bWords));
    $prefix = 0;
    for ($i = 0; $i < $n; $i++) {
        $an = rh_rub_normalize_arabic((string) $aWords[$i]);
        $bn = rh_rub_normalize_arabic((string) $bWords[$i]);
        if ($an === '' || $an !== $bn) {
            break;
        }
        $prefix++;
    }
    return $prefix;
}

/* -------------------------------------------------------------------------
 * Plan builders
 * ---------------------------------------------------------------------- */

/** @param array<int,array<string,mixed>> $verses */
function rh_rub_plan_word_order(array $verses, int $rubId, string $difficulty, int $count, int $seed, array $stats, string $focus): array
{
    $candidates = array_values(array_filter($verses, static function (array $v): bool {
        return count($v['words']) >= 3;
    }));
    $picked = rh_rub_pick_items($candidates, $count, $seed, $stats, $focus);

    $items = [];
    foreach ($picked as $verse) {
        $plain = [
            'surah' => (int) $verse['surah'],
            'ayah'  => (int) $verse['ayah'],
            'words' => $verse['words'],
        ];
        $decoys = $difficulty === 'BEGINNER' ? rh_rub_distractors($rubId, $plain, 3) : [];
        $decoys = rh_rub_filter_decoys($decoys, $verse['words']);
        $items[] = [
            'item_id'    => 'wo:' . $verse['key'],
            'verse_key'  => $verse['key'],
            'surah'      => (int) $verse['surah'],
            'ayah'       => (int) $verse['ayah'],
            'text'       => (string) $verse['text'],
            'words'      => rh_rub_word_objects($verse['words']),
            'decoys'     => array_values($decoys),
            'hint_first' => $difficulty === 'BEGINNER' && $verse['words'] ? (string) $verse['words'][0] : '',
        ];
    }

    return [
        'available' => count($items) > 0,
        'items'     => $items,
        'reason'    => count($items) > 0 ? null : 'no_verses',
    ];
}

/** @param array<int,array<string,mixed>> $verses */
function rh_rub_plan_missing_words(array $verses, int $rubId, string $difficulty, int $count, int $seed, array $stats, string $focus): array
{
    $candidates = array_values(array_filter($verses, static function (array $v): bool {
        return count($v['words']) >= 3;
    }));
    $picked = rh_rub_pick_items($candidates, $count, $seed, $stats, $focus);

    $ratio = $difficulty === 'BEGINNER' ? 0.18 : ($difficulty === 'INTERMEDIATE' ? 0.34 : 0.50);
    $decoyCount = $difficulty === 'BEGINNER' ? 2 : ($difficulty === 'INTERMEDIATE' ? 1 : 0);

    $items = [];
    foreach ($picked as $verse) {
        $words = $verse['words'];
        $total = count($words);
        $hideCount = max(1, (int) round($total * $ratio));
        $hideCount = min($hideCount, max(1, $total - 1));

        // Prefer content words (3+ letters) and never hide the first word on
        // beginner/intermediate, so the verse still has a clear anchor.
        $candidateIndexes = [];
        foreach ($words as $index => $word) {
            if ($difficulty !== 'ADVANCED' && $index === 0) {
                continue;
            }
            $norm = rh_rub_normalize_arabic((string) $word);
            $candidateIndexes[] = ['i' => (int) $index, 'len' => mb_strlen($norm, 'UTF-8')];
        }
        if (!$candidateIndexes) {
            $candidateIndexes[] = ['i' => 0, 'len' => 1];
        }

        $preferred = array_values(array_filter($candidateIndexes, static fn(array $row): bool => $row['len'] >= 3));
        if (count($preferred) < $hideCount) {
            $preferred = $candidateIndexes;
        }
        $shuffled = rh_rub_shuffle($preferred, $seed + (int) $verse['ayah'] * 31);
        $hidden = [];
        foreach (array_slice($shuffled, 0, $hideCount) as $row) {
            $hidden[] = (int) $row['i'];
        }
        sort($hidden);

        $hiddenSet = array_fill_keys($hidden, true);
        $bank = [];
        foreach ($hidden as $index) {
            $bank[] = (string) $words[$index];
        }
        if ($decoyCount > 0) {
            $plain = [
                'surah' => (int) $verse['surah'],
                'ayah'  => (int) $verse['ayah'],
                'words' => $words,
            ];
            $decoys = rh_rub_distractors($rubId, $plain, $decoyCount);
            $decoys = rh_rub_filter_decoys($decoys, $words);
            foreach ($decoys as $decoy) {
                $bank[] = (string) $decoy;
            }
        }
        $bank = rh_rub_shuffle($bank, $seed + (int) $verse['ayah'] * 17);

        $items[] = [
            'item_id'   => 'mw:' . $verse['key'],
            'verse_key' => $verse['key'],
            'surah'     => (int) $verse['surah'],
            'ayah'      => (int) $verse['ayah'],
            'text'      => (string) $verse['text'],
            'words'     => rh_rub_word_objects($words),
            'hidden'    => $hidden,
            'word_bank' => array_values($bank),
            'difficulty' => $difficulty,
        ];
    }

    return [
        'available' => count($items) > 0,
        'items'     => $items,
        'reason'    => count($items) > 0 ? null : 'no_verses',
    ];
}

/** @param array<int,array<string,mixed>> $verses */
function rh_rub_plan_continue_ayah(array $verses, string $difficulty, int $count, int $seed, array $stats, string $focus, bool $allowOutside): array
{
    $indexByKey = [];
    foreach ($verses as $index => $verse) {
        $indexByKey[$verse['key']] = $index;
    }

    $candidates = [];
    foreach ($verses as $index => $verse) {
        if ($index >= count($verses) - 1) {
            continue;
        }
        $candidates[] = $verse;
    }

    $picked = rh_rub_pick_items($candidates, $count, $seed + 7, $stats, $focus);
    $items = [];

    foreach ($picked as $verse) {
        $index = $indexByKey[$verse['key']] ?? null;
        if ($index === null || !isset($verses[$index + 1])) {
            continue;
        }
        $next = $verses[$index + 1];
        $items[] = rh_rub_build_continue_item($verse, $next, $verses, $difficulty, $seed, false);
    }

    // Boundary item: the last verse of the rub' always gets an explicit card.
    $last = $verses ? $verses[count($verses) - 1] : null;
    if ($last !== null) {
        if ($allowOutside) {
            $next = rh_rub_next_ayah((int) $last['surah'], (int) $last['ayah']);
            if ($next !== null && (string) $next['text'] !== '') {
                $outsideVerse = [
                    'key'   => rh_rub_verse_key((int) $next['surah'], (int) $next['ayah']),
                    'surah' => (int) $next['surah'],
                    'ayah'  => (int) $next['ayah'],
                    'text'  => (string) $next['text'],
                    'words' => rh_split_words(rh_verse_display_text((string) $next['text'])),
                ];
                $items[] = rh_rub_build_continue_item($last, $outsideVerse, $verses, $difficulty, $seed + 3, true, true);
            }
        } else {
            $items[] = [
                'item_id'        => 'ca-boundary:' . $last['key'],
                'verse_key'      => $last['key'],
                'surah'          => (int) $last['surah'],
                'ayah'           => (int) $last['ayah'],
                'prompt_text'    => (string) $last['text'],
                'prompt_ref'     => (int) $last['surah'] . ':' . (int) $last['ayah'],
                'mode'           => 'skip',
                'boundary'       => true,
                'boundary_skip'  => true,
                'outside_rub'    => false,
                'options'        => [],
                'correct_id'     => '',
                'next_ayah'      => null,
            ];
        }
    }

    // Boundary-skip cards do not require an answer; they are informational.
    $required = array_values(array_filter($items, static fn(array $item): bool => empty($item['boundary_skip'])));

    return [
        'available' => count($items) > 0,
        'items'     => $items,
        'required'  => count($required),
        'reason'    => count($items) > 0 ? null : 'no_verses',
    ];
}

/**
 * @param array<string,mixed> $verse
 * @param array<string,mixed> $next
 * @param array<int,array<string,mixed>> $rubVerses
 */
function rh_rub_build_continue_item(array $verse, array $next, array $rubVerses, string $difficulty, int $seed, bool $outside, bool $boundary = false): array
{
    $mode = $difficulty === 'ADVANCED' ? 'arrange' : 'mcq';
    $nextWords = is_array($next['words'] ?? null) ? $next['words'] : [];

    $item = [
        'item_id'       => 'ca:' . $verse['key'],
        'verse_key'     => $verse['key'],
        'surah'         => (int) $verse['surah'],
        'ayah'          => (int) $verse['ayah'],
        'prompt_text'   => (string) $verse['text'],
        'prompt_ref'    => (int) $verse['surah'] . ':' . (int) $verse['ayah'],
        'mode'          => $mode,
        'boundary'      => $boundary,
        'boundary_skip' => false,
        'outside_rub'   => $outside,
        'next_ayah'     => [
            'surah' => (int) $next['surah'],
            'ayah'  => (int) $next['ayah'],
            'text'  => (string) $next['text'],
            'key'   => (string) ($next['key'] ?? rh_rub_verse_key((int) $next['surah'], (int) $next['ayah'])),
        ],
        'words'         => rh_rub_word_objects($nextWords),
        'options'       => [],
        'correct_id'    => '',
    ];

    if ($mode === 'arrange') {
        return $item;
    }

    $options = [[
        'id'    => 'a',
        'text'  => (string) $next['text'],
        'ref'   => (int) $next['surah'] . ':' . (int) $next['ayah'],
        'correct' => true,
    ]];

    $distractors = [];
    foreach ($rubVerses as $candidate) {
        $key = (string) $candidate['key'];
        if ($key === (string) $verse['key'] || $key === (string) ($next['key'] ?? '')) {
            continue;
        }
        $distractors[] = [
            'id'   => 'd',
            'text' => (string) $candidate['text'],
            'ref'  => (int) $candidate['surah'] . ':' . (int) $candidate['ayah'],
            'correct' => false,
        ];
    }
    $distractors = rh_rub_shuffle($distractors, $seed + (int) $verse['ayah'] * 13);
    foreach (array_slice($distractors, 0, 3) as $index => $option) {
        $option['id'] = 'd' . $index;
        $options[] = $option;
    }

    $options = rh_rub_shuffle($options, $seed + (int) $verse['ayah'] * 19);
    foreach ($options as $index => $option) {
        if (!empty($option['correct'])) {
            $item['correct_id'] = (string) $option['id'];
        }
    }
    $item['options'] = array_values($options);

    return $item;
}

/** @param array<int,array<string,mixed>> $verses */
function rh_rub_plan_mutashabihat(array $verses, int $count, int $seed, array $stats, string $focus, bool $allowOutside): array
{
    $curated = rh_rub_curated_mutashabihat();
    if (!$curated) {
        return [
            'available' => false,
            'items'     => [],
            'reason'    => 'no_verified_data',
            'curated_only' => true,
        ];
    }

    $byKey = [];
    $indexByKey = [];
    foreach ($verses as $index => $verse) {
        $byKey[$verse['key']] = $verse;
        $indexByKey[$verse['key']] = $index;
    }

    $candidates = [];
    $externalOnly = false;
    foreach ($verses as $verse) {
        $key = (string) $verse['key'];
        $refs = $curated[$key] ?? [];
        $hasInside = false;
        $hasAny = false;
        foreach ($refs as $ref) {
            $twinKey = rh_rub_verse_key((int) $ref[0], (int) $ref[1]);
            if ($twinKey === $key) {
                continue;
            }
            $hasAny = true;
            if (isset($byKey[$twinKey])) {
                $hasInside = true;
            }
        }
        if (!$hasAny) {
            continue;
        }
        if (!$allowOutside && !$hasInside) {
            $externalOnly = true;
            continue;
        }
        $candidates[] = $verse;
    }

    if (!$candidates) {
        return [
            'available' => false,
            'items'     => [],
            'reason'    => $externalOnly ? 'outside_disabled' : 'no_verified_pairs',
            'curated_only' => true,
        ];
    }

    $picked = rh_rub_pick_items($candidates, $count, $seed + 11, $stats, $focus);
    $items = [];
    $usedPairs = [];

    foreach ($picked as $verse) {
        $key = (string) $verse['key'];
        $refs = $curated[$key] ?? [];
        foreach ($refs as $ref) {
            $twinSurah = (int) $ref[0];
            $twinAyah = (int) $ref[1];
            $twinKey = rh_rub_verse_key($twinSurah, $twinAyah);
            if ($twinKey === $key) {
                continue;
            }
            $outside = !isset($byKey[$twinKey]);
            if ($outside && !$allowOutside) {
                continue;
            }
            $pairKey = min($key, $twinKey) . '|' . max($key, $twinKey);
            if (isset($usedPairs[$pairKey])) {
                continue;
            }

            $twinText = '';
            $twinWords = [];
            if (isset($byKey[$twinKey])) {
                $twinText = (string) $byKey[$twinKey]['text'];
                $twinWords = $byKey[$twinKey]['words'];
            } else {
                $twinText = rh_verse_display_text(rh_verse_text(rh_load_quran(), $twinSurah, $twinAyah));
                $twinWords = rh_split_words($twinText);
            }
            if ($twinText === '' || !$twinWords) {
                continue;
            }

            $aWords = $verse['words'];
            $aNorm = implode(' ', array_map('rh_rub_normalize_arabic', $aWords));
            $bNorm = implode(' ', array_map('rh_rub_normalize_arabic', $twinWords));
            if ($aNorm === '' || $aNorm === $bNorm) {
                continue;
            }

            $prefix = rh_rub_common_prefix($aWords, $twinWords);
            $useContinuation = $prefix >= 2
                && $prefix < count($aWords)
                && $prefix < count($twinWords);

            $promptText = '';
            $promptRef = '';
            $contextRef = '';
            $mode = 'identify';
            $diff = rh_rub_word_diff($aWords, $twinWords);

            if ($useContinuation) {
                $aRemainder = array_slice($aWords, $prefix);
                $bRemainder = array_slice($twinWords, $prefix);
                $diff = rh_rub_word_diff($aRemainder, $bRemainder);
                $promptText = implode(' ', array_slice($aWords, 0, $prefix));
                $promptRef = (int) $verse['surah'] . ':' . (int) $verse['ayah'];
                $mode = 'continuation';
                $optionA = [
                    'id' => 'a',
                    'text' => implode(' ', $aRemainder),
                    'ref' => (int) $verse['surah'] . ':' . (int) $verse['ayah'],
                    'correct' => true,
                    'segments' => $diff['a'],
                ];
                $optionB = [
                    'id' => 'b',
                    'text' => implode(' ', $bRemainder),
                    'ref' => $twinSurah . ':' . $twinAyah,
                    'correct' => false,
                    'segments' => $diff['b'],
                ];
            } else {
                $optionA = [
                    'id' => 'a',
                    'text' => (string) $verse['text'],
                    'ref' => (int) $verse['surah'] . ':' . (int) $verse['ayah'],
                    'correct' => true,
                    'segments' => $diff['a'],
                ];
                $optionB = [
                    'id' => 'b',
                    'text' => $twinText,
                    'ref' => $twinSurah . ':' . $twinAyah,
                    'correct' => false,
                    'segments' => $diff['b'],
                ];

                $verseIndex = $indexByKey[$key] ?? -1;
                if ($outside) {
                    // The rub' boundary is the context: one verse belongs to the
                    // selected rub', the other is a verified twin from outside.
                    $mode = 'rub_membership';
                } elseif ($verseIndex > 0 && isset($verses[$verseIndex - 1])) {
                    $context = $verses[$verseIndex - 1];
                    $mode = 'context_before';
                    $promptText = (string) $context['text'];
                    $promptRef = (int) $context['surah'] . ':' . (int) $context['ayah'];
                    $contextRef = $promptRef;
                } elseif ($verseIndex >= 0 && isset($verses[$verseIndex + 1])) {
                    $context = $verses[$verseIndex + 1];
                    $mode = 'context_after';
                    $promptText = (string) $context['text'];
                    $promptRef = (int) $context['surah'] . ':' . (int) $context['ayah'];
                    $contextRef = $promptRef;
                } else {
                    // A one-verse rub' cannot provide context; skip this pair.
                    continue;
                }
            }

            $options = rh_rub_shuffle([$optionA, $optionB], $seed + (int) $verse['ayah'] * 23 + $twinAyah);
            $correctId = '';
            foreach ($options as $index => $option) {
                $options[$index]['id'] = $index === 0 ? 'a' : 'b';
                if (!empty($option['correct'])) {
                    $correctId = $options[$index]['id'];
                }
            }

            $usedPairs[$pairKey] = true;
            $items[] = [
                'item_id'      => 'mt:' . $key,
                'verse_key'    => $key,
                'surah'        => (int) $verse['surah'],
                'ayah'         => (int) $verse['ayah'],
                'mode'         => $mode,
                'prompt_text'  => $promptText,
                'prompt_ref'   => $promptRef,
                'prompt_full'  => (string) $verse['text'],
                'context_ref'  => $contextRef,
                'options'      => array_values($options),
                'correct_id'   => $correctId,
                'twin_ref'     => $twinSurah . ':' . $twinAyah,
                'twin_text'    => $twinText,
                'outside_rub'  => $outside,
                'diff_count'   => (int) $diff['changed'],
                'diff_a'       => (int) ($diff['changed_a'] ?? 0),
                'diff_b'       => (int) ($diff['changed_b'] ?? 0),
                'curated_only' => true,
            ];
            break;
        }
    }

    return [
        'available' => count($items) > 0,
        'items'     => $items,
        'reason'    => count($items) > 0 ? null : ($externalOnly ? 'outside_disabled' : 'no_verified_pairs'),
        'curated_only' => true,
    ];
}

/** @param array<int,array<string,mixed>> $verses */
function rh_rub_plan_progressive_hide(array $verses, int $count, int $seed, array $stats, string $focus): array
{
    $candidates = array_values(array_filter($verses, static function (array $v): bool {
        return count($v['words']) >= 2;
    }));
    $picked = rh_rub_pick_items($candidates, $count, $seed + 29, $stats, $focus);

    $items = [];
    foreach ($picked as $verse) {
        $order = range(0, max(0, count($verse['words']) - 1));
        $order = rh_rub_shuffle($order, $seed + (int) $verse['ayah'] * 37);
        $items[] = [
            'item_id'    => 'ph:' . $verse['key'],
            'verse_key'  => $verse['key'],
            'surah'      => (int) $verse['surah'],
            'ayah'       => (int) $verse['ayah'],
            'text'       => (string) $verse['text'],
            'words'      => rh_rub_word_objects($verse['words']),
            'hide_order' => array_values($order),
            'stages'     => 5,
        ];
    }

    return [
        'available' => count($items) > 0,
        'items'     => $items,
        'reason'    => count($items) > 0 ? null : 'no_verses',
    ];
}

/**
 * Build the complete session plan.
 *
 * @param array<string,mixed> $stats verseKey => stats row
 * @return array<string,mixed>
 */
function rh_rub_build_plan(int $rubId, string $difficulty, array $exercises, int $sampleSize, bool $allowOutside, string $focus, array $stats, int $seed): array
{
    $payload = rh_rub_verse_list($rubId);
    if ($payload['rub'] === null) {
        return ['exercises' => [], 'rub' => null, 'generated_at' => date('c')];
    }

    $verses = [];
    foreach ($payload['verses'] as $verse) {
        $key = rh_rub_verse_key((int) $verse['surah'], (int) $verse['ayah']);
        $verses[] = [
            'key'   => $key,
            'surah' => (int) $verse['surah'],
            'ayah'  => (int) $verse['ayah'],
            'page'  => $verse['page'] ?? null,
            'text'  => (string) $verse['text'],
            'words' => array_values($verse['words']),
        ];
    }

    $plan = [];
    foreach (rh_rub_exercise_keys() as $exercise) {
        if (!in_array($exercise, $exercises, true)) {
            continue;
        }
        switch ($exercise) {
            case 'WORD_ORDER':
                $plan[$exercise] = rh_rub_plan_word_order($verses, $rubId, $difficulty, $sampleSize, $seed + 101, $stats, $focus);
                break;
            case 'MISSING_WORDS':
                $plan[$exercise] = rh_rub_plan_missing_words($verses, $rubId, $difficulty, $sampleSize, $seed + 211, $stats, $focus);
                break;
            case 'CONTINUE_AYAH':
                $plan[$exercise] = rh_rub_plan_continue_ayah($verses, $difficulty, $sampleSize, $seed + 307, $stats, $focus, $allowOutside);
                break;
            case 'MUTASHABIHAT':
                $plan[$exercise] = rh_rub_plan_mutashabihat($verses, $sampleSize, $seed + 401, $stats, $focus, $allowOutside);
                break;
            case 'PROGRESSIVE_HIDE':
                $plan[$exercise] = rh_rub_plan_progressive_hide($verses, $sampleSize, $seed + 503, $stats, $focus);
                break;
        }
    }

    return [
        'rub'          => [
            'id'    => (int) $payload['rub']['id'],
            'juz'   => (int) $payload['rub']['juz'],
            'hizb'  => (int) $payload['rub']['hizb'],
            'start' => $payload['rub']['start'],
            'end'   => $payload['rub']['end'],
        ],
        'verses_total' => count($verses),
        'exercises'    => $plan,
        'generated_at' => date('c'),
    ];
}

/** Count the items that must receive a result before the session can finish. */
function rh_rub_plan_required_items(array $plan): array
{
    $required = [];
    $exercises = is_array($plan['exercises'] ?? null) ? $plan['exercises'] : [];
    foreach ($exercises as $exercise => $stage) {
        if (!is_array($stage) || empty($stage['available'])) {
            continue;
        }
        foreach (($stage['items'] ?? []) as $item) {
            if (!is_array($item) || empty($item['item_id'])) {
                continue;
            }
            if (!empty($item['boundary_skip'])) {
                continue;
            }
            $required[] = [
                'exercise' => (string) $exercise,
                'item_id'  => (string) $item['item_id'],
            ];
        }
    }
    return $required;
}

function rh_rub_plan_total_items(array $plan): int
{
    return count(rh_rub_plan_required_items($plan));
}

/* -------------------------------------------------------------------------
 * Database helpers
 * ---------------------------------------------------------------------- */

function rh_rub_session_select(): string
{
    return '`id`, `user_id`, `task_id`, `rub_id`, `attempt_no`, `difficulty`, `status`,
            `exercises`, `plan_json`, `progress_json`, `sample_size`, `allow_outside_rub`,
            `correct_count`, `wrong_count`, `skipped_count`, `duration_seconds`,
            `started_at`, `completed_at`, `created_at`, `updated_at`';
}

function rh_rub_session_public(array $row, ?array $plan = null): array
{
    $exercises = [];
    if (!empty($row['exercises'])) {
        $decoded = json_decode((string) $row['exercises'], true);
        if (is_array($decoded)) {
            $exercises = array_values(array_filter($decoded, 'is_string'));
        }
    }

    if ($plan === null) {
        $plan = [];
        if (!empty($row['plan_json'])) {
            $decoded = json_decode((string) $row['plan_json'], true);
            if (is_array($decoded)) {
                $plan = $decoded;
            }
        }
    }

    $progress = [];
    if (!empty($row['progress_json'])) {
        $decoded = json_decode((string) $row['progress_json'], true);
        if (is_array($decoded)) {
            $progress = $decoded;
        }
    }

    $required = rh_rub_plan_required_items($plan);
    $total = count($required);
    $answeredSet = [];
    if (isset($progress['answered']) && is_array($progress['answered'])) {
        foreach ($progress['answered'] as $key) {
            $answeredSet[(string) $key] = true;
        }
    }
    $answered = 0;
    foreach ($required as $requiredItem) {
        $key = $requiredItem['exercise'] . ':' . $requiredItem['item_id'];
        if (isset($answeredSet[$key])) {
            $answered++;
        }
    }

    $correct = (int) ($row['correct_count'] ?? 0);
    $wrong = (int) ($row['wrong_count'] ?? 0);
    $answeredActual = $correct + $wrong;
    $accuracy = $answeredActual > 0 ? (int) round(($correct / $answeredActual) * 100) : 0;

    return [
        'id'                 => (int) $row['id'],
        'task_id'            => (int) $row['task_id'],
        'rub_id'             => (int) $row['rub_id'],
        'attempt_no'         => (int) $row['attempt_no'],
        'difficulty'         => (string) $row['difficulty'],
        'status'             => (string) $row['status'],
        'exercises'          => $exercises,
        'plan'               => $plan,
        'progress'           => $progress,
        'sample_size'        => (int) $row['sample_size'],
        'allow_outside_rub'  => (int) $row['allow_outside_rub'] === 1,
        'correct_count'      => $correct,
        'wrong_count'        => $wrong,
        'skipped_count'      => (int) ($row['skipped_count'] ?? 0),
        'duration_seconds'   => (int) ($row['duration_seconds'] ?? 0),
        'accuracy'           => $accuracy,
        'total_items'        => $total,
        'answered_items'     => $answered,
        'progress_percent'   => $total > 0 ? (int) round(($answered / $total) * 100) : 0,
        'started_at'         => $row['started_at'] ?? null,
        'completed_at'       => $row['completed_at'] ?? null,
        'created_at'         => $row['created_at'] ?? null,
        'updated_at'         => $row['updated_at'] ?? null,
    ];
}

function rh_rub_active_session(PDO $pdo, int $userId, int $taskId): ?array
{
    $select = rh_rub_session_select();
    $stmt = $pdo->prepare(
        'SELECT ' . $select . '
         FROM `rub_sessions`
         WHERE `user_id` = :u AND `task_id` = :t AND `status` = \'IN_PROGRESS\'
         ORDER BY `id` DESC LIMIT 1'
    );
    $stmt->execute([':u' => $userId, ':t' => $taskId]);
    $row = $stmt->fetch();
    return $row ?: null;
}

function rh_rub_session_by_id(PDO $pdo, int $userId, int $sessionId): ?array
{
    $select = rh_rub_session_select();
    $stmt = $pdo->prepare(
        'SELECT ' . $select . '
         FROM `rub_sessions`
         WHERE `id` = :id AND `user_id` = :u LIMIT 1'
    );
    $stmt->execute([':id' => $sessionId, ':u' => $userId]);
    $row = $stmt->fetch();
    return $row ?: null;
}

/**
 * Stored answers for one session. Used when resuming on another device or
 * after a reload, so the page can rebuild the summary without local storage.
 *
 * @return array<int,array<string,mixed>>
 */
function rh_rub_session_results(PDO $pdo, int $sessionId, int $userId): array
{
    $stmt = $pdo->prepare(
        'SELECT `exercise`, `item_id`, `verse_key`, `status`, `is_correct`, `attempts`,
                `duration_seconds`, `hint_used`, `outside_rub`, `details`
         FROM `rub_results`
         WHERE `session_id` = :sid AND `user_id` = :u
         ORDER BY `id` ASC'
    );
    $stmt->execute([':sid' => $sessionId, ':u' => $userId]);
    $out = [];
    foreach ($stmt->fetchAll() as $row) {
        $details = [];
        if (!empty($row['details'])) {
            $decoded = json_decode((string) $row['details'], true);
            if (is_array($decoded)) {
                $details = $decoded;
            }
        }
        $out[] = [
            'exercise'         => (string) $row['exercise'],
            'item_id'          => (string) $row['item_id'],
            'verse_key'        => (string) $row['verse_key'],
            'status'           => (string) $row['status'],
            'is_correct'       => (int) $row['is_correct'] === 1,
            'attempts'         => (int) $row['attempts'],
            'duration_seconds' => (int) $row['duration_seconds'],
            'hint_used'        => (int) $row['hint_used'] === 1,
            'outside_rub'      => (int) $row['outside_rub'] === 1,
            'details'          => $details,
            'wrong_words'      => is_array($details['wrong_words'] ?? null) ? $details['wrong_words'] : [],
        ];
    }
    return $out;
}

function rh_rub_session_history(PDO $pdo, int $userId, int $rubId, int $limit = 6): array
{
    $limit = max(1, min(20, $limit));
    $stmt = $pdo->prepare(
        'SELECT ' . rh_rub_session_select() . '
         FROM `rub_sessions`
         WHERE `user_id` = :u AND `rub_id` = :r AND `status` = \'COMPLETED\'
         ORDER BY `completed_at` DESC, `id` DESC
         LIMIT ' . $limit
    );
    $stmt->execute([':u' => $userId, ':r' => $rubId]);
    $out = [];
    foreach ($stmt->fetchAll() as $row) {
        $public = rh_rub_session_public($row);
        unset($public['plan']);
        $out[] = $public;
    }
    return $out;
}

/** @return array<string,array<string,mixed>> */
function rh_rub_verse_stats_map(PDO $pdo, int $userId, int $rubId): array
{
    $stmt = $pdo->prepare(
        'SELECT `verse_key`, `surah_number`, `ayah_number`, `correct_count`, `wrong_count`,
                `streak`, `interval_days`, `ease`, `due_at`, `last_result`, `last_seen_at`
         FROM `rub_verse_stats`
         WHERE `user_id` = :u AND `rub_id` = :r'
    );
    $stmt->execute([':u' => $userId, ':r' => $rubId]);
    $out = [];
    foreach ($stmt->fetchAll() as $row) {
        $out[(string) $row['verse_key']] = $row;
    }
    return $out;
}

function rh_rub_weak_verses(PDO $pdo, int $userId, int $rubId, int $limit = 20): array
{
    $stmt = $pdo->prepare(
        'SELECT `verse_key`, `surah_number`, `ayah_number`, `correct_count`, `wrong_count`,
                `streak`, `interval_days`, `ease`, `due_at`, `last_result`, `last_seen_at`
         FROM `rub_verse_stats`
         WHERE `user_id` = :u AND `rub_id` = :r
           AND ((`wrong_count` > 0 AND `streak` < 3)
                OR (`due_at` IS NOT NULL AND `due_at` <= :today))
         ORDER BY (`wrong_count` > 0 AND `streak` < 3) DESC,
                  `wrong_count` DESC, `due_at` ASC, `last_seen_at` ASC
         LIMIT ' . max(1, min(50, $limit))
    );
    $stmt->execute([':u' => $userId, ':r' => $rubId, ':today' => date('Y-m-d')]);
    return $stmt->fetchAll();
}

function rh_rub_weak_words(PDO $pdo, int $userId, int $rubId, int $limit = 12): array
{
    $stmt = $pdo->prepare(
        'SELECT `verse_key`, `word_index`, `word_text`, `miss_count`, `last_missed_at`
         FROM `rub_word_misses`
         WHERE `user_id` = :u AND `rub_id` = :r
         ORDER BY `miss_count` DESC, `last_missed_at` DESC
         LIMIT ' . max(1, min(50, $limit))
    );
    $stmt->execute([':u' => $userId, ':r' => $rubId]);
    return $stmt->fetchAll();
}

function rh_rub_due_count(PDO $pdo, int $userId, int $rubId): int
{
    $stmt = $pdo->prepare(
        'SELECT COUNT(*) FROM `rub_verse_stats`
         WHERE `user_id` = :u AND `rub_id` = :r
           AND ((`wrong_count` > 0 AND `streak` < 3)
                OR (`due_at` IS NOT NULL AND `due_at` <= :today))'
    );
    $stmt->execute([':u' => $userId, ':r' => $rubId, ':today' => date('Y-m-d')]);
    return (int) $stmt->fetchColumn();
}

/* -------------------------------------------------------------------------
 * Result saving + spaced repetition
 * ---------------------------------------------------------------------- */

function rh_rub_update_srs(PDO $pdo, int $userId, int $rubId, array $result): void
{
    if (($result['status'] ?? 'ANSWERED') !== 'ANSWERED') {
        return;
    }

    $verseKey = (string) $result['verse_key'];
    $parts = explode(':', $verseKey);
    $surah = (int) ($parts[0] ?? 0);
    $ayah = (int) ($parts[1] ?? 0);
    if ($surah <= 0 || $ayah <= 0) {
        return;
    }

    $stmt = $pdo->prepare(
        'SELECT * FROM `rub_verse_stats`
         WHERE `user_id` = :u AND `rub_id` = :r AND `verse_key` = :k LIMIT 1'
    );
    $stmt->execute([':u' => $userId, ':r' => $rubId, ':k' => $verseKey]);
    $row = $stmt->fetch();

    $correct = (int) ($result['is_correct'] ?? 0) === 1;
    $attempts = max(1, (int) ($result['attempts'] ?? 1));
    $hint = (int) ($result['hint_used'] ?? 0) === 1;

    $correctCount = (int) ($row['correct_count'] ?? 0);
    $wrongCount = (int) ($row['wrong_count'] ?? 0);
    $streak = (int) ($row['streak'] ?? 0);
    $ease = (float) ($row['ease'] ?? 2.5);
    $interval = 1;

    if ($correct) {
        $correctCount++;
        $streak++;
        $intervals = [1, 3, 7, 14, 30, 60];
        $interval = $intervals[min($streak - 1, count($intervals) - 1)];
        if ($attempts > 2 || $hint) {
            $interval = max(1, (int) floor($interval / 2));
        }
        $ease = min(3.0, $ease + 0.05);
        $lastResult = 'CORRECT';
        $due = date('Y-m-d', strtotime('+' . $interval . ' days'));
    } else {
        $wrongCount++;
        $streak = 0;
        $interval = 1;
        $ease = max(1.3, $ease - 0.2);
        $lastResult = 'WRONG';
        $due = date('Y-m-d', strtotime('+1 day'));
    }

    if ($row) {
        $upd = $pdo->prepare(
            'UPDATE `rub_verse_stats`
             SET `correct_count` = :cc, `wrong_count` = :wc, `streak` = :st,
                 `interval_days` = :iv, `ease` = :ez, `due_at` = :due,
                 `last_result` = :lr, `last_seen_at` = NOW()
             WHERE `id` = :id'
        );
        $upd->execute([
            ':cc' => $correctCount,
            ':wc' => $wrongCount,
            ':st' => $streak,
            ':iv' => $interval,
            ':ez' => $ease,
            ':due' => $due,
            ':lr' => $lastResult,
            ':id' => (int) $row['id'],
        ]);
    } else {
        $ins = $pdo->prepare(
            'INSERT INTO `rub_verse_stats`
                (`user_id`, `rub_id`, `verse_key`, `surah_number`, `ayah_number`,
                 `correct_count`, `wrong_count`, `streak`, `interval_days`, `ease`,
                 `due_at`, `last_result`, `last_seen_at`)
             VALUES
                (:u, :r, :k, :s, :a, :cc, :wc, :st, :iv, :ez, :due, :lr, NOW())'
        );
        $ins->execute([
            ':u' => $userId,
            ':r' => $rubId,
            ':k' => $verseKey,
            ':s' => $surah,
            ':a' => $ayah,
            ':cc' => $correctCount,
            ':wc' => $wrongCount,
            ':st' => $streak,
            ':iv' => $interval,
            ':ez' => $ease,
            ':due' => $due,
            ':lr' => $lastResult,
        ]);
    }
}

function rh_rub_record_word_misses(PDO $pdo, int $userId, int $rubId, array $result, array $verseWords): void
{
    $wrongWords = $result['wrong_words'] ?? [];
    if (!is_array($wrongWords) || !$wrongWords) {
        return;
    }
    $verseKey = (string) $result['verse_key'];
    $words = $verseWords[$verseKey] ?? [];
    if (!$words) {
        return;
    }

    $stmt = $pdo->prepare(
        'INSERT INTO `rub_word_misses`
            (`user_id`, `rub_id`, `verse_key`, `word_index`, `word_text`, `miss_count`, `last_missed_at`)
         VALUES (:u, :r, :k, :i, :t, 1, NOW())
         ON DUPLICATE KEY UPDATE
            `miss_count` = `miss_count` + 1,
            `word_text` = VALUES(`word_text`),
            `last_missed_at` = NOW()'
    );

    $seen = [];
    foreach ($wrongWords as $index) {
        $index = (int) $index;
        if ($index < 0 || isset($seen[$index])) {
            continue;
        }
        $seen[$index] = true;
        $text = $words[$index] ?? '';
        if ($text === '') {
            continue;
        }
        $stmt->execute([
            ':u' => $userId,
            ':r' => $rubId,
            ':k' => $verseKey,
            ':i' => $index,
            ':t' => mb_substr((string) $text, 0, 190, 'UTF-8'),
        ]);
    }
}

/**
 * @param array<int,array<string,mixed>> $results
 * @return array<string,mixed>
 */
function rh_rub_save_results(PDO $pdo, int $userId, array $session, array $results): array
{
    $sessionId = (int) $session['id'];
    $rubId = (int) $session['rub_id'];

    $payload = rh_rub_verse_list($rubId);
    $verseWords = [];
    $allowedKeys = [];
    foreach ($payload['verses'] as $verse) {
        $key = rh_rub_verse_key((int) $verse['surah'], (int) $verse['ayah']);
        $allowedKeys[$key] = true;
        $verseWords[$key] = array_values($verse['words']);
    }

    $exerciseKeys = rh_rub_exercise_keys();

    // Only accept item ids that the stored session plan actually contains.
    // This keeps a malformed or stale client from polluting totals and SRS
    // statistics with invented items. Boundary-skip cards are included so
    // their informational result can still be kept in history.
    $allowedItems = [];
    $plan = [];
    if (!empty($session['plan_json'])) {
        $decodedPlan = json_decode((string) $session['plan_json'], true);
        if (is_array($decodedPlan)) {
            $plan = $decodedPlan;
        }
    }
    if ($plan && isset($plan['exercises']) && is_array($plan['exercises'])) {
        foreach ($plan['exercises'] as $planExercise => $stage) {
            $planExercise = strtoupper((string) $planExercise);
            if (!is_array($stage) || !isset($stage['items']) || !is_array($stage['items'])) {
                continue;
            }
            foreach ($stage['items'] as $planItem) {
                if (!is_array($planItem) || empty($planItem['item_id'])) {
                    continue;
                }
                $allowedItems[$planExercise][(string) $planItem['item_id']] = true;
            }
        }
    }

    $upsert = $pdo->prepare(
        'INSERT INTO `rub_results`
            (`session_id`, `user_id`, `rub_id`, `exercise`, `item_id`, `verse_key`,
             `surah_number`, `ayah_number`, `difficulty`, `status`, `is_correct`,
             `attempts`, `duration_seconds`, `hint_used`, `outside_rub`, `details`)
         VALUES
            (:sid, :u, :r, :ex, :item, :vk, :s, :a, :diff, :st, :ok,
             :att, :dur, :hint, :outside, :details)
         ON DUPLICATE KEY UPDATE
            `is_correct` = IF(`status` = \'ANSWERED\', `is_correct`, VALUES(`is_correct`)),
            `attempts` = IF(`status` = \'ANSWERED\', `attempts`, VALUES(`attempts`)),
            `duration_seconds` = IF(`status` = \'ANSWERED\', `duration_seconds`, VALUES(`duration_seconds`)),
            `hint_used` = IF(`status` = \'ANSWERED\', `hint_used`, VALUES(`hint_used`)),
            `outside_rub` = IF(`status` = \'ANSWERED\', `outside_rub`, VALUES(`outside_rub`)),
            `details` = IF(`status` = \'ANSWERED\', `details`, VALUES(`details`)),
            `status` = IF(`status` = \'ANSWERED\', `status`, VALUES(`status`))'
    );

    $existingStmt = $pdo->prepare(
        'SELECT `status` FROM `rub_results`
         WHERE `session_id` = :sid AND `exercise` = :ex AND `item_id` = :item LIMIT 1'
    );

    $saved = 0;
    $pdo->beginTransaction();
    try {
        foreach ($results as $result) {
            if (!is_array($result)) {
                continue;
            }
            $exercise = strtoupper((string) ($result['exercise'] ?? ''));
            $itemId = mb_substr(trim((string) ($result['item_id'] ?? '')), 0, 80, 'UTF-8');
            $verseKey = (string) ($result['verse_key'] ?? '');
            if (!in_array($exercise, $exerciseKeys, true) || $itemId === '' || !isset($allowedKeys[$verseKey])) {
                continue;
            }
            if ($allowedItems && !isset($allowedItems[$exercise][$itemId])) {
                continue;
            }

            $status = strtoupper((string) ($result['status'] ?? 'ANSWERED'));
            if (!in_array($status, ['ANSWERED', 'SKIPPED', 'BOUNDARY_SKIPPED'], true)) {
                $status = 'ANSWERED';
            }

            // First attempt wins. A queued retry must not overwrite the recorded
            // accuracy or advance spaced repetition twice. Explicit skips may be
            // replaced later by a real answer, but an answered item stays fixed.
            $existingStmt->execute([':sid' => $sessionId, ':ex' => $exercise, ':item' => mb_substr($itemId, 0, 80, 'UTF-8')]);
            $existingStatus = $existingStmt->fetchColumn();
            if ($existingStatus !== false) {
                if ((string) $existingStatus === 'ANSWERED' || $status !== 'ANSWERED') {
                    continue;
                }
            }
            $parts = explode(':', $verseKey);
            $surah = (int) ($parts[0] ?? 0);
            $ayah = (int) ($parts[1] ?? 0);

            $clean = [
                'exercise'        => $exercise,
                'item_id'         => mb_substr($itemId, 0, 80, 'UTF-8'),
                'verse_key'       => $verseKey,
                'surah_number'    => $surah,
                'ayah_number'     => $ayah,
                'status'          => $status,
                'is_correct'      => $status === 'ANSWERED' && !empty($result['is_correct']) ? 1 : 0,
                'attempts'        => max(1, min(99, (int) ($result['attempts'] ?? 1))),
                'duration_seconds' => max(0, min(3600, (int) ($result['duration_seconds'] ?? 0))),
                'hint_used'       => !empty($result['hint_used']) ? 1 : 0,
                'outside_rub'     => !empty($result['outside_rub']) ? 1 : 0,
                'wrong_words'     => is_array($result['wrong_words'] ?? null) ? $result['wrong_words'] : [],
                'details'         => is_array($result['details'] ?? null) ? $result['details'] : [],
            ];

            $upsert->execute([
                ':sid' => $sessionId,
                ':u' => $userId,
                ':r' => $rubId,
                ':ex' => $clean['exercise'],
                ':item' => $clean['item_id'],
                ':vk' => $clean['verse_key'],
                ':s' => $clean['surah_number'],
                ':a' => $clean['ayah_number'],
                ':diff' => (string) $session['difficulty'],
                ':st' => $clean['status'],
                ':ok' => $clean['is_correct'],
                ':att' => $clean['attempts'],
                ':dur' => $clean['duration_seconds'],
                ':hint' => $clean['hint_used'],
                ':outside' => $clean['outside_rub'],
                ':details' => json_encode($clean['details'], JSON_UNESCAPED_UNICODE),
            ]);

            // MySQL reports 0 when the duplicate-key update was a no-op. That
            // happens when an ANSWERED result already won, so do not advance
            // SRS or word-miss counters a second time.
            if ($upsert->rowCount() === 0) {
                continue;
            }

            rh_rub_update_srs($pdo, $userId, $rubId, $clean);
            rh_rub_record_word_misses($pdo, $userId, $rubId, $clean, $verseWords);
            $saved++;
        }

        $totals = rh_rub_recompute_totals($pdo, $sessionId);
        $progress = [
            'answered' => rh_rub_answered_item_keys($pdo, $sessionId),
            'updated_at' => date('c'),
        ];

        $upd = $pdo->prepare(
            'UPDATE `rub_sessions`
             SET `correct_count` = :cc, `wrong_count` = :wc, `skipped_count` = :sc,
                 `duration_seconds` = GREATEST(`duration_seconds`, :dur),
                 `progress_json` = :progress
             WHERE `id` = :id AND `user_id` = :u'
        );
        $upd->execute([
            ':cc' => $totals['correct'],
            ':wc' => $totals['wrong'],
            ':sc' => $totals['skipped'],
            ':dur' => $totals['duration'],
            ':progress' => json_encode($progress, JSON_UNESCAPED_UNICODE),
            ':id' => $sessionId,
            ':u' => $userId,
        ]);

        $pdo->commit();
    } catch (Throwable $t) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $t;
    }

    $row = rh_rub_session_by_id($pdo, $userId, $sessionId);
    return [
        'saved'   => $saved,
        'session' => $row ? rh_rub_session_public($row) : null,
    ];
}

/** @return array{answered:int,correct:int,wrong:int,skipped:int,duration:int} */
function rh_rub_recompute_totals(PDO $pdo, int $sessionId): array
{
    $stmt = $pdo->prepare(
        'SELECT
            SUM(`status` = \'ANSWERED\') AS answered,
            SUM(`status` = \'ANSWERED\' AND `is_correct` = 1) AS correct,
            SUM(`status` = \'ANSWERED\' AND `is_correct` = 0) AS wrong,
            SUM(`status` = \'SKIPPED\') AS skipped,
            SUM(`duration_seconds`) AS duration
         FROM `rub_results` WHERE `session_id` = :sid'
    );
    $stmt->execute([':sid' => $sessionId]);
    $row = $stmt->fetch() ?: [];
    return [
        'answered' => (int) ($row['answered'] ?? 0),
        'correct'  => (int) ($row['correct'] ?? 0),
        'wrong'    => (int) ($row['wrong'] ?? 0),
        'skipped'  => (int) ($row['skipped'] ?? 0),
        'duration' => (int) ($row['duration'] ?? 0),
    ];
}

function rh_rub_answered_item_keys(PDO $pdo, int $sessionId): array
{
    $stmt = $pdo->prepare(
        'SELECT CONCAT(`exercise`, \':\', `item_id`) AS `key`
         FROM `rub_results` WHERE `session_id` = :sid'
    );
    $stmt->execute([':sid' => $sessionId]);
    $out = [];
    foreach ($stmt->fetchAll() as $row) {
        if (!empty($row['key'])) {
            $out[] = (string) $row['key'];
        }
    }
    return $out;
}

/* -------------------------------------------------------------------------
 * Completion
 * ---------------------------------------------------------------------- */

function rh_rub_mark_task_complete(PDO $pdo, int $userId, int $taskId, int $rubId, string $taskDate): void
{
    $stmt = $pdo->prepare(
        'SELECT `is_completed`, `task_date` FROM `daily_task_logs`
         WHERE `id` = :id AND `user_id` = :u AND `task_type` = \'RUB_TAMKIN\' LIMIT 1'
    );
    $stmt->execute([':id' => $taskId, ':u' => $userId]);
    $task = $stmt->fetch();
    if (!$task) {
        return;
    }
    if (!empty($task['task_date'])) {
        $taskDate = (string) $task['task_date'];
    }

    $upd = $pdo->prepare(
        'UPDATE `daily_task_logs` SET `is_completed` = 1
         WHERE `id` = :id AND `user_id` = :u'
    );
    $upd->execute([':id' => $taskId, ':u' => $userId]);

    if ((int) $task['is_completed'] !== 1) {
        rh_mark_rub_done($pdo, $userId, $rubId, $taskDate);
    }
}

/**
 * Finish a session. The session can only be completed once every required
 * item has a result (answered or explicitly skipped).
 *
 * @return array<string,mixed>
 */
function rh_rub_finish_session(PDO $pdo, int $userId, array $session, int $durationSeconds): array
{
    $sessionId = (int) $session['id'];
    $plan = [];
    if (!empty($session['plan_json'])) {
        $decoded = json_decode((string) $session['plan_json'], true);
        if (is_array($decoded)) {
            $plan = $decoded;
        }
    }

    $required = rh_rub_plan_required_items($plan);
    $answeredKeys = array_fill_keys(rh_rub_answered_item_keys($pdo, $sessionId), true);
    $remaining = 0;
    foreach ($required as $item) {
        $key = $item['exercise'] . ':' . $item['item_id'];
        if (!isset($answeredKeys[$key])) {
            $remaining++;
        }
    }

    if ($remaining > 0) {
        return [
            'ok'        => false,
            'remaining' => $remaining,
            'error'     => 'There are still unanswered exercise items.',
        ];
    }

    $totals = rh_rub_recompute_totals($pdo, $sessionId);
    $duration = max($totals['duration'], max(0, $durationSeconds));

    $upd = $pdo->prepare(
        'UPDATE `rub_sessions`
         SET `status` = \'COMPLETED\', `completed_at` = NOW(),
             `duration_seconds` = :dur,
             `correct_count` = :cc, `wrong_count` = :wc, `skipped_count` = :sc
         WHERE `id` = :id AND `user_id` = :u AND `status` = \'IN_PROGRESS\''
    );
    $upd->execute([
        ':dur' => $duration,
        ':cc' => $totals['correct'],
        ':wc' => $totals['wrong'],
        ':sc' => $totals['skipped'],
        ':id' => $sessionId,
        ':u' => $userId,
    ]);

    // Hybrid completion rule: once a structured session is finished, the daily
    // task is complete. Users who never start a session keep the legacy
    // "all verses arranged" rule in update_rub.php.
    rh_rub_mark_task_complete(
        $pdo,
        $userId,
        (int) $session['task_id'],
        (int) $session['rub_id'],
        date('Y-m-d', strtotime((string) ($session['started_at'] ?? 'now')))
    );

    $row = rh_rub_session_by_id($pdo, $userId, $sessionId);
    return [
        'ok'      => true,
        'session' => $row ? rh_rub_session_public($row) : null,
    ];
}

/* -------------------------------------------------------------------------
 * Dashboard integration
 * ---------------------------------------------------------------------- */

function rh_rub_task_session_brief(PDO $pdo, int $userId, int $taskId): ?array
{
    try {
        $stmt = $pdo->prepare(
            'SELECT ' . rh_rub_session_select() . '
             FROM `rub_sessions`
             WHERE `user_id` = :u AND `task_id` = :t
             ORDER BY `id` DESC LIMIT 1'
        );
        $stmt->execute([':u' => $userId, ':t' => $taskId]);
        $row = $stmt->fetch();
        if (!$row) {
            return null;
        }
        $public = rh_rub_session_public($row);
        return [
            'id'               => $public['id'],
            'attempt_no'       => $public['attempt_no'],
            'status'           => $public['status'],
            'difficulty'       => $public['difficulty'],
            'accuracy'         => $public['accuracy'],
            'total_items'      => $public['total_items'],
            'answered_items'   => $public['answered_items'],
            'progress_percent' => $public['progress_percent'],
            'duration_seconds' => $public['duration_seconds'],
            'exercises'        => $public['exercises'],
        ];
    } catch (Throwable $e) {
        // A pre-v12 install must still be able to render the dashboard. The
        // session page itself reports the missing schema explicitly.
        return null;
    }
}
