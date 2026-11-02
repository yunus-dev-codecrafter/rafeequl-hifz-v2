<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Build the per-page Mushaf metadata.
 *
 * The reader needs the juz / hizb / rub' of every Madinah page. That data
 * already exists in api/data/madinah_pages.json, but that file is denied over
 * HTTP and carries fields the reader does not need. This script emits a small
 * client-side table:
 *
 * Output: web/data/mushaf_meta.json
 *   { "_meta": { "source": ..., "count": 604 },
 *     "pages": [ [juz, hizb, rub], ... ] }   // index = page - 1
 *
 * `rub` is the absolute rub' al-hizb number (1..240). The source field
 * `rub_el_hizb` is 1..4 within the current hizb, so it is converted here.
 *
 * CLI only:  php config/build_mushaf_meta.php
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    header('Content-Type: text/plain; charset=utf-8');
    echo "This build script is CLI-only.\n";
    exit;
}

$sourceFile = __DIR__ . '/../api/data/madinah_pages.json';
$outFile    = __DIR__ . '/../web/data/mushaf_meta.json';

if (!is_readable($sourceFile)) {
    fwrite(STDERR, "Missing required file: {$sourceFile}\n");
    exit(1);
}

$raw = file_get_contents($sourceFile);
$pages = is_string($raw) ? json_decode($raw, true) : null;

if (!is_array($pages) || count($pages) !== 604) {
    fwrite(STDERR, "Expected 604 page records in {$sourceFile}\n");
    exit(1);
}

$rows = [];
$errors = [];
$prev = [0, 0, 0];

foreach ($pages as $index => $page) {
    $expected = $index + 1;
    $number    = (int) ($page['page_number'] ?? 0);
    $juz       = (int) ($page['juz_number'] ?? 0);
    $hizb      = (int) ($page['hizb_number'] ?? 0);
    $rubInHizb = (int) ($page['rub_el_hizb'] ?? 0);
    $rub       = (($hizb - 1) * 4) + $rubInHizb;

    if ($number !== $expected) {
        $errors[] = "row {$expected}: page_number is {$number}";
    }
    if ($juz < 1 || $juz > 30) {
        $errors[] = "page {$expected}: juz {$juz} out of range";
    }
    if ($hizb < 1 || $hizb > 60) {
        $errors[] = "page {$expected}: hizb {$hizb} out of range";
    }
    if ($rubInHizb < 1 || $rubInHizb > 4) {
        $errors[] = "page {$expected}: rub_el_hizb {$rubInHizb} out of range";
    }
    if ($rub < 1 || $rub > 240) {
        $errors[] = "page {$expected}: absolute rub {$rub} out of range";
    }
    if ($juz < $prev[0] || $hizb < $prev[1] || $rub < $prev[2]) {
        $errors[] = "page {$expected}: juz/hizb/rub goes backwards";
    }

    $prev = [$juz, $hizb, $rub];
    $rows[] = [$juz, $hizb, $rub];
}

if ($errors) {
    fwrite(STDERR, "Refusing to write mushaf_meta.json:\n  - " . implode("\n  - ", $errors) . "\n");
    exit(1);
}

$payload = [
    '_meta' => [
        'source' => 'api/data/madinah_pages.json',
        'count'  => count($rows),
    ],
    'pages' => $rows,
];

$json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
if (!is_string($json)) {
    fwrite(STDERR, "Could not encode mushaf_meta.json\n");
    exit(1);
}

if (file_put_contents($outFile, $json) === false) {
    fwrite(STDERR, "Could not write {$outFile}\n");
    exit(1);
}

echo "Wrote " . count($rows) . " pages to web/data/mushaf_meta.json\n";
echo "Page 1: juz {$rows[0][0]}, hizb {$rows[0][1]}, rub {$rows[0][2]}\n";
$last = $rows[count($rows) - 1];
echo "Page 604: juz {$last[0]}, hizb {$last[1]}, rub {$last[2]}\n";
