<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Build the mutashabihat (similar-verse) lookup.
 *
 * Combines two sources:
 *   1. The curated CC0 huffaz list in api/data/mutashabihat/source_waqar144.json
 *      (see NOTICE.md). Its absolute ayah numbers are converted to surah:ayah.
 *   2. A computed wording-similarity fallback over web/data/quran-uthmani.json,
 *      so verses the curated list does not cover still get useful suggestions.
 *
 * Candidates are ranked by an IDF-weighted content-word overlap, so shared
 * formulaic endings ("إن الله غفور رحيم") do not outrank real twins. Output is
 * capped at 8 suggestions per verse (the UI shows the first 6).
 *
 * Output: web/data/mutashabihat.json
 *   { "_meta": {...}, "verses": { "2:35": [[7,19],[2,36]], ... } }
 *
 * CLI only:  php config/build_mutashabihat.php [--no-fallback]
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    header('Content-Type: text/plain; charset=utf-8');
    echo "This build script is CLI-only.\n";
    exit;
}

$sourceFile = __DIR__ . '/../api/data/mutashabihat/source_waqar144.json';
$quranFile  = __DIR__ . '/../web/data/quran-uthmani.json';
$outFile    = __DIR__ . '/../web/data/mutashabihat.json';

$useFallback = !in_array('--no-fallback', $argv, true);

foreach ([$sourceFile, $quranFile] as $f) {
    if (!is_readable($f)) {
        fwrite(STDERR, "Missing required file: {$f}\n");
        exit(1);
    }
}

$quran = json_decode((string) file_get_contents($quranFile), true);
if (!is_array($quran)) {
    fwrite(STDERR, "Could not parse {$quranFile}\n");
    exit(1);
}

// ---------------------------------------------------------------------------
// Absolute ayah (1..6236) <-> surah:ayah
// ---------------------------------------------------------------------------

$absoluteToRef = [];   // 1-based absolute => [surah, ayah]
$refToAbsolute = [];   // "s:a" => absolute
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
        $refToAbsolute["{$s}:{$a}"] = $abs;
    }
}

if ($abs !== 6236) {
    fwrite(STDERR, "Expected 6236 ayahs, found {$abs}\n");
    exit(1);
}

/** @return array<int,array{0:int,1:int}> */
function mut_refs(array $verseNumbers): array
{
    global $absoluteToRef;
    $refs = [];
    foreach ($verseNumbers as $n) {
        $n = (int) $n;
        if (isset($absoluteToRef[$n])) {
            $refs[] = $absoluteToRef[$n];
        }
    }
    return $refs;
}

// ---------------------------------------------------------------------------
// Normalisation and IDF-weighted similarity
// ---------------------------------------------------------------------------

/** Strip diacritics and unify the rasm so wording matches visually. */
function mut_normalize(string $text): string
{
    // Quranic marks, harakat, tatweel.
    $t = preg_replace('/[\x{0610}-\x{061A}\x{064B}-\x{065F}\x{0670}\x{06D6}-\x{06ED}\x{0640}]/u', '', $text) ?? $text;
    $t = str_replace(['أ', 'إ', 'آ', 'ٱ'], 'ا', $t);
    $t = str_replace(['ى'], 'ي', $t);
    $t = str_replace(['ة'], 'ه', $t);
    $t = str_replace(['ؤ'], 'و', $t);
    $t = str_replace(['ئ'], 'ي', $t);
    $t = preg_replace('/[^\x{0621}-\x{064A}\s]/u', ' ', $t) ?? $t;
    $t = preg_replace('/\s+/u', ' ', $t) ?? $t;
    return trim($t);
}

/**
 * Function words that carry no semantic similarity on their own.
 * Stored already normalised (no hamza forms, ة -> ه).
 */
$stopWords = array_flip([
    'من', 'في', 'علي', 'الي', 'عن', 'ان', 'ما', 'لا', 'ثم', 'قد',
    'كان', 'كانوا', 'كانت', 'الذين', 'الذي', 'التي', 'يا', 'ايها',
    'كل', 'شي', 'له', 'لهم', 'لها', 'به', 'بها', 'وما', 'ومن', 'وان',
    'وانا', 'فهو', 'هم', 'هي', 'هو', 'انا', 'نحن', 'انتم', 'اذا', 'اذ',
    'واذ', 'قال', 'قالوا', 'قالت', 'لك', 'لكم', 'لنا', 'مع', 'هذا',
    'هذه', 'ذلك', 'تلك', 'اولئك', 'الا', 'ولكن', 'بل', 'فان', 'كذلك',
    'انه', 'اني', 'فيه', 'فيها', 'منه', 'منها', 'عليه', 'عليها',
    'عليهم', 'فلا', 'ولا', 'وقد', 'لقد', 'وكان', 'يكون', 'تكون',
    'يقول', 'يقولون', 'ربنا', 'رب', 'ربك', 'ربكم', 'ربهم', 'الذين',
    'امنوا', 'الذين', 'بين', 'عند', 'لديه', 'لدي', 'الي', 'علي',
    'اليه', 'اليهم', 'فيه', 'بعد', 'قبل', 'حين', 'يوم', 'اذ', 'كلما',
    'كما', 'مما', 'بما', 'لما', 'لهم', 'فيه', 'انهم', 'انكم', 'اننا',
]);

$normText    = [];   // abs => normalised string
$contentSets = [];   // abs => list of unique content words
$wordDf      = [];   // word => number of ayahs containing it

foreach ($absoluteToRef as $id => [$s, $a]) {
    $norm = mut_normalize((string) ($quran[(string) $s][$a - 1] ?? ''));
    // The bundled text prefixes the basmala to the first ayah of most surahs.
    // It is a recitation formula, not evidence that two verses are twins, so
    // strip it before similarity scoring (otherwise every 1:1-like verse
    // matches every other surah opener).
    $norm = preg_replace('/^بسم الله الرحمن الرحيم(?:\s+|$)/u', '', $norm) ?? $norm;
    $normText[$id] = $norm;
    $words = $norm === '' ? [] : explode(' ', $norm);
    $set = [];
    foreach ($words as $w) {
        if ($w === '' || mb_strlen($w) < 2 || isset($stopWords[$w])) {
            continue;
        }
        $set[$w] = true;
    }
    $contentSets[$id] = array_keys($set);
    foreach ($contentSets[$id] as $w) {
        $wordDf[$w] = ($wordDf[$w] ?? 0) + 1;
    }
}

$N = count($contentSets);
$idf = [];
foreach ($wordDf as $w => $df) {
    $idf[$w] = log(($N + 1) / ($df + 0.5));
}
$weight = [];
foreach ($contentSets as $id => $words) {
    $sum = 0.0;
    foreach ($words as $w) {
        $sum += $idf[$w] ?? 0.0;
    }
    $weight[$id] = $sum;
}

/**
 * IDF-weighted overlap: shared rare words / smaller verse weight.
 * 0 = unrelated, 1 = one verse's vocabulary fully contained in the other.
 */
function mut_similarity(int $a, int $b): float
{
    global $contentSets, $idf, $weight;
    if ($a === $b || empty($contentSets[$a]) || empty($contentSets[$b])) {
        return 0.0;
    }
    $setB = array_flip($contentSets[$b]);
    $shared = 0.0;
    foreach ($contentSets[$a] as $w) {
        if (isset($setB[$w])) {
            $shared += $idf[$w] ?? 0.0;
        }
    }
    $denom = min($weight[$a], $weight[$b]);
    return $denom > 0 ? $shared / $denom : 0.0;
}

function mut_distance(int $a, int $b): int
{
    return abs($a - $b);
}

// ---------------------------------------------------------------------------
// 1. Curated pairs (symmetrised)
// ---------------------------------------------------------------------------

$source = json_decode((string) file_get_contents($sourceFile), true);
if (!is_array($source)) {
    fwrite(STDERR, "Could not parse {$sourceFile}\n");
    exit(1);
}

/** @var array<string, array<int,array{0:int,1:int}>> $pairs ref => abs => ref */
$pairs = [];
/** @var array<string, true> $curatedLinks "absA|absB" with absA < absB */
$curatedLinks = [];
$curatedCount = 0;

function mut_add_pair(array &$pairs, array $a, array $b): void
{
    $keyA = $a[0] . ':' . $a[1];
    $keyB = $b[0] . ':' . $b[1];
    if ($keyA === $keyB) {
        return;
    }
    $pairs[$keyA][$b[0] * 1000 + $b[1]] = $b;
    $pairs[$keyB][$a[0] * 1000 + $a[1]] = $a;
}

foreach ($source as $juzEntries) {
    if (!is_array($juzEntries)) {
        continue;
    }
    foreach ($juzEntries as $entry) {
        if (!isset($entry['src']['ayah'], $entry['muts']) || !is_array($entry['muts'])) {
            continue;
        }
        $srcNums = is_array($entry['src']['ayah']) ? $entry['src']['ayah'] : [$entry['src']['ayah']];
        $srcRefs = mut_refs($srcNums);
        $mutRefs = [];
        foreach ($entry['muts'] as $mut) {
            if (!isset($mut['ayah'])) {
                continue;
            }
            $nums = is_array($mut['ayah']) ? $mut['ayah'] : [$mut['ayah']];
            foreach (mut_refs($nums) as $ref) {
                $mutRefs[$ref[0] . ':' . $ref[1]] = $ref;
            }
        }
        foreach ($srcRefs as $a) {
            foreach ($mutRefs as $b) {
                mut_add_pair($pairs, $a, $b);
                $absA = $refToAbsolute[$a[0] . ':' . $a[1]];
                $absB = $refToAbsolute[$b[0] . ':' . $b[1]];
                $curatedLinks[min($absA, $absB) . '|' . max($absA, $absB)] = true;
                $curatedCount++;
            }
        }
    }
}

$curatedVerses = count($pairs);
echo sprintf(
    "Curated: %d links (%d unique) across %d verses\n",
    $curatedCount,
    count($curatedLinks),
    $curatedVerses
);

// ---------------------------------------------------------------------------
// 2. Computed fallback: shared 3-word shingles + IDF overlap
// ---------------------------------------------------------------------------

if ($useFallback) {
    $t0 = microtime(true);

    $shingleIndex = [];   // shingle => list of absolute ids
    $ayahShingles = [];   // absolute id => list of shingles

    foreach ($absoluteToRef as $id => [$s, $a]) {
        $norm = $normText[$id] ?? '';
        if ($norm === '') {
            continue;
        }
        $words = explode(' ', $norm);
        $n = count($words);
        if ($n < 2) {
            continue;
        }
        $size = $n >= 3 ? 3 : 2;
        $set = [];
        for ($i = 0; $i + $size <= $n; $i++) {
            $set[implode(' ', array_slice($words, $i, $size))] = true;
        }
        $ayahShingles[$id] = array_keys($set);
        foreach ($ayahShingles[$id] as $sh) {
            $shingleIndex[$sh][] = $id;
        }
    }

    // Very common formulas ("يا أيها الذين آمنوا"...) are not distinctive.
    $maxDf = 60;
    $candidates = [];

    foreach ($ayahShingles as $id => $shingles) {
        $tally = [];
        foreach ($shingles as $sh) {
            $docs = $shingleIndex[$sh] ?? [];
            $df = count($docs);
            if ($df < 2 || $df > $maxDf) {
                continue;
            }
            foreach ($docs as $other) {
                if ($other === $id) {
                    continue;
                }
                $tally[$other] = ($tally[$other] ?? 0) + 1;
            }
        }
        if (!$tally) {
            continue;
        }

        $ownCount = count($shingles);
        $scored = [];
        foreach ($tally as $other => $shared) {
            if ($shared < 2) {
                continue;
            }
            // Adjacent verses are a transition/linking mistake, not a twin.
            if (abs($id - (int) $other) <= 2) {
                continue;
            }
            $otherCount = count($ayahShingles[$other] ?? []);
            if ($otherCount < 2) {
                continue;
            }
            $shingleScore = $shared / max(1, min($ownCount, $otherCount));
            if ($shingleScore < 0.5) {
                continue;
            }
            $sim = mut_similarity($id, (int) $other);
            if ($sim < 0.45) {
                continue;
            }
            $scored[] = ['id' => (int) $other, 'sim' => $sim, 'shingle' => $shingleScore];
        }
        if (!$scored) {
            continue;
        }
        usort($scored, static function (array $x, array $y): int {
            if ($x['sim'] !== $y['sim']) {
                return $y['sim'] <=> $x['sim'];
            }
            return $y['shingle'] <=> $x['shingle'];
        });
        $candidates[$id] = array_slice($scored, 0, 3);
    }

    $fallbackAdded = 0;
    foreach ($candidates as $id => $list) {
        $a = $absoluteToRef[$id];
        foreach ($list as $hit) {
            $b = $absoluteToRef[$hit['id']];
            $before = count($pairs[$a[0] . ':' . $a[1]] ?? []);
            mut_add_pair($pairs, $a, $b);
            $after = count($pairs[$a[0] . ':' . $a[1]] ?? []);
            if ($after > $before) {
                $fallbackAdded++;
            }
        }
    }

    echo sprintf(
        "Fallback: %d computed links over %d candidate verses (%.1fs)\n",
        $fallbackAdded,
        count($candidates),
        microtime(true) - $t0
    );
}

// ---------------------------------------------------------------------------
// 3. Rank, dedupe identical texts, cap, and write compact JSON
// ---------------------------------------------------------------------------

$verses = [];

foreach ($pairs as $key => $targets) {
    [$s, $a] = array_map('intval', explode(':', $key));
    $sourceId = $refToAbsolute[$key] ?? null;
    if ($sourceId === null) {
        continue;
    }

    $seenText = [];
    $ranked = [];

    foreach ($targets as $ref) {
        $targetKey = $ref[0] . ':' . $ref[1];
        $targetId = $refToAbsolute[$targetKey] ?? null;
        if ($targetId === null || $targetId === $sourceId) {
            continue;
        }
        $sim = mut_similarity($sourceId, $targetId);
        $text = $normText[$targetId] ?? '';
        $curated = isset($curatedLinks[min($sourceId, $targetId) . '|' . max($sourceId, $targetId)]);
        $dist = mut_distance($sourceId, $targetId);

        // Repeated refrains (e.g. "فبأي آلاء ربكما تكذبان") are identical, not
        // confusable: keep only the nearest occurrence of each distinct text.
        if ($text !== '' && isset($seenText[$text])) {
            $existingIdx = $seenText[$text];
            if ($dist < $ranked[$existingIdx]['dist']) {
                $ranked[$existingIdx] = [
                    'ref' => $ref, 'sim' => $sim, 'curated' => $curated, 'dist' => $dist,
                ];
            }
            continue;
        }
        if ($text !== '') {
            $seenText[$text] = count($ranked);
        }
        $ranked[] = ['ref' => $ref, 'sim' => $sim, 'curated' => $curated, 'dist' => $dist];
    }

    usort($ranked, static function (array $x, array $y): int {
        if ($x['sim'] !== $y['sim']) {
            return $y['sim'] <=> $x['sim'];
        }
        if ($x['curated'] !== $y['curated']) {
            return $y['curated'] ? -1 : 1;
        }
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
        'source'  => 'Waqar144/Quran_Mutashabihat_Data (CC0-1.0) + computed wording similarity',
        'license' => 'CC0-1.0',
        'built'   => date('Y-m-d'),
        'format'  => 'verses["surah:ayah"] = [[surah, ayah], ...]',
    ],
    'verses' => $verses,
];

$json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
if ($json === false) {
    fwrite(STDERR, 'Failed to encode JSON: ' . json_last_error_msg() . "\n");
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
    "Wrote %s (%d verses, %d links, %.1f KB)\n",
    $outFile,
    count($verses),
    $linkCount,
    strlen($json) / 1024
);
