<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz — build the per-rub' Mukhtasar tafsir bundle.
 *
 * The Rub' Consolidation screen shows the tafsir of every verse. To keep
 * shared-hosting requests small, the full tafsir is split into 240 tiny files
 * (one per rub'), instead of loading a multi-megabyte Quran-wide JSON file on
 * every request.
 *
 * Source: Al-Mukhtasar fi al-Tafsir (المختصر في التفسير), published by the
 * Tafsir Center for Quranic Studies and distributed through the Quranic
 * Universal Library (QUL). The per-ayah English and Arabic exports are fetched
 * from the pinned `spa5k/tafsir_api` release below.
 *
 * Run (CLI only):
 *   php config/build_rub_tafsir.php
 *
 * The generated files in api/data/tafsir/ are committed, so the live app never
 * touches the network at runtime.
 */

require __DIR__ . '/../api/tasks/_rub.php';

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    header('Content-Type: text/plain; charset=utf-8');
    echo "This build script is CLI-only.\n";
    exit(1);
}

const RH_TAFSIR_API_TAG = 'v1.2.1';
const RH_TAFSIR_API_BASE = 'https://cdn.jsdelivr.net/gh/spa5k/tafsir_api@' . RH_TAFSIR_API_TAG . '/tafsir/';

$editions = [
    'ar' => [
        'slug'       => 'ar-tafsir-al-mukhtasar',
        'book'       => 'المختصر في التفسير',
        'publisher'  => 'مركز تفسير للدراسات القرآنية',
    ],
    'en' => [
        'slug'       => 'en-tafsir-al-mukhtasar',
        'book'       => 'Al-Mukhtasar fi al-Tafsir',
        'publisher'  => 'Tafsir Center for Quranic Studies',
    ],
];

$baseDir  = dirname(__DIR__);
$outDir   = $baseDir . '/api/data/tafsir';
$cacheDir = $baseDir . '/api/data/.cache/tafsir';

$log = static function (string $message): void {
    echo $message . "\n";
};

/**
 * Fetch a URL with retries. Returns null when every attempt fails.
 */
function build_tafsir_fetch(string $url, int $attempts = 4): ?string
{
    for ($i = 1; $i <= $attempts; $i++) {
        $body = null;

        if (function_exists('curl_init')) {
            $ch = curl_init($url);
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_FOLLOWLOCATION => true,
                CURLOPT_CONNECTTIMEOUT => 15,
                CURLOPT_TIMEOUT        => 45,
                CURLOPT_USERAGENT      => 'rafeequl-hifz-tafsir-builder/1.0',
                CURLOPT_HTTPHEADER     => ['Accept: application/json'],
            ]);
            $body = curl_exec($ch);
            $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
            if ($body === false || $code < 200 || $code >= 300) {
                $body = null;
            }
            curl_close($ch);
        }

        if ($body === null) {
            $ctx = stream_context_create([
                'http' => [
                    'timeout' => 45,
                    'header'  => "User-Agent: rafeequl-hifz-tafsir-builder/1.0\r\nAccept: application/json\r\n",
                ],
            ]);
            $tmp = @file_get_contents($url, false, $ctx);
            if ($tmp !== false) {
                $body = $tmp;
            }
        }

        if (is_string($body) && $body !== '') {
            return $body;
        }

        if ($i < $attempts) {
            $log('  ! request failed (attempt ' . $i . '), retrying...');
            sleep(2);
        }
    }

    return null;
}

/**
 * Decode a tafsir export and index it by ayah number.
 *
 * @return array<int,string>|null
 */
function build_tafsir_index(string $raw): ?array
{
    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) {
        return null;
    }

    $out = [];
    foreach ($decoded as $row) {
        if (!is_array($row)) {
            continue;
        }
        $ayah = (int) ($row['ayah'] ?? 0);
        $text = trim((string) ($row['text'] ?? ''));
        if ($ayah < 1 || $text === '') {
            continue;
        }

        // Keep the source wording intact; only normalise line endings so the
        // JSON stays predictable across platforms.
        $out[$ayah] = str_replace(["\r\n", "\r"], "\n", $text);
    }

    return $out ?: null;
}

$quran = rh_load_quran();
$catalog = rh_rub_catalog();
if (!$quran || empty($catalog['rubs'])) {
    fwrite(STDERR, "Quran text or rub' catalog is missing.\n");
    exit(1);
}

if (!is_dir($outDir) && !@mkdir($outDir, 0775, true) && !is_dir($outDir)) {
    fwrite(STDERR, "Could not create " . $outDir . "\n");
    exit(1);
}
if (!is_dir($cacheDir) && !@mkdir($cacheDir, 0775, true) && !is_dir($cacheDir)) {
    fwrite(STDERR, "Could not create " . $cacheDir . "\n");
    exit(1);
}

/* -------------------------------------------------------------------------
 * 1. Fetch (or reuse) every surah export in Arabic and English.
 * ---------------------------------------------------------------------- */

$tafsir = ['ar' => [], 'en' => []];

foreach ($editions as $lang => $edition) {
    $langCache = $cacheDir . '/' . $lang;
    if (!is_dir($langCache) && !@mkdir($langCache, 0775, true) && !is_dir($langCache)) {
        fwrite(STDERR, "Could not create " . $langCache . "\n");
        exit(1);
    }

    $log('Fetching ' . $edition['book'] . ' (' . $lang . ')...');

    for ($surah = 1; $surah <= 114; $surah++) {
        $cacheFile = $langCache . '/' . $surah . '.json';
        $index = null;

        if (is_file($cacheFile)) {
            $cachedRaw = (string) file_get_contents($cacheFile);
            $index = build_tafsir_index($cachedRaw);
            if ($index === null) {
                @unlink($cacheFile);
                $log('  ! discarded invalid cache for ' . $lang . ' surah ' . $surah);
            }
        }

        if ($index === null) {
            $url = RH_TAFSIR_API_BASE . $edition['slug'] . '/' . $surah . '.json';
            $raw = build_tafsir_fetch($url);
            if ($raw === null) {
                fwrite(STDERR, 'Could not fetch ' . $url . "\n");
                exit(1);
            }

            $index = build_tafsir_index($raw);
            if ($index === null) {
                fwrite(STDERR, 'Invalid tafsir payload for ' . $url . "\n");
                exit(1);
            }

            @file_put_contents($cacheFile, $raw);
        }

        // Both exports are expected to cover every ayah of every surah. Fail
        // loudly rather than silently shipping a rub' with missing tafsir.
        $ayahCount = count($quran[(string) $surah] ?? []);
        for ($ayah = 1; $ayah <= $ayahCount; $ayah++) {
            if (!isset($index[$ayah]) || $index[$ayah] === '') {
                fwrite(STDERR, 'Missing ' . $lang . ' tafsir for ' . $surah . ':' . $ayah . "\n");
                exit(1);
            }
        }

        $tafsir[$lang][$surah] = $index;
    }

    $log('  ' . $lang . ': 114 surahs ready.');
}

/* -------------------------------------------------------------------------
 * 2. Split the tafsir into one small file per rub'.
 * ---------------------------------------------------------------------- */

$written = 0;
$verseTotal = 0;

for ($rubId = 1; $rubId <= 240; $rubId++) {
    $rub = rh_rub_by_id($rubId);
    if ($rub === null) {
        fwrite(STDERR, 'Missing rub ' . $rubId . " in catalog.\n");
        exit(1);
    }

    $s  = (int) $rub['start']['surah'];
    $a  = (int) $rub['start']['ayah'];
    $es = (int) $rub['end']['surah'];
    $ea = (int) $rub['end']['ayah'];

    $verses = [];
    $guard = 0;

    while ($guard++ < 20000) {
        if ($s > $es || ($s === $es && $a > $ea)) {
            break;
        }

        if (rh_verse_text($quran, $s, $a) !== '') {
            $key = $s . ':' . $a;
            $ar = $tafsir['ar'][$s][$a] ?? '';
            $en = $tafsir['en'][$s][$a] ?? '';
            if ($ar === '' || $en === '') {
                fwrite(STDERR, 'Missing tafsir for verse ' . $key . "\n");
                exit(1);
            }
            $verses[$key] = ['ar' => $ar, 'en' => $en];
            $verseTotal++;
        }

        $length = count($quran[(string) $s] ?? []);
        if ($a >= $length) {
            $s++;
            $a = 1;
        } else {
            $a++;
        }
    }

    if (!$verses) {
        fwrite(STDERR, 'No verses found for rub ' . $rubId . "\n");
        exit(1);
    }

    $payload = [
        'version' => 1,
        'rub'     => $rubId,
        'source'  => [
            'book_ar'      => 'المختصر في التفسير',
            'book_en'      => 'Al-Mukhtasar fi al-Tafsir',
            'publisher_ar' => 'مركز تفسير للدراسات القرآنية',
            'publisher_en' => 'Tafsir Center for Quranic Studies',
            'provider'     => 'Quranic Universal Library (QUL)',
            'editions'     => [
                'ar' => 'ar-tafsir-al-mukhtasar',
                'en' => 'en-tafsir-al-mukhtasar',
            ],
            'api_tag'      => RH_TAFSIR_API_TAG,
        ],
        'verses'  => $verses,
    ];

    $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) {
        fwrite(STDERR, 'Could not encode rub ' . $rubId . ".\n");
        exit(1);
    }

    $outFile = $outDir . '/' . $rubId . '.json';
    if (@file_put_contents($outFile, $json . "\n") === false) {
        fwrite(STDERR, 'Could not write ' . $outFile . "\n");
        exit(1);
    }

    $written++;
}

$log('Wrote ' . $written . ' rub tafsir files (' . $verseTotal . ' verses) to ' . $outDir);
