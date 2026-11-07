<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz — Rub' Consolidation session helpers (RUB_TAMKIN v13).
 *
 * The legacy word-arrangement board (api/tasks/get_rub_verses.php +
 * update_rub.php) is kept for the "Free Practice" tab. This file powers the
 * structured session:
 *
 *   WORD_ORDER       ترتيب الكلمات
 *   MISSING_WORDS    أكمل الآية
 *   CONTINUE_AYAH    أكمل من حيث انتهى
 *   MUTASHABIHAT     المتشابهات
 *   PROGRESSIVE_HIDE التدرج في الحفظ
 *
 * Advanced mode adds exactly three challenges:
 *   RANDOM_START     بداية عشوائية + اختيار طول المتابعة
 *   INTERRUPT        التوقف المفاجئ في أول الآية/وسطها/آخرها
 *   CONNECTION       ربط الآيات + تمييز المتشابهات الموثقة
 *
 * REVERSE / ERROR_DETECT / NO_PREVIEW are retired. Their enum values and
 * renderers are intentionally kept so old sessions and historical results stay
 * readable; they are no longer offered in new plans.
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

function rh_rub_core_exercise_keys(): array
{
    return ['WORD_ORDER', 'MISSING_WORDS', 'CONTINUE_AYAH', 'MUTASHABIHAT', 'PROGRESSIVE_HIDE'];
}

function rh_rub_advanced_exercise_keys(): array
{
    // The product has exactly three advanced challenges. Keep their order
    // stable: random start, sudden interruption, then connection/similar ayat.
    return ['RANDOM_START', 'INTERRUPT', 'CONNECTION'];
}

/**
 * Retired challenge keys are accepted only when loading/saving an old session.
 * New plans never offer them, but existing data must remain readable.
 */
function rh_rub_legacy_exercise_keys(): array
{
    return ['REVERSE', 'ERROR_DETECT', 'NO_PREVIEW'];
}

/** Exercises that may be selected when a new session starts. */
function rh_rub_exercise_keys(): array
{
    return array_merge(rh_rub_core_exercise_keys(), rh_rub_advanced_exercise_keys());
}

/** Every exercise value that can appear in a stored plan/result row. */
function rh_rub_recognized_exercise_keys(): array
{
    return array_merge(rh_rub_exercise_keys(), rh_rub_legacy_exercise_keys());
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

/**
 * Strict comparison form: removes only harakat/Quranic marks and tatweel.
 *
 * Unlike rh_rub_normalize_arabic() this never folds letters together, so
 * أ / ا, ى / ي, ة / ه and hamzah forms stay distinct. Word-identity checks and
 * the mutashabihat diff use this form; folding is only for typed answers.
 */
function rh_rub_normalize_strict(string $text): string
{
    $text = preg_replace(
        '/[\x{0610}-\x{061A}\x{064B}-\x{065F}\x{0670}\x{06D6}-\x{06ED}\x{0640}]/u',
        '',
        $text
    );
    if ($text === null) {
        return '';
    }
    $text = preg_replace('/\s+/u', ' ', $text);
    return $text === null ? '' : trim($text);
}

/** Split a verse into display words (already provided by rh_split_words). */
function rh_rub_word_objects(array $words): array
{
    $out = [];
    foreach ($words as $index => $word) {
        $out[] = [
            'i'      => (int) $index,
            'text'   => (string) $word,
            'strict' => rh_rub_normalize_strict((string) $word),
            'norm'   => rh_rub_normalize_arabic((string) $word),
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
        $norm = rh_rub_normalize_strict((string) $word);
        if ($norm !== '') {
            $seen[$norm] = true;
        }
    }
    foreach ($already as $word) {
        $norm = rh_rub_normalize_strict((string) $word);
        if ($norm !== '') {
            $seen[$norm] = true;
        }
    }

    $out = [];
    foreach ($decoys as $decoy) {
        $norm = rh_rub_normalize_strict((string) $decoy);
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
    $aNorm = array_map('rh_rub_normalize_strict', $aWords);
    $bNorm = array_map('rh_rub_normalize_strict', $bWords);
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
        $an = rh_rub_normalize_strict((string) $aWords[$i]);
        $bn = rh_rub_normalize_strict((string) $bWords[$i]);
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
            $aNorm = implode(' ', array_map('rh_rub_normalize_strict', $aWords));
            $bNorm = implode(' ', array_map('rh_rub_normalize_strict', $twinWords));
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

/* -------------------------------------------------------------------------
 * Added challenge builders (advanced Rub' consolidation)
 * ---------------------------------------------------------------------- */

function rh_rub_ref_label(array $verse): string
{
    return (int) $verse['surah'] . ':' . (int) $verse['ayah'];
}

/** Join a slice of words with single spaces, preserving every mark. */
function rh_rub_phrase(array $words, int $start, int $length): string
{
    $slice = array_slice(array_values($words), max(0, $start), max(0, $length));
    return implode(' ', array_map('strval', $slice));
}

function rh_rub_plan_interrupt(array $verses, string $difficulty, int $count, int $seed, array $stats, string $focus): array
{
    $candidates = array_values(array_filter($verses, static function (array $v): bool {
        return count($v['words']) >= 3;
    }));
    $picked = rh_rub_pick_items($candidates, $count, $seed, $stats, $focus);
    $advanced = $difficulty === 'ADVANCED';
    $levels = ['beginning', 'middle', 'end'];
    $items = [];

    foreach ($picked as $ordinal => $verse) {
        $words = array_values($verse['words']);
        $n = count($words);
        $lastStop = max(0, $n - 2);

        // Spread stopping points across the beginning, middle and end of the
        // ayah. Word boundaries only: never cut through an Arabic word.
        $level = $levels[$ordinal % count($levels)];
        if ($level === 'beginning') {
            $stop = 0;
        } elseif ($level === 'end') {
            $stop = $lastStop;
        } else {
            $stop = max(0, min($lastStop, (int) floor(($n - 1) / 2)));
        }
        if ($stop < 0) {
            $stop = 0;
        }
        if ($stop > $lastStop) {
            $stop = $lastStop;
        }

        $left = max(0, $n - ($stop + 1));
        if ($left < 1) {
            continue;
        }
        $take = min($advanced ? 4 : 2, $left);
        $items[] = [
            'item_id'          => 'int:' . $verse['key'],
            'verse_key'        => $verse['key'],
            'surah'            => (int) $verse['surah'],
            'ayah'             => (int) $verse['ayah'],
            'start_ref'        => rh_rub_ref_label($verse),
            'prompt_ref'       => rh_rub_ref_label($verse),
            'prompt_text'      => rh_rub_phrase($words, 0, $stop + 1),
            'stop_index'       => $stop,
            'stop_position'    => $stop === 0 ? 'beginning' : ($stop >= $lastStop ? 'end' : 'middle'),
            'expected_text'    => rh_rub_phrase($words, $stop + 1, $take),
            'continuation_text'=> rh_rub_phrase($words, $stop + 1, $left),
            'full_text'        => (string) $verse['text'],
            'text'             => (string) $verse['text'],
            'hide_reference'   => $advanced,
        ];
    }

    return [
        'available' => count($items) > 0,
        'items'     => $items,
        'reason'    => count($items) > 0 ? null : 'no_verses',
    ];
}

/**
 * Build the passages offered by the random-start challenge.
 *
 * "2", "3" and "5" count the starting ayah plus the following ayat. "all"
 * continues to the end of the rub'. No text is invented; every entry comes
 * from rh_rub_verse_list().
 *
 * @param array<int,array<string,mixed>> $verses
 * @return array<string,array<string,mixed>>
 */
function rh_rub_random_start_passages(array $verses, int $startIndex, array $lengths = [2, 3, 5, 'all']): array
{
    $remaining = max(0, count($verses) - $startIndex);
    $out = [];
    foreach ($lengths as $length) {
        $take = $length === 'all' ? $remaining : min((int) $length, $remaining);
        if ($take < 1) {
            continue;
        }
        $slice = array_slice($verses, $startIndex, $take);
        $refs = [];
        $texts = [];
        foreach ($slice as $verse) {
            $refs[] = rh_rub_ref_label($verse);
            $texts[] = (string) $verse['text'];
        }
        $out[(string) $length] = [
            'requested' => $length,
            'length'    => count($slice),
            'refs'      => $refs,
            'range'     => count($refs) ? $refs[0] . ' → ' . $refs[count($refs) - 1] : '',
            'text'      => implode(' ۝ ', $texts),
            'ayahs'     => array_map(static function (array $verse): array {
                return [
                    'surah' => (int) $verse['surah'],
                    'ayah'  => (int) $verse['ayah'],
                    'text'  => (string) $verse['text'],
                ];
            }, $slice),
        ];
    }
    return $out;
}

/**
 * Weak-first sampling is kept, but the display order is shuffled and at least
 * one start is taken from the second half of the rub' (when possible), so the
 * challenge never settles on the first ayat only.
 *
 * @param array<int,array<string,mixed>> $verses
 * @param array<int,array<string,mixed>> $picked
 * @return array<int,array<string,mixed>>
 */
function rh_rub_randomize_starts(array $verses, array $picked, int $seed): array
{
    $picked = rh_rub_shuffle($picked, $seed + 47);
    if (count($verses) < 2 || count($picked) < 2) {
        return $picked;
    }

    $mid = max(0, (int) floor(count($verses) / 2));
    $indexByKey = [];
    foreach ($verses as $index => $verse) {
        $indexByKey[(string) $verse['key']] = $index;
    }
    $hasFar = false;
    foreach ($picked as $verse) {
        if (($indexByKey[(string) $verse['key']] ?? 0) >= $mid) {
            $hasFar = true;
            break;
        }
    }
    if (!$hasFar && $mid < count($verses)) {
        $rand = rh_rub_rng($seed + 59);
        $far = $verses[$mid + (int) floor($rand() * max(1, count($verses) - $mid))];
        if ($far) {
            $picked[count($picked) - 1] = $far;
        }
    }
    return array_values($picked);
}

function rh_rub_plan_random_start(array $verses, string $difficulty, int $count, int $seed, array $stats, string $focus): array
{
    $picked = rh_rub_pick_items($verses, $count, $seed, $stats, $focus);
    $picked = rh_rub_randomize_starts($verses, $picked, $seed);
    $advanced = $difficulty === 'ADVANCED';
    $indexByKey = [];
    foreach ($verses as $index => $verse) {
        $indexByKey[(string) $verse['key']] = $index;
    }
    $items = [];

    foreach ($picked as $verse) {
        $startIndex = $indexByKey[(string) $verse['key']] ?? null;
        if ($startIndex === null) {
            continue;
        }
        $words = array_values($verse['words']);
        $take = min($advanced ? 3 : 2, count($words));
        $passages = rh_rub_random_start_passages($verses, $startIndex, [2, 3, 5, 'all']);
        if (!$passages) {
            continue;
        }
        $items[] = [
            'item_id'             => 'rs:' . $verse['key'],
            'verse_key'           => $verse['key'],
            'surah'               => (int) $verse['surah'],
            'ayah'                => (int) $verse['ayah'],
            'start_ref'           => rh_rub_ref_label($verse),
            'prompt_ref'          => rh_rub_ref_label($verse),
            'start_index'         => $startIndex,
            'expected_text'       => rh_rub_phrase($words, 0, $take),
            'opening_text'        => rh_rub_phrase($words, 0, $take),
            'passages'            => $passages,
            'continuation_options'=> [2, 3, 5, 'all'],
            'default_length'      => $advanced ? 5 : 2,
            'text'                => (string) $verse['text'],
            'hide_text'           => true,
            'hide_reference'      => false,
        ];
    }

    return [
        'available' => count($items) > 0,
        'items'     => $items,
        'reason'    => count($items) > 0 ? null : 'no_verses',
    ];
}

/**
 * Build a small, deterministic option set from real ayat only.
 *
 * @param array<int,array<string,mixed>> $verses
 * @param array<int,string> $pool verse keys allowed as distractors
 * @return array<int,array<string,mixed>>
 */
function rh_rub_build_options(array $verses, array $pool, string $correctText, string $correctRef, int $seed, int $wanted): array
{
    $candidates = [];
    foreach ($verses as $verse) {
        if (!in_array($verse['key'], $pool, true)) {
            continue;
        }
        $text = (string) $verse['text'];
        if (rh_rub_normalize_strict($text) === rh_rub_normalize_strict($correctText)) {
            continue;
        }
        $candidates[] = ['text' => $text, 'ref' => rh_rub_ref_label($verse)];
    }
    $candidates = rh_rub_shuffle($candidates, $seed);
    $options = [['text' => $correctText, 'ref' => $correctRef, 'correct' => true]];
    $seen = [rh_rub_normalize_strict($correctText) => true];
    foreach ($candidates as $candidate) {
        $norm = rh_rub_normalize_strict($candidate['text']);
        if ($norm === '' || isset($seen[$norm])) {
            continue;
        }
        $seen[$norm] = true;
        $options[] = ['text' => $candidate['text'], 'ref' => $candidate['ref'], 'correct' => false];
        if (count($options) >= $wanted) {
            break;
        }
    }
    $options = rh_rub_shuffle($options, $seed + 13);
    $ids = ['a', 'b', 'c', 'd', 'e'];
    $correctId = 'a';
    foreach ($options as $index => $option) {
        $options[$index]['id'] = $ids[$index] ?? ('o' . $index);
        if (!empty($option['correct'])) {
            $correctId = $options[$index]['id'];
        }
        unset($options[$index]['correct']);
    }
    return ['options' => $options, 'correct_id' => $correctId];
}

/**
 * Build a small, deterministic option set from real ayah phrases only.
 *
 * @param array<int,array{text:string,ref:string}> $candidates
 * @return array{options:array<int,array<string,mixed>>,correct_id:string}
 */
function rh_rub_build_phrase_options(array $candidates, string $correctText, string $correctRef, int $seed, int $wanted): array
{
    $candidates = rh_rub_shuffle($candidates, $seed);
    $options = [['text' => $correctText, 'ref' => $correctRef, 'correct' => true]];
    $seen = [rh_rub_normalize_strict($correctText) => true];
    foreach ($candidates as $candidate) {
        $norm = rh_rub_normalize_strict((string) ($candidate['text'] ?? ''));
        if ($norm === '' || isset($seen[$norm])) {
            continue;
        }
        $seen[$norm] = true;
        $options[] = [
            'text'    => (string) $candidate['text'],
            'ref'     => (string) ($candidate['ref'] ?? ''),
            'correct' => false,
        ];
        if (count($options) >= max(2, $wanted)) {
            break;
        }
    }
    $options = rh_rub_shuffle($options, $seed + 13);
    $ids = ['a', 'b', 'c', 'd', 'e'];
    $correctId = 'a';
    foreach ($options as $index => $option) {
        $options[$index]['id'] = $ids[$index] ?? ('o' . $index);
        if (!empty($option['correct'])) {
            $correctId = $options[$index]['id'];
        }
        unset($options[$index]['correct']);
    }
    return ['options' => array_values($options), 'correct_id' => $correctId];
}

/**
 * Advanced challenge 3: ayah connection + verified similar ayat.
 *
 * Part A tests both directions (end → next opening, opening → its ending) and
 * part B reuses only the curated mutashabihat pairs. No similarity is invented.
 *
 * @param array<int,array<string,mixed>> $verses
 */
function rh_rub_plan_connection(array $verses, string $difficulty, int $count, int $seed, array $stats, string $focus, bool $allowOutside = true): array
{
    $total = count($verses);
    if ($total < 1) {
        return ['available' => false, 'items' => [], 'reason' => 'no_verses'];
    }

    $indexByKey = [];
    foreach ($verses as $index => $verse) {
        $indexByKey[(string) $verse['key']] = $index;
    }

    // Two thirds of the stage tests transitions; one third tests verified
    // similar ayat (when the curated data has a pair for this rub'). A rub'
    // with a single ayah has no real transition distractors, so its connection
    // stage comes only from verified similar ayat (if any).
    $transitionCount = $total >= 2 ? max(1, (int) ceil($count * 0.66)) : 0;
    $similarCount = max(1, (int) floor($count * 0.34));
    $picked = $transitionCount > 0
        ? rh_rub_pick_items($verses, $transitionCount, $seed, $stats, $focus)
        : [];
    $wanted = $difficulty === 'ADVANCED' ? 4 : 3;
    $phraseLength = $difficulty === 'ADVANCED' ? 4 : 3;
    $items = [];

    foreach ($picked as $ordinal => $verse) {
        $index = $indexByKey[(string) $verse['key']] ?? null;
        if ($index === null) {
            continue;
        }
        $mode = (($ordinal + $seed) % 2 === 0) ? 'next_opening' : 'current_ending';
        if ($mode === 'next_opening' && !isset($verses[$index + 1])) {
            $mode = 'current_ending';
        }
        $words = array_values($verse['words']);
        $promptWords = [];
        $correctText = '';
        $correctRef = '';
        $targetText = '';
        $target = $verse;
        $candidates = [];

        if ($mode === 'next_opening') {
            $next = $verses[$index + 1];
            $nextWords = array_values($next['words']);
            $take = min($phraseLength, count($nextWords));
            $correctText = rh_rub_phrase($nextWords, 0, $take);
            $correctRef = rh_rub_ref_label($next);
            $targetText = (string) $next['text'];
            $target = $next;
            foreach ($verses as $candidate) {
                if ($candidate['key'] === $next['key']) {
                    continue;
                }
                $candidateWords = array_values($candidate['words']);
                $candidates[] = [
                    'text' => rh_rub_phrase($candidateWords, 0, min($phraseLength, count($candidateWords))),
                    'ref'  => rh_rub_ref_label($candidate),
                ];
            }
        } else {
            $take = min($phraseLength, count($words));
            $correctText = rh_rub_phrase($words, max(0, count($words) - $take), $take);
            $correctRef = rh_rub_ref_label($verse);
            $targetText = (string) $verse['text'];
            foreach ($verses as $candidate) {
                if ($candidate['key'] === $verse['key']) {
                    continue;
                }
                $candidateWords = array_values($candidate['words']);
                $candidateTake = min($phraseLength, count($candidateWords));
                $candidates[] = [
                    'text' => rh_rub_phrase($candidateWords, max(0, count($candidateWords) - $candidateTake), $candidateTake),
                    'ref'  => rh_rub_ref_label($candidate),
                ];
            }
        }

        $promptWords = $mode === 'next_opening'
            ? array_slice($words, max(0, count($words) - $phraseLength), $phraseLength)
            : array_slice($words, 0, min($phraseLength, count($words)));
        $built = rh_rub_build_phrase_options(
            $candidates,
            $correctText,
            $correctRef,
            abs((int) crc32($seed . ':cn:' . $mode . ':' . $verse['key'])),
            $wanted
        );
        if (count($built['options']) < 2) {
            continue;
        }
        $items[] = [
            'item_id'     => 'cn:' . ($mode === 'next_opening' ? 'n' : 'e') . ':' . $verse['key'],
            'verse_key'   => $verse['key'],
            'surah'       => (int) $verse['surah'],
            'ayah'        => (int) $verse['ayah'],
            'kind'        => 'transition',
            'mode'        => $mode,
            'prompt_text' => implode(' ', $promptWords),
            'prompt_ref'  => rh_rub_ref_label($verse),
            'options'     => $built['options'],
            'correct_id'  => $built['correct_id'],
            'correct_text'=> $correctText,
            'text'        => $targetText,
            'next_ref'    => $correctRef,
            'target_ref'  => $correctRef,
            'hide_reference' => $difficulty === 'ADVANCED',
        ];
    }

    // Part B: verified similar ayat only.
    if ($similarCount > 0) {
        $similarPlan = rh_rub_plan_mutashabihat($verses, $similarCount, $seed + 997, $stats, $focus, $allowOutside);
        foreach (($similarPlan['items'] ?? []) as $item) {
            if (!is_array($item) || empty($item['item_id'])) {
                continue;
            }
            $item['item_id'] = 'cn-sim:' . $item['item_id'];
            $item['kind'] = 'similar';
            $item['section'] = 'similar';
            $items[] = $item;
        }
    }

    return [
        'available' => count($items) > 0,
        'items'     => $items,
        'reason'    => count($items) > 0 ? null : 'no_verses',
        'parts'     => [
            'connection' => 'next_opening + current_ending',
            'similar'    => 'curated_only',
        ],
    ];
}

function rh_rub_plan_reverse(array $verses, string $difficulty, int $count, int $seed, array $stats, string $focus): array
{
    $indexByKey = [];
    foreach ($verses as $index => $verse) {
        $indexByKey[$verse['key']] = $index;
    }
    $candidates = [];
    foreach ($verses as $index => $verse) {
        if ($index > 0) {
            $candidates[] = $verse;
        }
    }
    $picked = rh_rub_pick_items($candidates, $count, $seed, $stats, $focus);
    $wanted = $difficulty === 'ADVANCED' ? 4 : 3;
    $items = [];

    foreach ($picked as $verse) {
        $index = $indexByKey[$verse['key']] ?? null;
        if ($index === null || $index < 1 || !isset($verses[$index - 1])) {
            continue;
        }
        $previous = $verses[$index - 1];
        $pool = [];
        foreach ($verses as $candidate) {
            if ($candidate['key'] !== $verse['key'] && $candidate['key'] !== $previous['key']) {
                $pool[] = $candidate['key'];
            }
        }
        $built = rh_rub_build_options(
            $verses,
            $pool,
            (string) $previous['text'],
            rh_rub_ref_label($previous),
            abs((int) crc32($seed . ':rv:' . $verse['key'])),
            $wanted
        );
        $items[] = [
            'item_id'     => 'rv:' . $verse['key'],
            'verse_key'   => $verse['key'],
            'surah'       => (int) $verse['surah'],
            'ayah'        => (int) $verse['ayah'],
            'prompt_text' => (string) $verse['text'],
            'prompt_ref'  => rh_rub_ref_label($verse),
            'options'     => $built['options'],
            'correct_id'  => $built['correct_id'],
            'text'        => (string) $previous['text'],
        ];
    }

    return [
        'available' => count($items) > 0,
        'items'     => $items,
        'reason'    => count($items) > 0 ? null : 'no_verses',
    ];
}

function rh_rub_plan_error_detect(array $verses, string $difficulty, int $count, int $seed, array $stats, string $focus): array
{
    $candidates = array_values(array_filter($verses, static function (array $v): bool {
        return count($v['words']) >= 4;
    }));
    $picked = rh_rub_pick_items($candidates, $count, $seed, $stats, $focus);
    $items = [];

    foreach ($picked as $verse) {
        $words = array_values($verse['words']);
        $n = count($words);
        $rand = rh_rub_rng(abs((int) crc32($seed . ':ed:' . $verse['key'])));
        $type = $rand() < 0.65 ? 'substitute' : 'move';
        $display = [];
        $errorIndices = [];

        if ($type === 'substitute') {
            $errorIndex = 1 + (int) floor($rand() * max(1, $n - 1));
            if ($errorIndex >= $n) {
                $errorIndex = $n - 1;
            }
            $original = (string) $words[$errorIndex];
            $replacement = '';
            $others = rh_rub_shuffle($verses, abs((int) crc32($seed . ':edpool:' . $verse['key'])));
            foreach ($others as $other) {
                if ($other['key'] === $verse['key']) {
                    continue;
                }
                foreach (array_values($other['words']) as $candidate) {
                    if (rh_rub_normalize_strict((string) $candidate) !== rh_rub_normalize_strict($original)) {
                        $replacement = (string) $candidate;
                        break 2;
                    }
                }
            }
            if ($replacement === '') {
                $type = 'move';
            } else {
                foreach ($words as $i => $word) {
                    $display[] = [
                        'i'      => $i,
                        'text'   => $i === $errorIndex ? $replacement : (string) $word,
                        'changed' => $i === $errorIndex,
                    ];
                }
                $errorIndices = [$errorIndex];
            }
        }

        if ($type === 'move') {
            $errorIndex = 1 + (int) floor($rand() * max(1, $n - 2));
            if ($errorIndex > $n - 2) {
                $errorIndex = max(0, $n - 2);
            }
            $swapped = $words;
            $tmp = $swapped[$errorIndex];
            $swapped[$errorIndex] = $swapped[$errorIndex + 1];
            $swapped[$errorIndex + 1] = $tmp;
            $display = [];
            foreach ($swapped as $i => $word) {
                $display[] = [
                    'i'      => $i,
                    'text'   => (string) $word,
                    'changed' => $i === $errorIndex || $i === $errorIndex + 1,
                ];
            }
            $errorIndices = [$errorIndex, $errorIndex + 1];
        }

        $modifiedWords = [];
        foreach ($display as $token) {
            $modifiedWords[] = $token['text'];
        }

        $items[] = [
            'item_id'       => 'ed:' . $verse['key'],
            'verse_key'     => $verse['key'],
            'surah'         => (int) $verse['surah'],
            'ayah'          => (int) $verse['ayah'],
            'display_words' => $display,
            'original_text' => (string) $verse['text'],
            'modified_text' => implode(' ', $modifiedWords),
            'text'          => (string) $verse['text'],
            'error_type'    => $type,
            'error_indices' => $errorIndices,
        ];
    }

    return [
        'available' => count($items) > 0,
        'items'     => $items,
        'reason'    => count($items) > 0 ? null : 'no_verses',
    ];
}

function rh_rub_plan_no_preview(array $verses, string $difficulty, int $count, int $seed, array $stats, string $focus): array
{
    $candidates = [];
    $total = count($verses);
    foreach ($verses as $index => $verse) {
        if ($index < $total) {
            $candidates[] = $verse;
        }
    }
    $picked = rh_rub_pick_items($candidates, $count, $seed, $stats, $focus);
    $length = $difficulty === 'ADVANCED' ? 3 : ($difficulty === 'BEGINNER' ? 1 : 2);
    $indexByKey = [];
    foreach ($verses as $index => $verse) {
        $indexByKey[$verse['key']] = $index;
    }
    $items = [];

    foreach ($picked as $verse) {
        $index = $indexByKey[$verse['key']] ?? null;
        if ($index === null) {
            continue;
        }
        $passage = [];
        $texts = [];
        for ($i = $index; $i < min($total, $index + $length); $i++) {
            $passage[] = [
                'surah' => (int) $verses[$i]['surah'],
                'ayah'  => (int) $verses[$i]['ayah'],
                'text'  => (string) $verses[$i]['text'],
            ];
            $texts[] = (string) $verses[$i]['text'];
        }
        $items[] = [
            'item_id'     => 'np:' . $verse['key'],
            'verse_key'   => $verse['key'],
            'surah'       => (int) $verse['surah'],
            'ayah'        => (int) $verse['ayah'],
            'start_ref'   => rh_rub_ref_label($verse),
            'passage'     => $passage,
            'text'        => implode(' ۝ ', $texts),
            'length'      => count($passage),
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
function rh_rub_build_plan(int $rubId, string $difficulty, array $exercises, int $sampleSize, bool $allowOutside, string $focus, array $stats, int $seed, array $history = []): array
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
        $exerciseStats = isset($history[$exercise]) && is_array($history[$exercise])
            ? rh_rub_merge_miss_stats($stats, $history[$exercise])
            : $stats;
        switch ($exercise) {
            case 'WORD_ORDER':
                $plan[$exercise] = rh_rub_plan_word_order($verses, $rubId, $difficulty, $sampleSize, $seed + 101, $exerciseStats, $focus);
                break;
            case 'MISSING_WORDS':
                $plan[$exercise] = rh_rub_plan_missing_words($verses, $rubId, $difficulty, $sampleSize, $seed + 211, $exerciseStats, $focus);
                break;
            case 'CONTINUE_AYAH':
                $plan[$exercise] = rh_rub_plan_continue_ayah($verses, $difficulty, $sampleSize, $seed + 307, $exerciseStats, $focus, $allowOutside);
                break;
            case 'MUTASHABIHAT':
                $plan[$exercise] = rh_rub_plan_mutashabihat($verses, $sampleSize, $seed + 401, $exerciseStats, $focus, $allowOutside);
                break;
            case 'PROGRESSIVE_HIDE':
                $plan[$exercise] = rh_rub_plan_progressive_hide($verses, $sampleSize, $seed + 503, $exerciseStats, $focus);
                break;
            case 'INTERRUPT':
                $plan[$exercise] = rh_rub_plan_interrupt($verses, $difficulty, $sampleSize, $seed + 601, $exerciseStats, $focus);
                break;
            case 'RANDOM_START':
                $plan[$exercise] = rh_rub_plan_random_start($verses, $difficulty, $sampleSize, $seed + 701, $exerciseStats, $focus);
                break;
            case 'CONNECTION':
                $plan[$exercise] = rh_rub_plan_connection($verses, $difficulty, $sampleSize, $seed + 809, $exerciseStats, $focus, $allowOutside);
                break;
            case 'REVERSE':
                $plan[$exercise] = rh_rub_plan_reverse($verses, $difficulty, $sampleSize, $seed + 907, $exerciseStats, $focus);
                break;
            case 'ERROR_DETECT':
                $plan[$exercise] = rh_rub_plan_error_detect($verses, $difficulty, $sampleSize, $seed + 1009, $exerciseStats, $focus);
                break;
            case 'NO_PREVIEW':
                $plan[$exercise] = rh_rub_plan_no_preview($verses, $difficulty, $sampleSize, $seed + 1103, $exerciseStats, $focus);
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

/* -------------------------------------------------------------------------
 * Progressive mastery across sessions
 * ---------------------------------------------------------------------- */

function rh_rub_mastery_requirements(): array
{
    return [
        'sessions'          => 3,
        'distinct_days'     => 2,
        'session_accuracy'  => 85,
        'challenge_accuracy'=> 80,
        'skipped_ratio'     => 10,
        'review_days'       => 21,
    ];
}

/**
 * A session only counts towards mastery when it contains all three advanced
 * challenges, reaches the high accuracy bar, and has no skips/weak exercises.
 *
 * @param array<string,mixed> $session
 */
function rh_rub_mastery_session_qualifies(array $session): bool
{
    $requirements = rh_rub_mastery_requirements();
    $assessment = is_array($session['assessment'] ?? null) ? $session['assessment'] : [];
    $exercises = array_map('strtoupper', array_map('strval', is_array($session['exercises'] ?? null) ? $session['exercises'] : []));

    $perExercise = [];
    foreach (($assessment['per_exercise'] ?? []) as $row) {
        if (is_array($row) && !empty($row['exercise'])) {
            $perExercise[strtoupper((string) $row['exercise'])] = $row;
        }
    }

    foreach (rh_rub_advanced_exercise_keys() as $key) {
        if (!in_array($key, $exercises, true)) {
            return false;
        }
        $row = $perExercise[$key] ?? null;
        if (!is_array($row) || (int) ($row['answered'] ?? 0) < 1) {
            return false;
        }
        if ((int) ($row['accuracy'] ?? 0) < (int) $requirements['challenge_accuracy']) {
            return false;
        }
    }

    if ((int) ($assessment['accuracy'] ?? 0) < (int) $requirements['session_accuracy']) {
        return false;
    }
    if ((int) ($assessment['skipped_ratio'] ?? 100) > (int) $requirements['skipped_ratio']) {
        return false;
    }
    if (!empty($assessment['needs_review_exercises'])) {
        return false;
    }
    return true;
}

/**
 * Pure mastery reducer (kept separate so the CLI verifier can test it without
 * a database).
 *
 * @param array<int,array<string,mixed>> $sessions newest first
 * @return array<string,mixed>
 */
function rh_rub_mastery_from_sessions(array $sessions, string $today): array
{
    $requirements = rh_rub_mastery_requirements();
    $advancedKeys = rh_rub_advanced_exercise_keys();

    usort($sessions, static function (array $a, array $b): int {
        $ac = (string) ($a['completed_at'] ?? '');
        $bc = (string) ($b['completed_at'] ?? '');
        if ($ac === $bc) {
            return (int) ($b['id'] ?? 0) <=> (int) ($a['id'] ?? 0);
        }
        return strcmp($bc, $ac);
    });

    $streak = [];
    foreach ($sessions as $session) {
        if (!rh_rub_mastery_session_qualifies($session)) {
            break;
        }
        $streak[] = $session;
    }

    $days = [];
    $challengeTotals = [];
    foreach ($advancedKeys as $key) {
        $challengeTotals[$key] = ['answered' => 0, 'correct' => 0, 'accuracy' => 0];
    }
    foreach ($streak as $session) {
        $date = substr((string) ($session['completed_at'] ?? ''), 0, 10);
        if ($date !== '') {
            $days[$date] = true;
        }
        foreach (($session['assessment']['per_exercise'] ?? []) as $row) {
            $key = strtoupper((string) ($row['exercise'] ?? ''));
            if (!isset($challengeTotals[$key])) {
                continue;
            }
            $challengeTotals[$key]['answered'] += (int) ($row['answered'] ?? 0);
            $challengeTotals[$key]['correct'] += (int) ($row['correct'] ?? 0);
        }
    }
    $challengesComplete = true;
    foreach ($challengeTotals as $key => $row) {
        $accuracy = $row['answered'] > 0 ? (int) round(($row['correct'] / $row['answered']) * 100) : 0;
        $challengeTotals[$key]['accuracy'] = $accuracy;
        if ($row['answered'] < 1 || $accuracy < (int) $requirements['challenge_accuracy']) {
            $challengesComplete = false;
        }
    }

    $mastered = count($streak) >= (int) $requirements['sessions']
        && count($days) >= (int) $requirements['distinct_days']
        && $challengesComplete;
    $latest = $sessions[0] ?? null;
    $latestAssessment = is_array($latest['assessment'] ?? null) ? $latest['assessment'] : [];

    $masteredAt = null;
    $nextReviewAt = null;
    if ($mastered) {
        // Review is scheduled from the most recent qualifying confirmation, so
        // mastered rub's keep returning for periodic revision.
        $latestQualified = $streak[0] ?? null;
        $masteredAt = substr((string) ($latestQualified['completed_at'] ?? ''), 0, 10) ?: null;
        if ($masteredAt !== null) {
            $nextReviewAt = date('Y-m-d', strtotime($masteredAt . ' +' . (int) $requirements['review_days'] . ' days'));
        }
    }

    if (!$sessions) {
        $status = 'NOT_STARTED';
    } elseif ($mastered) {
        $status = 'MASTERED';
    } elseif ($streak) {
        $status = 'DEVELOPING';
    } else {
        $status = 'NEEDS_REVIEW';
    }

    return [
        'status'              => $status,
        'mastered'            => $mastered,
        'qualified_sessions'  => min(count($streak), (int) $requirements['sessions']),
        'required_sessions'   => (int) $requirements['sessions'],
        'remaining_sessions'  => max(0, (int) $requirements['sessions'] - count($streak)),
        'distinct_days'       => min(count($days), (int) $requirements['distinct_days']),
        'required_days'       => (int) $requirements['distinct_days'],
        'challenges_complete' => $challengesComplete,
        'challenge_accuracy'  => $challengeTotals,
        'sessions_tested'     => count($sessions),
        'latest_accuracy'     => (int) ($latestAssessment['accuracy'] ?? 0),
        'latest_skipped_ratio'=> (int) ($latestAssessment['skipped_ratio'] ?? 0),
        'mastered_at'         => $masteredAt,
        'next_review_at'      => $nextReviewAt,
        'review_due'          => $nextReviewAt !== null && $nextReviewAt <= $today,
        'requirements'        => $requirements,
    ];
}

/** Load completed sessions and assess each against its own saved plan. */
function rh_rub_assess_rub_mastery(PDO $pdo, int $userId, int $rubId): array
{
    $sessions = [];
    try {
        $stmt = $pdo->prepare(
            'SELECT ' . rh_rub_session_select() . '
             FROM `rub_sessions`
             WHERE `user_id` = :u AND `rub_id` = :r AND `status` = \'COMPLETED\'
             ORDER BY `completed_at` DESC, `id` DESC
             LIMIT 8'
        );
        $stmt->execute([':u' => $userId, ':r' => $rubId]);
        foreach ($stmt->fetchAll() as $row) {
            $plan = [];
            if (!empty($row['plan_json'])) {
                $decoded = json_decode((string) $row['plan_json'], true);
                if (is_array($decoded)) {
                    $plan = $decoded;
                }
            }
            $exercises = [];
            if (!empty($row['exercises'])) {
                $decoded = json_decode((string) $row['exercises'], true);
                if (is_array($decoded)) {
                    $exercises = array_values(array_filter($decoded, 'is_string'));
                }
            }
            $results = rh_rub_session_results($pdo, (int) $row['id'], $userId);
            $sessions[] = [
                'id'           => (int) $row['id'],
                'completed_at' => (string) ($row['completed_at'] ?? ''),
                'exercises'    => $exercises,
                'assessment'   => rh_rub_assess_mastery($plan, $results),
            ];
        }
    } catch (Throwable $t) {
        error_log('[RubMastery] ' . $t->getMessage());
        $sessions = [];
    }
    return rh_rub_mastery_from_sessions($sessions, date('Y-m-d'));
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

/**
 * Historical misses for a specific exercise family, keyed by verse.
 *
 * This is used to prioritise the exact transitions/start points the user
 * missed in previous sessions, not just general verse weakness.
 *
 * @param array<int,string> $exercises
 * @return array<string,int>
 */
function rh_rub_exercise_miss_map(PDO $pdo, int $userId, int $rubId, array $exercises): array
{
    $keys = array_values(array_filter(array_map('strtoupper', $exercises), 'strlen'));
    if (!$keys) {
        return [];
    }
    $placeholders = implode(',', array_fill(0, count($keys), '?'));
    $stmt = $pdo->prepare(
        'SELECT `verse_key`, COUNT(*) AS `misses`
         FROM `rub_results`
         WHERE `user_id` = ? AND `rub_id` = ? AND `status` = \'ANSWERED\'
           AND `is_correct` = 0 AND `exercise` IN (' . $placeholders . ')
         GROUP BY `verse_key`'
    );
    $stmt->execute(array_merge([$userId, $rubId], $keys));
    $out = [];
    foreach ($stmt->fetchAll() as $row) {
        $key = (string) ($row['verse_key'] ?? '');
        if ($key !== '') {
            $out[$key] = (int) ($row['misses'] ?? 0);
        }
    }
    return $out;
}

/**
 * Add exercise-specific misses to the generic verse-weight map without
 * mutating stored SRS data.
 *
 * @param array<string,array<string,mixed>> $stats
 * @param array<string,int> $misses
 * @return array<string,array<string,mixed>>
 */
function rh_rub_merge_miss_stats(array $stats, array $misses): array
{
    foreach ($misses as $key => $count) {
        $key = (string) $key;
        if ($key === '' || (int) $count < 1) {
            continue;
        }
        if (!isset($stats[$key]) || !is_array($stats[$key])) {
            $stats[$key] = [
                'verse_key'   => $key,
                'wrong_count' => 0,
                'streak'      => 0,
                'due_at'      => null,
                'last_seen_at'=> null,
            ];
        }
        $stats[$key]['wrong_count'] = (int) ($stats[$key]['wrong_count'] ?? 0) + (int) $count;
    }
    return $stats;
}

/** @param array<int,array<string,int>> $maps */
function rh_rub_combine_miss_maps(array $maps): array
{
    $out = [];
    foreach ($maps as $map) {
        foreach ($map as $key => $count) {
            $key = (string) $key;
            if ($key === '') {
                continue;
            }
            $out[$key] = (int) ($out[$key] ?? 0) + (int) $count;
        }
    }
    return $out;
}

/**
 * All-time performance for a rub', grouped by exercise.
 * @return array<string,array<string,mixed>>
 */
function rh_rub_exercise_performance(PDO $pdo, int $userId, int $rubId): array
{
    $stmt = $pdo->prepare(
        'SELECT `exercise`,
                COUNT(*) AS `attempted`,
                SUM(`status` = \'ANSWERED\') AS `answered`,
                SUM(`status` = \'ANSWERED\' AND `is_correct` = 1) AS `correct`,
                SUM(`status` = \'ANSWERED\' AND `is_correct` = 0) AS `wrong`,
                SUM(`status` = \'SKIPPED\') AS `skipped`
         FROM `rub_results`
         WHERE `user_id` = :u AND `rub_id` = :r
         GROUP BY `exercise`'
    );
    $stmt->execute([':u' => $userId, ':r' => $rubId]);
    $out = [];
    foreach ($stmt->fetchAll() as $row) {
        $exercise = strtoupper((string) ($row['exercise'] ?? ''));
        if ($exercise === '') {
            continue;
        }
        $answered = (int) ($row['answered'] ?? 0);
        $correct = (int) ($row['correct'] ?? 0);
        $out[$exercise] = [
            'exercise' => $exercise,
            'attempted'=> (int) ($row['attempted'] ?? 0),
            'answered' => $answered,
            'correct'  => $correct,
            'wrong'    => (int) ($row['wrong'] ?? 0),
            'skipped'  => (int) ($row['skipped'] ?? 0),
            'accuracy' => $answered > 0 ? (int) round(($correct / $answered) * 100) : 0,
        ];
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

    $exerciseKeys = rh_rub_recognized_exercise_keys();

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
/**
 * Performance assessment for one completed session.
 *
 * Exercise completion alone never produces a strong session: accuracy, skipped
 * items, per-exercise performance and repeated word/transition confusion all
 * have to pass. This is deliberately separate from rh_rub_mastery_from_sessions:
 * no single session can mark a rub' as cumulatively mastered.
 *
 * @param array<int,array<string,mixed>> $results
 * @return array<string,mixed>
 */
function rh_rub_assess_mastery(array $plan, array $results): array
{
    $required = rh_rub_plan_required_items($plan);
    $requiredTotal = count($required);

    $answered = 0;
    $correct = 0;
    $skipped = 0;
    $perExercise = [];
    $weakVerses = [];
    $strongVerses = [];
    $weakTransitions = [];
    $similarWrong = 0;
    $interruptWrong = 0;
    $confusions = [];

    $stages = is_array($plan['exercises'] ?? null) ? $plan['exercises'] : [];
    foreach ($stages as $exercise => $stage) {
        if (!is_array($stage) || empty($stage['available'])) {
            continue;
        }
        $perExercise[$exercise] = [
            'exercise' => $exercise,
            'total'    => 0,
            'answered' => 0,
            'correct'  => 0,
            'skipped'  => 0,
            'accuracy' => 0,
            'needs_review' => false,
        ];
        foreach (($stage['items'] ?? []) as $item) {
            if (is_array($item) && !empty($item['item_id']) && empty($item['boundary_skip'])) {
                $perExercise[$exercise]['total']++;
            }
        }
    }

    // Map every planned word to its text so repeated word confusions can name
    // the actual word instead of only an index.
    $wordTextMap = [];
    foreach ($stages as $stage) {
        if (!is_array($stage) || empty($stage['items'])) {
            continue;
        }
        foreach ($stage['items'] as $plannedItem) {
            if (!is_array($plannedItem)) {
                continue;
            }
            $verseKey = (string) ($plannedItem['verse_key'] ?? '');
            $words = is_array($plannedItem['words'] ?? null) ? $plannedItem['words'] : [];
            foreach ($words as $index => $word) {
                if (is_array($word) && isset($word['i'])) {
                    $wordTextMap[$verseKey . ':' . (int) $word['i']] = (string) ($word['text'] ?? '');
                } elseif (is_string($word)) {
                    $wordTextMap[$verseKey . ':' . (int) $index] = $word;
                }
            }
        }
    }

    foreach ($results as $result) {
        if (!is_array($result)) {
            continue;
        }
        $exercise = strtoupper((string) ($result['exercise'] ?? ''));
        if (!isset($perExercise[$exercise])) {
            $perExercise[$exercise] = [
                'exercise' => $exercise, 'total' => 0, 'answered' => 0,
                'correct' => 0, 'skipped' => 0, 'accuracy' => 0, 'needs_review' => false,
            ];
        }
        $status = strtoupper((string) ($result['status'] ?? 'ANSWERED'));
        if ($status === 'BOUNDARY_SKIPPED') {
            // Informational end-of-rub card, not a user skip. It must not lower
            // mastery or make the exercise look unreviewed.
            continue;
        }
        if ($status !== 'ANSWERED') {
            $skipped++;
            $perExercise[$exercise]['skipped']++;
            continue;
        }
        $answered++;
        $perExercise[$exercise]['answered']++;
        $isCorrect = !empty($result['is_correct']);
        if ($isCorrect) {
            $correct++;
            $perExercise[$exercise]['correct']++;
            $verseKey = (string) ($result['verse_key'] ?? '');
            if ($verseKey !== '') {
                $strongVerses[$verseKey] = $verseKey;
            }
        } else {
            $verseKey = (string) ($result['verse_key'] ?? '');
            if ($verseKey !== '') {
                $weakVerses[$verseKey] = $verseKey;
            }
            $details = is_array($result['details'] ?? null) ? $result['details'] : [];
            $isSimilarItem = $exercise === 'MUTASHABIHAT'
                || ($exercise === 'CONNECTION' && (string) ($details['kind'] ?? '') === 'similar');
            if (!$isSimilarItem && in_array($exercise, ['CONTINUE_AYAH', 'CONNECTION', 'REVERSE'], true)) {
                $weakTransitions[] = [
                    'exercise'  => $exercise,
                    'verse_key' => $verseKey,
                    'item_id'   => (string) ($result['item_id'] ?? ''),
                ];
            }
            if ($isSimilarItem) {
                $similarWrong++;
            }
            if ($exercise === 'INTERRUPT') {
                $interruptWrong++;
            }
            foreach (($result['wrong_words'] ?? []) as $wordIndex) {
                if (!is_numeric($wordIndex)) {
                    continue;
                }
                $key = $verseKey . ':' . (int) $wordIndex;
                if (!isset($confusions[$key])) {
                    $confusions[$key] = [
                        'verse_key' => $verseKey,
                        'word_index' => (int) $wordIndex,
                        'word_text' => (string) ($wordTextMap[$key] ?? ''),
                        'count' => 0,
                    ];
                }
                $confusions[$key]['count']++;
            }
        }
    }

    // A verse that was missed in any exercise needs revision, even if another
    // exercise recalled a part of it correctly.
    $strongVerses = array_diff_key($strongVerses, $weakVerses);

    foreach ($perExercise as $exercise => $row) {
        $attempted = $row['answered'] + $row['skipped'];
        $perExercise[$exercise]['accuracy'] = $row['answered'] > 0
            ? (int) round(($row['correct'] / $row['answered']) * 100)
            : 0;
        $perExercise[$exercise]['needs_review'] = $row['skipped'] > 0 ||
            ($row['answered'] > 0 && $perExercise[$exercise]['accuracy'] < 70) ||
            ($attempted === 0 && $row['total'] > 0);
    }

    $accuracy = $answered > 0 ? (int) round(($correct / $answered) * 100) : 0;
    $attemptedRatio = $requiredTotal > 0 ? min(1, ($answered + $skipped) / $requiredTotal) : 0;
    $skippedRatio = ($answered + $skipped) > 0 ? $skipped / ($answered + $skipped) : 1;

    $needsReviewExercises = [];
    foreach ($perExercise as $exercise => $row) {
        if (!empty($row['needs_review'])) {
            $needsReviewExercises[] = $exercise;
        }
    }

    $mastered = $requiredTotal > 0
        && $attemptedRatio >= 0.8
        && $skippedRatio <= 0.2
        && $accuracy >= 70
        && count($needsReviewExercises) === 0;

    $recommendations = [];
    $recommendationCodes = [];
    if ($accuracy < 70) {
        $recommendationCodes[] = 'accuracy_low';
        $recommendations[] = 'أعد الجلسة وركّز على الآيات التي أخطأت فيها قبل الانتقال إلى ربع جديد.';
    }
    if ($weakTransitions) {
        $recommendationCodes[] = 'weak_transitions:' . count($weakTransitions);
        $recommendations[] = 'راجع الربط بين الآيات: توجد ' . count($weakTransitions) . ' وصلة انتقالية تحتاج تثبيتاً.';
    }
    if ($similarWrong > 0) {
        $recommendationCodes[] = 'similar_wrong:' . $similarWrong;
        $recommendations[] = 'خصص جلسة للمتشابهات: ' . $similarWrong . ' موضعاً لم يتميز فيه بين الآيات المتشابهة.';
    }
    if ($interruptWrong > 0) {
        $recommendationCodes[] = 'interrupt_wrong:' . $interruptWrong;
        $recommendations[] = 'تدرّب على التوقف المفاجئ: ' . $interruptWrong . ' موضعاً لم تستحضر تكملته.';
    }
    if ($skipped > 0) {
        $recommendationCodes[] = 'skipped:' . $skipped;
        $recommendations[] = 'لا تتجاوز التمارين غير المتقنة؛ أعدها في جلسة قريبة.';
    }
    if ($mastered) {
        $recommendationCodes[] = 'mastered';
        $recommendations[] = 'أداء هذه الجلسة قوي. واصل التحديات الثلاثة في جلسات متعددة لبناء الإتقان التراكمي قبل الانتقال.';
    }

    $confusions = array_values($confusions);
    usort($confusions, static function (array $a, array $b): int {
        return ($b['count'] <=> $a['count']);
    });
    $confusions = array_slice($confusions, 0, 12);

    return [
        'mastered'              => $mastered,
        'status'                => $mastered ? 'MASTERED' : ($accuracy >= 50 ? 'DEVELOPING' : 'NEEDS_REVIEW'),
        'accuracy'              => $accuracy,
        'correct'               => $correct,
        'answered'              => $answered,
        'skipped'               => $skipped,
        'required_total'        => $requiredTotal,
        'attempted_ratio'       => (int) round($attemptedRatio * 100),
        'skipped_ratio'         => (int) round($skippedRatio * 100),
        'per_exercise'          => array_values($perExercise),
        'needs_review_exercises' => $needsReviewExercises,
        'weak_verses'           => array_values($weakVerses),
        'strong_verses'         => array_values($strongVerses),
        'weak_transitions'      => $weakTransitions,
        'similar_ayat_wrong'    => $similarWrong,
        'interrupt_wrong'       => $interruptWrong,
        'repeated_confusions'   => $confusions,
        'recommendations'       => $recommendations,
        'recommendation_codes'  => $recommendationCodes,
    ];
}

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

    // Performance gate: finishing the exercises is not the same as mastering
    // the rub'. The daily task is only marked complete when the performance
    // assessment passes; otherwise the user is asked to repeat the weak parts.
    $results = rh_rub_session_results($pdo, $sessionId, $userId);
    $mastery = rh_rub_assess_mastery($plan, $results);
    $rubMastery = rh_rub_assess_rub_mastery($pdo, $userId, (int) $session['rub_id']);
    if (!empty($mastery['mastered'])) {
        rh_rub_mark_task_complete(
            $pdo,
            $userId,
            (int) $session['task_id'],
            (int) $session['rub_id'],
            date('Y-m-d', strtotime((string) ($session['started_at'] ?? 'now')))
        );
    }

    $row = rh_rub_session_by_id($pdo, $userId, $sessionId);
    $public = $row ? rh_rub_session_public($row) : null;
    if ($public !== null) {
        $public['results'] = $results;
        $public['mastery'] = $mastery;
        $public['rub_mastery'] = $rubMastery;
    }
    return [
        'ok'      => true,
        'session' => $public,
        'mastery' => $mastery,
        'rub_mastery' => $rubMastery,
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
