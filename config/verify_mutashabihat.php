<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Verify the generated mutashabihat lookup.
 *
 * CLI: php config/verify_mutashabihat.php
 * Exit code 0 = every reference is valid, 1 = problems found.
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    echo "CLI only.\n";
    exit;
}

$quranFile  = __DIR__ . '/../web/data/quran-uthmani.json';
$dataFile   = __DIR__ . '/../web/data/mutashabihat.json';

$quran = json_decode((string) file_get_contents($quranFile), true);
$data  = json_decode((string) file_get_contents($dataFile), true);

$errors = [];
if (!is_array($data) || !isset($data['verses']) || !is_array($data['verses'])) {
    fwrite(STDERR, "Invalid mutashabihat.json structure.\n");
    exit(1);
}

$surahCounts = [];
for ($s = 1; $s <= 114; $s++) {
    $surahCounts[$s] = is_array($quran[(string) $s] ?? null) ? count($quran[(string) $s]) : 0;
}

$links = 0;
$max   = 0;
$maxKey = '';
$seen  = [];

foreach ($data['verses'] as $key => $targets) {
    if (!preg_match('/^(\d{1,3}):(\d{1,3})$/', (string) $key, $m)) {
        $errors[] = "Malformed verse key: {$key}";
        continue;
    }
    [$all, $s, $a] = $m;
    $s = (int) $s;
    $a = (int) $a;
    if ($s < 1 || $s > 114 || $a < 1 || $a > ($surahCounts[$s] ?? 0)) {
        $errors[] = "Out-of-range source verse: {$key}";
        continue;
    }
    if (!is_array($targets) || $targets === []) {
        $errors[] = "Empty or invalid target list for {$key}";
        continue;
    }
    $seenTargets = [];
    foreach ($targets as $t) {
        if (!is_array($t) || count($t) !== 2) {
            $errors[] = "Malformed target for {$key}: " . json_encode($t);
            continue;
        }
        [$ts, $ta] = [(int) $t[0], (int) $t[1]];
        $tKey = "{$ts}:{$ta}";
        if ($ts < 1 || $ts > 114 || $ta < 1 || $ta > ($surahCounts[$ts] ?? 0)) {
            $errors[] = "Out-of-range target {$tKey} for {$key}";
            continue;
        }
        if ($ts === $s && $ta === $a) {
            $errors[] = "Self-reference at {$key}";
            continue;
        }
        if (isset($seenTargets[$tKey])) {
            $errors[] = "Duplicate target {$tKey} for {$key}";
        }
        $seenTargets[$tKey] = true;
        $links++;
    }
    $count = count($targets);
    if ($count > $max) {
        $max = $count;
        $maxKey = $key;
    }
    $seen[$key] = true;
}

$verses = count($seen);
$avg = $verses > 0 ? $links / $verses : 0;

echo "Source verses : {$verses}\n";
echo "Links         : {$links}\n";
echo "Average/verse : " . round($avg, 2) . "\n";
echo "Max/verse     : {$max} ({$maxKey})\n";
echo "License       : " . ($data['_meta']['license'] ?? 'missing') . "\n";

if ($max > 8) {
    $errors[] = "A verse has more than 8 suggestions ({$maxKey}: {$max}).";
}

if ($errors) {
    echo "\nErrors:\n";
    foreach (array_slice($errors, 0, 25) as $e) {
        echo " - {$e}\n";
    }
    if (count($errors) > 25) {
        echo ' ... and ' . (count($errors) - 25) . " more\n";
    }
    exit(1);
}

echo "\nOK - all references valid.\n";
