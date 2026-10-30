<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz — sanity checks for the rub' catalog + station splitter.
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
$totalStations = 0;
$totalVerses = 0;

for ($id = 1; $id <= 240; $id++) {
    $rub = $rubs[$id] ?? null;
    if ($rub === null) {
        $fail('missing rub ' . $id);
        continue;
    }

    $payload = rh_rub_verses($id);
    if ($payload['rub'] === null) {
        $fail('could not expand rub ' . $id);
        continue;
    }

    $count = count($payload['verses']);
    $stations = 0;
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

        if ($verse['segments_total'] < 1) {
            $fail('verse ' . $key . ' has no segment');
        }
        if ($verse['segments_total'] !== count($verse['segments'])) {
            $fail('verse ' . $key . ' segments_total does not match its segment list');
        }
        foreach ($verse['segments'] as $i => $segment) {
            if (trim((string) $segment['text']) === '') {
                $fail('verse ' . $key . ' has an empty station #' . $i);
            }
            if (!rh_has_recitable_content(rh_codepoints((string) $segment['text']))) {
                $fail('verse ' . $key . ' has a mark-only station #' . $i);
            }
            if ((int) $segment['index'] !== $i) {
                $fail('verse ' . $key . ' station #' . $i . ' has index ' . $segment['index']);
            }
            if ($segment['stop'] !== null && !in_array($segment['stop'], ['salli', 'qala', 'lazim', 'jaiz', 'muanaqah', 'saktah'], true)) {
                $fail('verse ' . $key . ' has unknown stop type ' . $segment['stop']);
            }
        }
        $stations += $verse['segments_total'];
    }

    if ($count !== (int) $rub['verse_count']) {
        $fail('rub ' . $id . ' verse_count mismatch (' . $count . ' vs ' . $rub['verse_count'] . ')');
    }
    if ($stations !== (int) $rub['segments_total']) {
        $fail('rub ' . $id . ' segments_total mismatch (' . $stations . ' vs ' . $rub['segments_total'] . ')');
    }

    $totalVerses += $count;
    $totalStations += $stations;
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

$ok('stop stations: ' . $totalStations . ' (avg ' . round($totalStations / 240, 1) . ' / rub)');

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

// Splitter behaviour on a few known verses.
echo "\n== Stop-station splitter spot checks ==\n";
$samples = [[2, 26], [2, 44], [1, 1], [36, 52], [114, 6]];
foreach ($samples as [$s, $a]) {
    $text = rh_verse_text($quran, $s, $a);
    $split = rh_split_verse($text);
    $stops = array_map(static function (array $seg): string {
        return $seg['stop'] ?? 'end';
    }, $split['segments']);
    echo '  ' . $s . ':' . $a . ' → ' . count($split['segments']) . ' station(s) [' . implode(', ', $stops) . "]\n";
    foreach ($split['segments'] as $i => $seg) {
        if (trim($seg['text']) === '') {
            $fail($s . ':' . $a . ' empty station #' . $i);
        }
    }
}

// Every waqf sign except "لا" must always split.
$mustSplit = ["\u{06D6}", "\u{06D7}", "\u{06D8}", "\u{06DA}", "\u{06DB}", "\u{06DC}"];
foreach ($mustSplit as $mark) {
    $sample = 'بِسْمِ اللَّهِ ' . $mark . ' الرَّحْمَٰنِ الرَّحِيمِ';
    $split = rh_split_verse($sample);
    if (count($split['segments']) === 2) {
        $ok('mark ' . $mark . ' splits into 2 stations');
    } else {
        $fail('mark ' . $mark . ' produced ' . count($split['segments']) . ' station(s)');
    }
}

// Mu'anaqah pair: only the first sign stops.
$pair = 'الأول ' . "\u{06DB}" . ' الثاني ' . "\u{06DB}" . ' الثالث';
$split = rh_split_verse($pair);
if (count($split['segments']) === 2) {
    $ok('mu‘anaqah pair splits once');
} else {
    $fail('mu‘anaqah pair produced ' . count($split['segments']) . ' stations');
}

// Consecutive stop signs with no words between them must not create a
// station made only of marks.
$adjacent = 'الأول ' . "\u{06DC} \u{06D7}" . ' الثاني';
$split = rh_split_verse($adjacent);
$markOnly = false;
foreach ($split['segments'] as $seg) {
    if (!rh_has_recitable_content(rh_codepoints($seg['text']))) {
        $markOnly = true;
    }
}
if (count($split['segments']) === 2 && !$markOnly) {
    $ok('adjacent stop signs merge into one station');
} else {
    $fail('adjacent stop signs produced ' . count($split['segments']) . ' station(s)');
}

// The "لا" (do not stop) sign must NOT split.
foreach (["\u{06D9}"] as $mark) {
    $sample = 'كلمة ' . $mark . ' أخرى';
    $split = rh_split_verse($sample);
    if (count($split['segments']) === 1) {
        $ok('mark ' . $mark . ' stays inside one station');
    } else {
        $fail('mark ' . $mark . ' wrongly split');
    }
}

echo "\n";
if ($errors) {
    echo 'FAILED: ' . count($errors) . " problem(s).\n";
    exit(1);
}
echo "ALL CHECKS PASSED\n";
