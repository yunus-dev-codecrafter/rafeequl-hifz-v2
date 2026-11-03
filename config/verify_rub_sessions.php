<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz — Rub' Consolidation plan verification (v12).
 *
 * CLI only. Builds the five-exercise plan for every rub' (and for both
 * outside-rub modes) and asserts that:
 *   - every prompt/item belongs to the selected rub';
 *   - word order / missing words / progressive hide preserve the verse words;
 *   - continue-the-ayah points at the real next ayah and handles the rub' end;
 *   - mutashabihat only uses the corrected curated CC0 data;
 *   - Arabic diacritics survive the plan;
 *   - item ids are unique and required-item counts are sane.
 *
 * Usage:
 *   php config/verify_rub_sessions.php
 *   php config/verify_rub_sessions.php --quick
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    header('Content-Type: text/plain; charset=utf-8');
    echo "This verification script is CLI-only.\n";
    exit;
}

require_once __DIR__ . '/../api/tasks/_rub_session.php';

$quick = in_array('--quick', $argv, true);
$maxRub = $quick ? 20 : 240;

$errors = [];
$warnings = [];
$stats = [
    'rubs' => 0,
    'plans' => 0,
    'items' => 0,
    'inside_pairs' => 0,
    'outside_pairs' => 0,
    'unavailable_mutashabihat' => 0,
];

function verify_fail(array &$errors, string $message): void
{
    if (count($errors) < 200) {
        $errors[] = $message;
    }
}

function verify_words_match(array &$errors, string $label, string $text, array $words): void
{
    if (!$words) {
        verify_fail($errors, $label . ': empty word list');
        return;
    }
    $textTokens = preg_split('/\s+/u', trim($text), -1, PREG_SPLIT_NO_EMPTY);
    $textTokens = is_array($textTokens) ? $textTokens : [];
    $textTokens = array_values(array_filter($textTokens, static fn(string $token): bool => rh_rub_normalize_arabic($token) !== ''));
    $textNorm = implode(' ', array_map('rh_rub_normalize_arabic', $textTokens));
    $wordsNorm = implode(' ', array_map(static fn(array $w): string => rh_rub_normalize_arabic((string) $w['text']), $words));
    if ($textNorm !== $wordsNorm) {
        verify_fail($errors, $label . ': words do not reconstruct the verse text');
    }
    foreach ($words as $index => $word) {
        if ((int) ($word['i'] ?? -1) !== $index) {
            verify_fail($errors, $label . ': non-sequential word index ' . $index);
        }
        if (trim((string) ($word['text'] ?? '')) === '') {
            verify_fail($errors, $label . ': empty word at index ' . $index);
        }
        if (trim((string) ($word['norm'] ?? '')) === '') {
            verify_fail($errors, $label . ': empty normalized word at index ' . $index);
        }
    }
    if (!preg_match('/[\x{064B}-\x{0652}]/u', $text)) {
        verify_fail($errors, $label . ': verse text lost its diacritics');
    }
}

/** Compare an arrange word list with a verse text, ignoring waqf marks. */
function verify_arrange_matches(array &$errors, string $label, string $text, array $words): void
{
    if (!$words) {
        verify_fail($errors, $label . ': arrange item has no words');
        return;
    }
    $textTokens = preg_split('/\s+/u', trim($text), -1, PREG_SPLIT_NO_EMPTY);
    $textTokens = is_array($textTokens) ? $textTokens : [];
    $textTokens = array_values(array_filter($textTokens, static fn(string $token): bool => rh_rub_normalize_arabic($token) !== ''));
    $textNorm = implode(' ', array_map('rh_rub_normalize_arabic', $textTokens));
    $wordsNorm = implode(' ', array_map(static fn(array $w): string => rh_rub_normalize_arabic((string) $w['text']), $words));
    if ($textNorm !== $wordsNorm) {
        verify_fail($errors, $label . ': arrange words do not match next ayah');
    }
}

// ---------------------------------------------------------------------------
// Normalisation smoke tests
// ---------------------------------------------------------------------------
$normalisation = [
    'ٱلْحَمْدُ' => 'الحمد',
    'أَنَعْبُدُ' => 'انعبد',
    'مُوسَى' => 'موسي',
    'جَنَّةٌ' => 'جنه',
    'شَيْءٍ' => 'شي',
    '  ٱلصِّرَٰطَ  ' => 'الصرط',
];
foreach ($normalisation as $input => $expected) {
    $actual = rh_rub_normalize_arabic((string) $input);
    if ($actual !== $expected) {
        verify_fail($errors, sprintf('normalize(%s) = %s, expected %s', $input, $actual, $expected));
    }
}

// ---------------------------------------------------------------------------
// Build every plan
// ---------------------------------------------------------------------------
$difficulties = rh_rub_difficulties();
$exerciseKeys = rh_rub_exercise_keys();

for ($rubId = 1; $rubId <= $maxRub; $rubId++) {
    $payload = rh_rub_verse_list($rubId);
    if ($payload['rub'] === null || !$payload['verses']) {
        verify_fail($errors, "rub {$rubId}: missing catalog payload");
        continue;
    }
    $stats['rubs']++;

    $rubKeys = [];
    $verseIndex = [];
    foreach ($payload['verses'] as $i => $verse) {
        $key = rh_rub_verse_key((int) $verse['surah'], (int) $verse['ayah']);
        $rubKeys[$key] = true;
        $verseIndex[$key] = $i;
    }

    foreach (['ALL' => true, 'INSIDE_ONLY' => false] as $mode => $allowOutside) {
        foreach ($difficulties as $difficulty) {
            $plan = rh_rub_build_plan(
                $rubId,
                $difficulty,
                $exerciseKeys,
                999,
                $allowOutside,
                'ALL',
                [],
                1000 + $rubId
            );
            $stats['plans']++;

            if (($plan['rub']['id'] ?? null) !== $rubId) {
                verify_fail($errors, "rub {$rubId} {$mode} {$difficulty}: wrong rub id");
            }
            if (($plan['verses_total'] ?? 0) !== count($payload['verses'])) {
                verify_fail($errors, "rub {$rubId} {$mode} {$difficulty}: wrong verse total");
            }

            $required = rh_rub_plan_required_items($plan);
            if (!$required) {
                verify_fail($errors, "rub {$rubId} {$mode} {$difficulty}: no required items");
            }

            foreach ($exerciseKeys as $exercise) {
                $stage = $plan['exercises'][$exercise] ?? null;
                if (!is_array($stage)) {
                    verify_fail($errors, "rub {$rubId} {$mode} {$difficulty}: missing stage {$exercise}");
                    continue;
                }
                $items = is_array($stage['items'] ?? null) ? $stage['items'] : [];
                if (empty($stage['available']) && $items) {
                    verify_fail($errors, "rub {$rubId} {$mode} {$difficulty} {$exercise}: unavailable but has items");
                }
                if (!empty($stage['available']) && !$items) {
                    verify_fail($errors, "rub {$rubId} {$mode} {$difficulty} {$exercise}: available but empty");
                }

                $seenIds = [];
                foreach ($items as $item) {
                    $stats['items']++;
                    $itemId = (string) ($item['item_id'] ?? '');
                    if ($itemId === '') {
                        verify_fail($errors, "rub {$rubId} {$mode} {$difficulty} {$exercise}: empty item id");
                        continue;
                    }
                    if (isset($seenIds[$itemId])) {
                        verify_fail($errors, "rub {$rubId} {$mode} {$difficulty} {$exercise}: duplicate item id {$itemId}");
                    }
                    $seenIds[$itemId] = true;

                    $verseKey = (string) ($item['verse_key'] ?? '');
                    if (!isset($rubKeys[$verseKey])) {
                        verify_fail($errors, "rub {$rubId} {$mode} {$difficulty} {$exercise}: item {$itemId} verse {$verseKey} is outside the rub");
                        continue;
                    }
                    $verse = $payload['verses'][$verseIndex[$verseKey]];
                    if ((int) ($item['surah'] ?? 0) !== (int) $verse['surah'] || (int) ($item['ayah'] ?? 0) !== (int) $verse['ayah']) {
                        verify_fail($errors, "rub {$rubId} {$mode} {$difficulty} {$exercise}: item {$itemId} ref mismatch");
                    }

                    if ($exercise === 'WORD_ORDER') {
                        verify_words_match($errors, "rub {$rubId} {$mode} {$difficulty} {$exercise} {$itemId}", (string) $item['text'], $item['words']);
                        $decoys = is_array($item['decoys'] ?? null) ? $item['decoys'] : [];
                        $seenWords = [];
                        foreach ($item['words'] as $word) {
                            $seenWords[rh_rub_normalize_arabic((string) $word['text'])] = true;
                        }
                        foreach ($decoys as $decoy) {
                            $norm = rh_rub_normalize_arabic((string) $decoy);
                            if ($norm === '') {
                                verify_fail($errors, "rub {$rubId} {$mode} {$difficulty} {$exercise} {$itemId}: empty decoy");
                            }
                            if (isset($seenWords[$norm])) {
                                verify_fail($errors, "rub {$rubId} {$mode} {$difficulty} {$exercise} {$itemId}: decoy duplicates a verse word");
                            }
                        }
                    } elseif ($exercise === 'MISSING_WORDS') {
                        verify_words_match($errors, "rub {$rubId} {$mode} {$difficulty} {$exercise} {$itemId}", (string) $item['text'], $item['words']);
                        $hidden = is_array($item['hidden'] ?? null) ? $item['hidden'] : [];
                        $bank = is_array($item['word_bank'] ?? null) ? $item['word_bank'] : [];
                        if (!$hidden) {
                            verify_fail($errors, "rub {$rubId} {$mode} {$difficulty} {$exercise} {$itemId}: no hidden words");
                        }
                        if (count($hidden) !== count(array_unique(array_map('intval', $hidden)))) {
                            verify_fail($errors, "rub {$rubId} {$mode} {$difficulty} {$exercise} {$itemId}: duplicate hidden index");
                        }
                        $bankNorm = [];
                        foreach ($bank as $word) {
                            $bankNorm[rh_rub_normalize_arabic((string) $word)] = true;
                        }
                        foreach ($hidden as $index) {
                            $index = (int) $index;
                            if (!isset($item['words'][$index])) {
                                verify_fail($errors, "rub {$rubId} {$mode} {$difficulty} {$exercise} {$itemId}: hidden index {$index} out of range");
                                continue;
                            }
                            $norm = rh_rub_normalize_arabic((string) $item['words'][$index]['text']);
                            if (!isset($bankNorm[$norm])) {
                                verify_fail($errors, "rub {$rubId} {$mode} {$difficulty} {$exercise} {$itemId}: hidden word missing from bank");
                            }
                        }
                    } elseif ($exercise === 'CONTINUE_AYAH') {
                        $promptKey = (string) ($item['prompt_ref'] ?? '');
                        if ($promptKey !== $verseKey) {
                            verify_fail($errors, "rub {$rubId} {$mode} {$difficulty} {$exercise} {$itemId}: prompt ref mismatch");
                        }
                        if (!empty($item['boundary_skip'])) {
                            if (($item['mode'] ?? '') !== 'skip' || !empty($item['options'])) {
                                verify_fail($errors, "rub {$rubId} {$mode} {$difficulty} {$exercise} {$itemId}: bad boundary-skip card");
                            }
                            continue;
                        }
                        $next = $item['next_ayah'] ?? null;
                        if (!is_array($next)) {
                            verify_fail($errors, "rub {$rubId} {$mode} {$difficulty} {$exercise} {$itemId}: missing next ayah");
                            continue;
                        }
                        $nextKey = rh_rub_verse_key((int) $next['surah'], (int) $next['ayah']);
                        if (!empty($item['boundary'])) {
                            if ($allowOutside && isset($rubKeys[$nextKey])) {
                                verify_fail($errors, "rub {$rubId} {$mode} {$difficulty} {$exercise} {$itemId}: boundary next ayah is still inside the rub");
                            }
                        } else {
                            $currentIndex = $verseIndex[$verseKey];
                            $expected = $payload['verses'][$currentIndex + 1] ?? null;
                            if ($expected === null) {
                                verify_fail($errors, "rub {$rubId} {$mode} {$difficulty} {$exercise} {$itemId}: non-boundary item is the last verse");
                            } else {
                                $expectedKey = rh_rub_verse_key((int) $expected['surah'], (int) $expected['ayah']);
                                if ($nextKey !== $expectedKey) {
                                    verify_fail($errors, "rub {$rubId} {$mode} {$difficulty} {$exercise} {$itemId}: next ayah is not the real next verse");
                                }
                            }
                        }
                        if (($item['mode'] ?? '') === 'mcq') {
                            $options = is_array($item['options'] ?? null) ? $item['options'] : [];
                            $correct = 0;
                            $correctId = '';
                            foreach ($options as $option) {
                                if (!empty($option['correct'])) {
                                    $correct++;
                                    $correctId = (string) $option['id'];
                                }
                            }
                            if (count($options) < 2 || $correct !== 1 || $correctId !== (string) ($item['correct_id'] ?? '')) {
                                verify_fail($errors, "rub {$rubId} {$mode} {$difficulty} {$exercise} {$itemId}: invalid MCQ options");
                            }
                        } elseif (($item['mode'] ?? '') === 'arrange') {
                            $words = is_array($item['words'] ?? null) ? $item['words'] : [];
                            verify_arrange_matches($errors, "rub {$rubId} {$mode} {$difficulty} {$exercise} {$itemId}", (string) $next['text'], $words);
                        } else {
                            verify_fail($errors, "rub {$rubId} {$mode} {$difficulty} {$exercise} {$itemId}: unknown continue mode");
                        }
                    } elseif ($exercise === 'MUTASHABIHAT') {
                        $curated = rh_rub_curated_mutashabihat();
                        $refs = $curated[$verseKey] ?? [];
                        $twinRef = (string) ($item['twin_ref'] ?? '');
                        $found = false;
                        foreach ($refs as $ref) {
                            if (rh_rub_verse_key((int) $ref[0], (int) $ref[1]) === $twinRef) {
                                $found = true;
                                break;
                            }
                        }
                        if (!$found) {
                            verify_fail($errors, "rub {$rubId} {$mode} {$difficulty} {$exercise} {$itemId}: twin is not in the curated list");
                        }
                        $outside = !empty($item['outside_rub']);
                        if ($outside) {
                            $stats['outside_pairs']++;
                            if (isset($rubKeys[$twinRef])) {
                                verify_fail($errors, "rub {$rubId} {$mode} {$difficulty} {$exercise} {$itemId}: outside twin is inside the rub");
                            }
                        } else {
                            $stats['inside_pairs']++;
                            if (!isset($rubKeys[$twinRef])) {
                                verify_fail($errors, "rub {$rubId} {$mode} {$difficulty} {$exercise} {$itemId}: inside twin is outside the rub");
                            }
                        }
                        if (!$allowOutside && $outside) {
                            verify_fail($errors, "rub {$rubId} {$mode} {$difficulty} {$exercise} {$itemId}: outside twin used while disabled");
                        }
                        $options = is_array($item['options'] ?? null) ? $item['options'] : [];
                        $correct = 0;
                        $correctId = '';
                        foreach ($options as $option) {
                            if (!empty($option['correct'])) {
                                $correct++;
                                $correctId = (string) $option['id'];
                            }
                        }
                        if (count($options) !== 2 || $correct !== 1 || $correctId !== (string) ($item['correct_id'] ?? '')) {
                            verify_fail($errors, "rub {$rubId} {$mode} {$difficulty} {$exercise} {$itemId}: invalid twin options");
                        }
                        if ((int) ($item['diff_count'] ?? 0) < 1) {
                            verify_fail($errors, "rub {$rubId} {$mode} {$difficulty} {$exercise} {$itemId}: twin has no differences");
                        }
                    } elseif ($exercise === 'PROGRESSIVE_HIDE') {
                        verify_words_match($errors, "rub {$rubId} {$mode} {$difficulty} {$exercise} {$itemId}", (string) $item['text'], $item['words']);
                        $order = is_array($item['hide_order'] ?? null) ? $item['hide_order'] : [];
                        $expected = range(0, max(0, count($item['words']) - 1));
                        $actual = array_map('intval', $order);
                        sort($actual);
                        if ($actual !== $expected) {
                            verify_fail($errors, "rub {$rubId} {$mode} {$difficulty} {$exercise} {$itemId}: hide order is not a permutation");
                        }
                        if ((int) ($item['stages'] ?? 0) !== 5) {
                            verify_fail($errors, "rub {$rubId} {$mode} {$difficulty} {$exercise} {$itemId}: wrong stage count");
                        }
                    }
                }

                if ($exercise === 'MUTASHABIHAT' && empty($stage['available'])) {
                    $stats['unavailable_mutashabihat']++;
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
echo "Verified {$stats['rubs']} rub(s), {$stats['plans']} plan(s), {$stats['items']} item(s).\n";
echo "Mutashabihat items: {$stats['inside_pairs']} inside, {$stats['outside_pairs']} outside.\n";
echo "Unavailable mutashabihat stages: {$stats['unavailable_mutashabihat']}.\n";

if ($errors) {
    echo "\nFAILED with " . count($errors) . " error(s):\n";
    foreach ($errors as $error) {
        echo " - {$error}\n";
    }
    exit(1);
}

echo "OK: all rub' plans passed.\n";
