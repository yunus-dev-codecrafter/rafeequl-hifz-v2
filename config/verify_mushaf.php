<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - sanity checks for the native Mushaf reader data.
 *
 * Verifies the 604-page verse map, the Uthmani text bundle and the compact
 * per-page metadata emitted by config/build_mushaf_meta.php.
 *
 * Run: php config/verify_mushaf.php
 * Exits non-zero if anything is inconsistent.
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    header('Content-Type: text/plain; charset=utf-8');
    echo "This verification script is CLI-only.\n";
    exit;
}

$root = __DIR__ . '/..';
$pagesFile = $root . '/web/js/madinah_page_verses.json';
$quranFile = $root . '/web/data/quran-uthmani.json';
$metaFile  = $root . '/web/data/mushaf_meta.json';
$sourceFile = $root . '/api/data/madinah_pages.json';

$errors = [];
$ok = static function (string $msg): void {
    echo "  ✓ " . $msg . "\n";
};
$fail = static function (string $msg) use (&$errors): void {
    $errors[] = $msg;
    echo "  ✗ " . $msg . "\n";
};

$load = static function (string $file) {
    if (!is_readable($file)) {
        return null;
    }
    $raw = file_get_contents($file);
    return is_string($raw) ? json_decode($raw, true) : null;
};

echo "== Mushaf reader data verification ==\n";

$pages = $load($pagesFile);
$quran = $load($quranFile);
$meta  = $load($metaFile);
$source = $load($sourceFile);

if (!is_array($pages)) {
    $fail('missing or invalid web/js/madinah_page_verses.json');
    $pages = [];
} else {
    $ok('page map loaded');
}

if (!is_array($quran)) {
    $fail('missing or invalid web/data/quran-uthmani.json');
    $quran = [];
} else {
    $ok('Qur\'an text loaded');
}

if (!is_array($meta) || !isset($meta['pages']) || !is_array($meta['pages'])) {
    $fail('missing or invalid web/data/mushaf_meta.json (run config/build_mushaf_meta.php)');
    $meta = ['pages' => []];
} else {
    $ok('page metadata loaded');
}

if (!is_array($source)) {
    $fail('missing or invalid api/data/madinah_pages.json');
    $source = [];
}

/* ---------------- Text bundle ---------------- */

if (count($quran) === 114) {
    $ok('114 surahs in the text bundle');
} else {
    $fail('text bundle has ' . count($quran) . ' surahs (expected 114)');
}

$ayahTotal = 0;
foreach ($quran as $arr) {
    $ayahTotal += is_array($arr) ? count($arr) : 0;
}
if ($ayahTotal === 6236) {
    $ok('6,236 ayat in the text bundle');
} else {
    $fail('text bundle has ' . $ayahTotal . ' ayat (expected 6,236)');
}

/* ---------------- Page map ---------------- */

if (count($pages) === 604) {
    $ok('604 pages in the page map');
} else {
    $fail('page map has ' . count($pages) . ' pages (expected 604)');
}

$seen = [];
$duplicates = 0;
$badRanges = 0;
$covered = 0;

foreach ($pages as $index => $sections) {
    $pageNo = $index + 1;
    if (!is_array($sections) || !$sections) {
        $fail('page ' . $pageNo . ' has no sections');
        continue;
    }

    foreach ($sections as $section) {
        if (!is_array($section) || count($section) < 3) {
            $fail('page ' . $pageNo . ' has a malformed section');
            continue;
        }
        [$surah, $from, $to] = [(int) $section[0], (int) $section[1], (int) $section[2]];
        if ($surah < 1 || $surah > 114 || $from < 1 || $to < $from) {
            $badRanges++;
            $fail('page ' . $pageNo . ' has an invalid range ' . $surah . ':' . $from . '-' . $to);
            continue;
        }
        for ($ayah = $from; $ayah <= $to; $ayah++) {
            $key = $surah . ':' . $ayah;
            if (isset($seen[$key])) {
                $duplicates++;
                continue;
            }
            $seen[$key] = $pageNo;
            $covered++;
        }
    }
}

if ($badRanges === 0) {
    $ok('every page range is valid');
}
if ($duplicates === 0) {
    $ok('no ayah appears on two pages');
} else {
    $fail($duplicates . ' duplicate ayah references in the page map');
}
if ($covered === 6236) {
    $ok('all 6,236 ayat are covered exactly once');
} else {
    $fail($covered . ' ayat covered (expected 6,236)');
}

if (($pages[0] ?? null) === [[1, 1, 7]]) {
    $ok('page 1 is Al-Fatiha 1:1-7');
} else {
    $fail('page 1 does not match [[1,1,7]]');
}

$expectedLast = [[112, 1, 4], [113, 1, 5], [114, 1, 6]];
if (($pages[603] ?? null) === $expectedLast) {
    $ok('page 604 is Al-Ikhlas, Al-Falaq and An-Nas');
} else {
    $fail('page 604 does not match ' . json_encode($expectedLast));
}

$surahStarts = [];
foreach ($pages as $sections) {
    foreach ($sections as $section) {
        if ((int) $section[1] === 1) {
            $surahStarts[(int) $section[0]] = true;
        }
    }
}
$missingStarts = [];
for ($s = 1; $s <= 114; $s++) {
    if (!isset($surahStarts[$s])) {
        $missingStarts[] = $s;
    }
}
if (!$missingStarts) {
    $ok('every surah starts at a page section boundary');
} else {
    $fail('surahs without a 1:1 section start: ' . implode(', ', $missingStarts));
}

/* ---------------- Basmala rules ---------------- */

$basmala = 'بِسْمِ';
$fatiha = (string) ($quran['1'][0] ?? '');
$baqarah = (string) ($quran['2'][0] ?? '');
$tawbah = (string) ($quran['9'][0] ?? '');

if (mb_strpos($fatiha, $basmala) === 0) {
    $ok('Al-Fatiha 1:1 is the basmala');
} else {
    $fail('Al-Fatiha 1:1 does not start with the basmala');
}
if (mb_strpos($baqarah, $basmala) === false) {
    $ok('Al-Baqarah 2:1 is not prefixed with the basmala');
} else {
    $fail('Al-Baqarah 2:1 unexpectedly contains the basmala');
}
if (mb_strpos($tawbah, $basmala) === false) {
    $ok('At-Tawbah 9:1 has no basmala');
} else {
    $fail('At-Tawbah 9:1 unexpectedly contains the basmala');
}

/* ---------------- Per-page metadata ---------------- */

$rows = $meta['pages'];
if (count($rows) === 604) {
    $ok('604 rows in mushaf_meta.json');
} else {
    $fail('mushaf_meta.json has ' . count($rows) . ' rows (expected 604)');
}

$metaErrors = 0;
if (is_array($source) && count($source) === 604) {
    foreach ($source as $index => $page) {
        $expected = [
            (int) ($page['juz_number'] ?? 0),
            (int) ($page['hizb_number'] ?? 0),
            (((int) ($page['hizb_number'] ?? 0)) - 1) * 4 + (int) ($page['rub_el_hizb'] ?? 0),
        ];
        $actual = $rows[$index] ?? null;
        if (!is_array($actual) || array_map('intval', $actual) !== $expected) {
            $metaErrors++;
            if ($metaErrors <= 5) {
                $fail('meta row ' . ($index + 1) . ' is ' . json_encode($actual) . ' (expected ' . json_encode($expected) . ')');
            }
        }
    }
} else {
    $fail('api/data/madinah_pages.json does not have 604 rows');
}

if ($metaErrors === 0) {
    $ok('mushaf_meta.json matches api/data/madinah_pages.json');
}

if (($rows[0] ?? null) === [1, 1, 1]) {
    $ok('page 1 metadata is juz 1 / hizb 1 / rub 1');
} else {
    $fail('page 1 metadata is ' . json_encode($rows[0] ?? null));
}
if (($rows[603] ?? null) === [30, 60, 240]) {
    $ok('page 604 metadata is juz 30 / hizb 60 / rub 240');
} else {
    $fail('page 604 metadata is ' . json_encode($rows[603] ?? null));
}

/* ---------------- Result ---------------- */

echo "\n";
if ($errors) {
    echo "FAILED with " . count($errors) . " error(s).\n";
    exit(1);
}

echo "All Mushaf reader data checks passed.\n";
exit(0);
