<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz — sanity checks for the rub' catalog and verse-word payload.
 *
 * Run: php config/verify_rub.php
 * Exits non-zero if anything is inconsistent.
 */

require __DIR__ . '/../api/tasks/_rub.php';

$errors = [];
$ok = static function (string $msg): void {
    echo "  ✓ " . $msg . "\n";
};
$fail = static function (string $msg) use (&$errors): void {
    $errors[] = $msg;
    echo "  ✗ " . $msg . "\n";
};

echo "== Rub' catalog verification ==\n";

$catalog = rh_rub_catalog();
$rubs = $catalog['rubs'];

if (count($rubs) === 240) {
    $ok('catalog has 240 rub\'s');
} else {
    $fail('catalog has ' . count($rubs) . ' rub\'s (expected 240)');
}

$quran = rh_load_quran();
$pageMap = rh_verse_page_map();

if ($quran && $pageMap) {
    $ok('quran text (' . count($quran) . ' surahs) and page map loaded');
} else {
    $fail('quran text or page map missing');
}

$seenVerses = [];
$tafsirMissing = [];
$totalWords = 0;
$totalVerses = 0;

for ($id = 1; $id <= 240; $id++) {
    $rub = $rubs[$id] ?? null;
    if ($rub === null) {
        $fail('missing rub ' . $id);
        continue;
    }

    $payload = rh_rub_verse_list($id);
    if ($payload['rub'] === null) {
        $fail('could not expand rub ' . $id);
        continue;
    }

    $count = count($payload['verses']);
    $tafsir = rh_rub_tafsir($id);

    foreach ($payload['verses'] as $verse) {
        $key = $verse['surah'] . ':' . $verse['ayah'];
        if (isset($seenVerses[$key])) {
            $fail('verse ' . $key . ' appears in rub ' . $seenVerses[$key] . ' and ' . $id);
        }
        $seenVerses[$key] = $id;

        if (($tafsir[$key]['ar'] ?? '') === '' || ($tafsir[$key]['en'] ?? '') === '') {
            $tafsirMissing[] = $key;
        }

        if (trim((string) $verse['text']) === '') {
            $fail('verse ' . $key . ' has empty display text');
        }
        if (!is_array($verse['words']) || !$verse['words']) {
            $fail('verse ' . $key . ' has no words');
            continue;
        }
        foreach ($verse['words'] as $i => $word) {
            if (trim((string) $word) === '') {
                $fail('verse ' . $key . ' has an empty word #' . $i);
            }
            if (!rh_has_recitable_content(rh_codepoints((string) $word))) {
                $fail('verse ' . $key . ' has a mark-only word #' . $i);
            }
        }
        $totalWords += count($verse['words']);
    }

    if ($count !== (int) $rub['verse_count']) {
        $fail('rub ' . $id . ' verse_count mismatch (' . $count . ' vs ' . $rub['verse_count'] . ')');
    }

    $totalVerses += $count;
}

if (count($seenVerses) === 6236) {
    $ok('all 6236 verses covered exactly once');
} else {
    $fail('covered ' . count($seenVerses) . ' verses (expected 6236)');
}

if ($totalVerses === 6236) {
    $ok('verse total is 6236');
} else {
    $fail('verse total is ' . $totalVerses);
}

$ok('word tokens: ' . $totalWords . ' (avg ' . round($totalWords / 240, 1) . ' / rub)');

if (!$tafsirMissing) {
    $ok('Mukhtasar tafsir covers all 6236 verses in Arabic and English');
} else {
    $sample = implode(', ', array_slice($tafsirMissing, 0, 8));
    $fail('tafsir missing for ' . count($tafsirMissing) . ' verse(s): ' . $sample);
}

// Boundary spot checks (verified against the Quran.com rub_el_hizb_number field).
$checks = [
    1 => ['start' => '1:1', 'end' => '2:25'],
    3 => ['start' => '2:44', 'end' => '2:59'],
    240 => ['start' => '100:9', 'end' => '114:6'],
];
foreach ($checks as $id => $expect) {
    $rub = $rubs[$id];
    $actualStart = $rub['start']['surah'] . ':' . $rub['start']['ayah'];
    $actualEnd = $rub['end']['surah'] . ':' . $rub['end']['ayah'];
    if ($actualStart === $expect['start'] && $actualEnd === $expect['end']) {
        $ok('rub ' . $id . ' = ' . $actualStart . ' → ' . $actualEnd);
    } else {
        $fail('rub ' . $id . ' = ' . $actualStart . ' → ' . $actualEnd . ' (expected ' . $expect['start'] . ' → ' . $expect['end'] . ')');
    }
}

// Whole-Qur'an decoy words: deterministic, non-empty, and never one of the
// verse's own words.
echo "\n== Word-arrangement payload spot checks ==\n";
$sample = rh_rub_verse_list(1);
$checked = 0;
foreach ($sample['verses'] as $verse) {
    if ($checked >= 10) {
        break;
    }
    $checked++;
    $key = $verse['surah'] . ':' . $verse['ayah'];
    $first = rh_rub_distractors(1, $verse, 3);
    $second = rh_rub_distractors(1, $verse, 3);

    if ($first !== $second) {
        $fail($key . ' distractors are not deterministic');
    }
    if (count($first) !== 3) {
        $fail($key . ' returned ' . count($first) . ' distractors (expected 3)');
    }

    $own = [];
    foreach ($verse['words'] as $word) {
        $own[rh_strip_arabic_marks((string) $word)] = true;
    }
    foreach ($first as $decoy) {
        if (trim((string) $decoy) === '') {
            $fail($key . ' has an empty distractor');
        }
        if (isset($own[rh_strip_arabic_marks((string) $decoy)])) {
            $fail($key . ' uses one of its own words as a distractor: ' . $decoy);
        }
    }
    echo '  ' . $key . ' → ' . implode(' · ', $first) . "\n";
}
if ($checked > 0) {
    $ok('checked distractors for ' . $checked . ' verse(s)');
}

// Automatic rub' selection: random but restricted to the latter half of the
// currently memorised range, with a graceful fallback for small pools.
echo "\n== Automatic rub' selection pool ==\n";
$selectionRubs = [
    ['id' => 1, 'end_page' => 5],
    ['id' => 2, 'end_page' => 15],
    ['id' => 3, 'end_page' => 25],
    ['id' => 4, 'end_page' => 35],
    ['id' => 5, 'end_page' => 45],
];
$pool = rh_rub_selection_pool($selectionRubs, 50, 40, 'EXISTING');
$poolIds = array_map(static fn(array $rub): int => (int) $rub['id'], $pool);
if ($poolIds === [3, 4, 5]) {
    $ok('latter-half pool uses rub\'s whose end page is after the midpoint');
} else {
    $fail('latter-half pool = [' . implode(',', $poolIds) . '] (expected [3,4,5])');
}

$pool = rh_rub_selection_pool($selectionRubs, 30, 30, 'EXISTING');
$poolIds = array_map(static fn(array $rub): int => (int) $rub['id'], $pool);
if ($poolIds === [1, 2, 3]) {
    $ok('small latter-half pool falls back to every eligible rub\'');
} else {
    $fail('small-pool fallback = [' . implode(',', $poolIds) . '] (expected [1,2,3])');
}

$pool = rh_rub_selection_pool($selectionRubs, 30, 40, 'EXISTING');
$poolIds = array_map(static fn(array $rub): int => (int) $rub['id'], $pool);
if ($poolIds === [1, 2, 3]) {
    $ok('selection never includes rub\'s beyond the memorisation frontier');
} else {
    $fail('frontier pool = [' . implode(',', $poolIds) . '] (expected [1,2,3])');
}

$pool = rh_rub_selection_pool($selectionRubs, 5, 5, 'EXISTING');
$poolIds = array_map(static fn(array $rub): int => (int) $rub['id'], $pool);
if ($poolIds === [1]) {
    $ok('single-rub memorisation still yields a selection');
} else {
    $fail('single-rub pool = [' . implode(',', $poolIds) . '] (expected [1])');
}

$completeRubs = [
    ['id' => 1, 'end_page' => 100],
    ['id' => 2, 'end_page' => 400],
    ['id' => 3, 'end_page' => 500],
    ['id' => 4, 'end_page' => 600],
];
$pool = rh_rub_selection_pool($completeRubs, 604, 604, 'COMPLETE');
$poolIds = array_map(static fn(array $rub): int => (int) $rub['id'], $pool);
if ($poolIds === [2, 3, 4]) {
    $ok('COMPLETE users use the latter half of the whole Qur\'an');
} else {
    $fail('COMPLETE latter-half pool = [' . implode(',', $poolIds) . '] (expected [2,3,4])');
}

if (count(rh_rub_selection_pool($selectionRubs, 0, 0, 'EXISTING')) === 0) {
    $ok('no consolidated frontier yields no automatic rub\' selection');
} else {
    $fail('selection should be empty when no page has graduated Tikrar Ams');
}

echo "\n";
if ($errors) {
    echo 'FAILED: ' . count($errors) . " problem(s).\n";
    exit(1);
}
echo "ALL CHECKS PASSED\n";
