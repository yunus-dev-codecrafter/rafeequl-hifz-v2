<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Build the VERIFIED (curated) mutashabihat lookup.
 *
 * `config/build_mutashabihat.php` writes the app-facing suggestion file, which
 * mixes the CC0 huffaz list with a computed wording-similarity fallback. The
 * Rub' Consolidation "المتشابهات" exercise must never invent a comparison, so
 * it uses this separate file: curated links only.
 *
 * Output format is identical to web/data/mutashabihat.json:
 *   { "_meta": {...}, "verses": { "2:35": [[7,19],[2,36]], ... } }
 *
 * CLI only: php config/build_mutashabihat_curated.php
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    header('Content-Type: text/plain; charset=utf-8');
    echo "This build script is CLI-only.\n";
    exit;
}

$sourceFile = __DIR__ . '/../api/data/mutashabihat/source_waqar144.json';
$quranFile  = __DIR__ . '/../web/data/quran-uthmani.json';
$outFile    = __DIR__ . '/../web/data/mutashabihat_curated.json';

foreach ([$sourceFile, $quranFile] as $file) {
    if (!is_readable($file)) {
        fwrite(STDERR, "Missing required file: {$file}\n");
        exit(1);
    }
}

$quran = json_decode((string) file_get_contents($quranFile), true);
if (!is_array($quran)) {
    fwrite(STDERR, "Could not parse {$quranFile}\n");
    exit(1);
}

// Absolute ayah (1..6236) <-> surah:ayah.
$absoluteToRef = [];
$refToAbsolute = [];
$abs = 0;
for ($s = 1; $s <= 114; $s++) {
    $ayahs = $quran[(string) $s] ?? null;
    if (!is_array($ayahs)) {
        fwrite(STDERR, "Quran bundle is missing surah {$s}\n");
        exit(1);
    }
    foreach ($ayahs as $i => $text) {
        $abs++;
        $a = $i + 1;
        $absoluteToRef[$abs] = [$s, $a];
        $refToAbsolute[$s . ':' . $a] = $abs;
    }
}

if ($abs !== 6236) {
    fwrite(STDERR, "Expected 6236 ayahs, found {$abs}\n");
    exit(1);
}

/** @return array<int,array{0:int,1:int}> */
function mutc_refs(array $verseNumbers, array $absoluteToRef): array
{
    $refs = [];
    foreach ($verseNumbers as $n) {
        $n = (int) $n;
        // The upstream JSON stores absolute ayah numbers zero-based (its
        // txt_to_json.dart adds the surah offset to ayah-1). Shift by one to
        // land on the standard 1..6236 Hafs index used by this app.
        $standard = $n + 1;
        if (isset($absoluteToRef[$standard])) {
            $refs[] = $absoluteToRef[$standard];
        }
    }
    return $refs;
}

$source = json_decode((string) file_get_contents($sourceFile), true);
if (!is_array($source)) {
    fwrite(STDERR, "Could not parse {$sourceFile}\n");
    exit(1);
}

/** @var array<string,array<string,array{0:int,1:int}>> $pairs */
$pairs = [];

$addPair = static function (array &$pairs, array $a, array $b): void {
    $keyA = $a[0] . ':' . $a[1];
    $keyB = $b[0] . ':' . $b[1];
    if ($keyA === $keyB) {
        return;
    }
    $pairs[$keyA][$keyB] = $b;
    $pairs[$keyB][$keyA] = $a;
};

foreach ($source as $juzEntries) {
    if (!is_array($juzEntries)) {
        continue;
    }
    foreach ($juzEntries as $entry) {
        if (!isset($entry['src']['ayah'], $entry['muts']) || !is_array($entry['muts'])) {
            continue;
        }
        $srcNums = is_array($entry['src']['ayah']) ? $entry['src']['ayah'] : [$entry['src']['ayah']];
        $srcRefs = mutc_refs($srcNums, $absoluteToRef);
        $mutRefs = [];
        foreach ($entry['muts'] as $mut) {
            if (!isset($mut['ayah'])) {
                continue;
            }
            $nums = is_array($mut['ayah']) ? $mut['ayah'] : [$mut['ayah']];
            foreach (mutc_refs($nums, $absoluteToRef) as $ref) {
                $mutRefs[$ref[0] . ':' . $ref[1]] = $ref;
            }
        }
        foreach ($srcRefs as $a) {
            foreach ($mutRefs as $b) {
                $addPair($pairs, $a, $b);
            }
        }
    }
}

ksort($pairs);

$verses = [];
foreach ($pairs as $key => $targets) {
    $sourceId = $refToAbsolute[$key] ?? null;
    if ($sourceId === null) {
        continue;
    }

    $ranked = [];
    foreach ($targets as $targetKey => $ref) {
        $targetId = $refToAbsolute[$targetKey] ?? null;
        if ($targetId === null || $targetId === $sourceId) {
            continue;
        }
        $ranked[] = [
            'ref'  => $ref,
            'dist' => abs($sourceId - $targetId),
        ];
    }

    usort($ranked, static function (array $x, array $y): int {
        return $x['dist'] <=> $y['dist'];
    });

    $verses[$key] = array_map(
        static fn(array $row): array => $row['ref'],
        array_slice($ranked, 0, 8)
    );
}

ksort($verses);

$payload = [
    '_meta' => [
        'source'  => 'Waqar144/Quran_Mutashabihat_Data (CC0-1.0) - curated links only',
        'license' => 'CC0-1.0',
        'built'   => date('Y-m-d'),
        'format'  => 'verses["surah:ayah"] = [[surah, ayah], ...]',
    ],
    'verses' => $verses,
];

$json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
if ($json === false) {
    fwrite(STDERR, 'Failed to encode: ' . json_last_error_msg() . "\n");
    exit(1);
}

if (!is_dir(dirname($outFile))) {
    mkdir(dirname($outFile), 0775, true);
}
file_put_contents($outFile, $json);

$linkCount = 0;
foreach ($verses as $list) {
    $linkCount += count($list);
}

printf(
    "Wrote %s (%d verses, %d curated links, %.1f KB)\n",
    $outFile,
    count($verses),
    $linkCount,
    strlen($json) / 1024
);
