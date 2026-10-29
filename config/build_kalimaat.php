<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Build the kalimaat (word meanings) catalog.
 *
 * Source: Quranpedia.net "meanings" dump. It bundles per-ayah Arabic word
 * explanations from four classical/contemporary books:
 *   491  السراج في بيان غريب القرآن
 *   1424 كلمات القرآن
 *   327  التبيان في تفسير غريب القرآن
 *   208  تذكرة الأريب في تفسير الغريب
 *
 * The first book wins when the same word is explained by more than one book.
 * Entries longer than --max-words are skipped so the card stays a word or a
 * short Qur'anic expression (the source's unit of meaning is often a phrase).
 *
 * Output: web/data/kalimaat/
 *   meta.json          - metadata, per-page counts, page -> juz map
 *   juz/1.json ...     - cards for each juz, sorted by page/ayah
 *
 * CLI only:
 *   php config/build_kalimaat.php
 *   php config/build_kalimaat.php --source=C:\path\meanings.json.gz
 *   php config/build_kalimaat.php --max-words=1
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    header('Content-Type: text/plain; charset=utf-8');
    echo "This build script is CLI-only.\n";
    exit;
}

const KAL_SOURCE_URL = 'https://api.quranpedia.net/dumps/meanings.json.gz';
const KAL_DEFAULT_BOOKS = [491, 1424, 327, 208];
const KAL_MAX_WORDS_DEFAULT = 3;

$root = dirname(__DIR__);
$pagesFile = $root . '/web/js/madinah_page_verses.json';
$metaPagesFile = $root . '/api/data/madinah_pages.json';
$outDir = $root . '/web/data/kalimaat';

$options = [
    'source' => KAL_SOURCE_URL,
    'out' => $outDir,
    'max-words' => KAL_MAX_WORDS_DEFAULT,
    'books' => KAL_DEFAULT_BOOKS,
];

foreach (array_slice($argv, 1) as $arg) {
    if (str_starts_with($arg, '--source=')) {
        $options['source'] = substr($arg, 9);
    } elseif (str_starts_with($arg, '--out=')) {
        $options['out'] = substr($arg, 6);
    } elseif (str_starts_with($arg, '--max-words=')) {
        $options['max-words'] = max(1, (int) substr($arg, 12));
    } elseif (str_starts_with($arg, '--books=')) {
        $books = [];
        foreach (explode(',', substr($arg, 8)) as $b) {
            $b = (int) trim($b);
            if ($b > 0) $books[] = $b;
        }
        if ($books) $options['books'] = array_values(array_unique($books));
    } elseif ($arg === '--help' || $arg === '-h') {
        echo "Usage: php config/build_kalimaat.php [--source=PATH] [--out=PATH] [--max-words=3] [--books=491,1424,327,208]\n";
        exit(0);
    } else {
        fwrite(STDERR, "Unknown option: {$arg}\n");
        exit(2);
    }
}

if (!is_readable($pagesFile)) {
    fwrite(STDERR, "Missing page map: {$pagesFile}\n");
    exit(1);
}

$pageMap = json_decode((string) file_get_contents($pagesFile), true);
if (!is_array($pageMap) || count($pageMap) !== 604) {
    fwrite(STDERR, "Could not parse the 604-page map: {$pagesFile}\n");
    exit(1);
}

/** Read a URL or a local file. Handles .gz transparently. */
function kal_read_source(string $source): string
{
    $isUrl = preg_match('#^https?://#i', $source) === 1;
    $tmp = null;

    if ($isUrl) {
        $tmp = tempnam(sys_get_temp_dir(), 'rh_kal_');
        if ($tmp === false) {
            throw new RuntimeException('Could not create a temporary file.');
        }
        $fh = fopen($tmp, 'wb');
        if ($fh === false) {
            throw new RuntimeException('Could not open a temporary file for writing.');
        }

        if (function_exists('curl_init')) {
            $ch = curl_init($source);
            curl_setopt_array($ch, [
                CURLOPT_FILE => $fh,
                CURLOPT_FOLLOWLOCATION => true,
                CURLOPT_CONNECTTIMEOUT => 20,
                CURLOPT_TIMEOUT => 180,
                CURLOPT_USERAGENT => 'RafeequlHifz/1.0 kalimaat-builder',
            ]);
            $ok = curl_exec($ch);
            $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
            $error = curl_error($ch);
            curl_close($ch);
            fclose($fh);
            if (!$ok || $status >= 400) {
                @unlink($tmp);
                throw new RuntimeException("Download failed ({$status}): {$error}");
            }
        } else {
            $ctx = stream_context_create([
                'http' => [
                    'timeout' => 180,
                    'user_agent' => 'RafeequlHifz/1.0 kalimaat-builder',
                    'follow_location' => 1,
                ],
            ]);
            $data = @file_get_contents($source, false, $ctx);
            fclose($fh);
            if ($data === false) {
                @unlink($tmp);
                throw new RuntimeException('Download failed. Enable curl or allow_url_fopen.');
            }
            file_put_contents($tmp, $data);
        }
    } else {
        $tmp = $source;
    }

    if (!is_readable($tmp)) {
        throw new RuntimeException("Source is not readable: {$source}");
    }

    $raw = (string) file_get_contents($tmp);
    if (str_ends_with(strtolower(parse_url($source, PHP_URL_PATH) ?: $source), '.gz')
        || str_starts_with($raw, "\x1f\x8b")) {
        $decoded = @gzdecode($raw);
        if ($decoded === false) {
            throw new RuntimeException('Could not decompress the source gzip file.');
        }
        $raw = $decoded;
    }

    if ($isUrl && is_file($tmp)) {
        @unlink($tmp);
    }

    return $raw;
}

/**
 * Normalise a word for de-duplication and stable IDs. This is never shown.
 */
function kal_normalize(string $text): string
{
    $t = preg_replace('/[\x{0610}-\x{061A}\x{064B}-\x{065F}\x{0670}\x{06D6}-\x{06ED}\x{0640}]/u', '', $text) ?? $text;
    $t = str_replace(['أ', 'إ', 'آ', 'ٱ'], 'ا', $t);
    $t = str_replace(['ى'], 'ي', $t);
    $t = str_replace(['ة'], 'ه', $t);
    $t = preg_replace('/[\x{060C}\x{061B}\x{061F}\x{066A}-\x{066D}\x{06D4}]/u', ' ', $t) ?? $t;
    $t = preg_replace('/\s+/u', ' ', $t) ?? $t;
    return trim($t);
}

/** Turn "word" into "expression" if it contains more than one token. */
function kal_kind(string $text): string
{
    $parts = preg_split('/\s+/u', trim($text)) ?: [];
    return count($parts) > 1 ? 'expression' : 'word';
}

/** Strip HTML and normalise whitespace while preserving the Arabic text. */
function kal_clean(string $text): string
{
    $text = html_entity_decode(strip_tags($text), ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $text = preg_replace('/\s+/u', ' ', $text) ?? $text;
    return trim($text);
}

try {
    fwrite(STDERR, "Reading kalimaat source...\n");
    $json = json_decode(kal_read_source($options['source']), true);
} catch (Throwable $e) {
    fwrite(STDERR, $e->getMessage() . "\n");
    exit(1);
}

if (!is_array($json) || !isset($json['data']) || !is_array($json['data'])) {
    fwrite(STDERR, "Unexpected meanings JSON structure.\n");
    exit(1);
}

// Build a fast surah:ayah -> page lookup from the 604-page Madinah map.
$pageByRef = [];
foreach ($pageMap as $idx => $ranges) {
    $page = $idx + 1;
    foreach ((array) $ranges as $range) {
        if (!is_array($range) || count($range) < 3) continue;
        [$surah, $from, $to] = [(int) $range[0], (int) $range[1], (int) $range[2]];
        for ($a = $from; $a <= $to; $a++) {
            $pageByRef["{$surah}:{$a}"] = $page;
        }
    }
}

$books = array_fill_keys(array_map('intval', $options['books']), true);
$maxWords = (int) $options['max-words'];

// Page -> juz is used to shard the catalog into 30 loadable files.
$juzByPage = [];
if (is_readable($metaPagesFile)) {
    $pageMeta = json_decode((string) file_get_contents($metaPagesFile), true);
    if (is_array($pageMeta)) {
        foreach ($pageMeta as $row) {
            $p = (int) ($row['page_number'] ?? 0);
            $j = (int) ($row['juz_number'] ?? 0);
            if ($p >= 1 && $p <= 604 && $j >= 1 && $j <= 30) {
                $juzByPage[$p] = $j;
            }
        }
    }
}
if (count($juzByPage) !== 604) {
    for ($p = 1; $p <= 604; $p++) {
        $juzByPage[$p] = min(30, (int) ceil($p / 20.2));
    }
}
$words = [];
$seen = [];
$bookCounts = [];
$skippedNoPage = 0;
$skippedLong = 0;
$skippedEmpty = 0;
$coveredAyahs = [];
$order = 0;

foreach ($json['data'] as $row) {
    $surah = (int) ($row['surah'] ?? 0);
    $ayah = (int) ($row['ayah'] ?? 0);
    if ($surah < 1 || $surah > 114 || $ayah < 1) continue;
    $ref = "{$surah}:{$ayah}";
    $page = $pageByRef[$ref] ?? null;
    if ($page === null) {
        $skippedNoPage++;
        continue;
    }

    $entries = is_array($row['meanings'] ?? null) ? $row['meanings'] : [];
    usort($entries, static function (array $a, array $b) use ($books): int {
        $aid = (int) ($a['book_info']['id'] ?? 0);
        $bid = (int) ($b['book_info']['id'] ?? 0);
        $ap = array_search($aid, array_keys($books), true);
        $bp = array_search($bid, array_keys($books), true);
        if ($ap === false) $ap = 999;
        if ($bp === false) $bp = 999;
        return $ap <=> $bp;
    });

    foreach ($entries as $entry) {
        $bookId = (int) ($entry['book_info']['id'] ?? 0);
        if (!isset($books[$bookId])) continue;
        $bookName = kal_clean((string) ($entry['book_info']['name'] ?? ''));

        foreach ((array) ($entry['words'] ?? []) as $word) {
            $text = kal_clean((string) ($word['text'] ?? ''));
            $meaning = kal_clean((string) ($word['meaning'] ?? ''));
            if ($text === '' || $meaning === '') {
                $skippedEmpty++;
                continue;
            }

            $parts = preg_split('/\s+/u', $text) ?: [];
            if (count($parts) > $maxWords) {
                $skippedLong++;
                continue;
            }

            $norm = kal_normalize($text);
            if ($norm === '') {
                $skippedEmpty++;
                continue;
            }

            $dedupe = "{$ref}|{$norm}";
            if (isset($seen[$dedupe])) continue;
            $seen[$dedupe] = true;

            $key = sha1($dedupe);
            $words[] = [
                'key' => $key,
                'surah' => $surah,
                'ayah' => $ayah,
                'page' => $page,
                'text' => $text,
                'meaning' => $meaning,
                'book_id' => $bookId,
                'book' => $bookName,
                'kind' => kal_kind($text),
                '_order' => $order++,
            ];
            $bookCounts[$bookName] = ($bookCounts[$bookName] ?? 0) + 1;
            $coveredAyahs[$ref] = true;
        }
    }
}

usort($words, static function (array $a, array $b): int {
    return [$a['page'], $a['surah'], $a['ayah'], $a['_order']]
        <=> [$b['page'], $b['surah'], $b['ayah'], $b['_order']];
});
foreach ($words as &$word) {
    unset($word['_order']);
}
unset($word);

$license = $json['license'] ?? [];
$licenseText = is_array($license)
    ? (string) ($license['en'] ?? $license['ar'] ?? '')
    : (string) $license;

$pageCounts = [];
$juzCounts = [];
$wordsByJuz = [];
foreach ($words as $w) {
    $p = (int) $w['page'];
    $j = (int) ($juzByPage[$p] ?? 0);
    if ($j < 1) continue;
    $pageCounts[(string) $p] = ($pageCounts[(string) $p] ?? 0) + 1;
    $juzCounts[(string) $j] = ($juzCounts[(string) $j] ?? 0) + 1;
    $wordsByJuz[$j][] = $w;
}

$meta = [
    'source' => 'Quranpedia.net',
    'source_url' => KAL_SOURCE_URL,
    'source_version' => (string) ($license['version'] ?? ''),
    'generated_at' => gmdate('c'),
    'license' => $licenseText,
    'books' => array_values(array_unique(array_map('intval', $options['books']))),
    'max_words' => $maxWords,
    'count' => count($words),
    'ayahs_covered' => count($coveredAyahs),
    'book_counts' => $bookCounts,
    'page_counts' => $pageCounts,
    'juz_counts' => $juzCounts,
    'page_juz' => $juzByPage,
    'skipped_no_page' => $skippedNoPage,
    'skipped_too_long' => $skippedLong,
    'skipped_empty' => $skippedEmpty,
];

$outDir = rtrim($options['out'], "\\/");
if (!is_dir($outDir) && !mkdir($outDir, 0775, true) && !is_dir($outDir)) {
    fwrite(STDERR, "Could not create output directory: {$outDir}\n");
    exit(1);
}
$juzDir = $outDir . '/juz';
if (!is_dir($juzDir) && !mkdir($juzDir, 0775, true) && !is_dir($juzDir)) {
    fwrite(STDERR, "Could not create output directory: {$juzDir}\n");
    exit(1);
}

$writeJson = static function (string $file, array $payload): void {
    $encoded = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($encoded === false) {
        throw new RuntimeException('JSON encode failed: ' . json_last_error_msg());
    }
    file_put_contents($file, $encoded . "\n");
};

try {
    $writeJson($outDir . '/meta.json', ['meta' => $meta]);
    for ($j = 1; $j <= 30; $j++) {
        $writeJson($juzDir . '/' . $j . '.json', [
            'juz' => $j,
            'count' => count($wordsByJuz[$j] ?? []),
            'words' => $wordsByJuz[$j] ?? [],
        ]);
    }
} catch (Throwable $e) {
    fwrite(STDERR, $e->getMessage() . "\n");
    exit(1);
}

fwrite(STDERR, sprintf(
    "Wrote %s\n  %d cards, %d ayahs, %d books, 30 juz shards\n  skipped: %d long, %d no-page, %d empty\n",
    $outDir,
    count($words),
    count($coveredAyahs),
    count($bookCounts),
    $skippedLong,
    $skippedNoPage,
    $skippedEmpty
));
