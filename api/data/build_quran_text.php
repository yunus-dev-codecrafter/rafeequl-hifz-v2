<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Build the offline Quran text bundle.
 *
 * Downloads the Uthmani text once and writes a compact lookup file:
 *   web/data/quran-uthmani.json   { "1": ["ayah 1 text", "ayah 2 text", ...], ... }
 *
 * Run:  php api/data/build_quran_text.php
 *
 * The frontend loads this lazily and the service worker caches it, so the
 * flashcards' "back" face works fully offline.
 */

$outFile = __DIR__ . '/../../web/data/quran-uthmani.json';
$source  = 'https://api.alquran.cloud/v1/quran/quran-uthmani';

echo "Fetching $source ...\n";

$raw = false;
if (function_exists('curl_init')) {
    $ch = curl_init($source);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT        => 60,
        CURLOPT_USERAGENT      => 'RafeequlHifz/1.0',
    ]);
    $raw = curl_exec($ch);
    if ($raw === false) {
        echo 'curl error: ' . curl_error($ch) . "\n";
    }
    curl_close($ch);
}
if ($raw === false) {
    $raw = @file_get_contents($source);
}
if ($raw === false || $raw === '') {
    fwrite(STDERR, "Failed to download Quran text.\n");
    exit(1);
}

$data = json_decode($raw, true);
if (!is_array($data) || !isset($data['data']['surahs'])) {
    fwrite(STDERR, "Unexpected API response.\n");
    exit(1);
}

$basmala = 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ';

$out = [];
$totalAyahs = 0;
foreach ($data['data']['surahs'] as $surah) {
    $num   = (int) $surah['number'];
    $ayahs = [];
    foreach ($surah['ayahs'] as $i => $ayah) {
        $t = (string) $ayah['text'];
        // Drop a leading BOM, then the basmala that the edition prefixes to the
        // first ayah of every surah except Al-Fatihah (1) and At-Tawbah (9).
        $t = preg_replace('/^\x{FEFF}/u', '', $t);
        if ($i === 0 && $num !== 1 && $num !== 9 && str_starts_with($t, $basmala)) {
            $t = ltrim(mb_substr($t, mb_strlen($basmala)));
        }
        $ayahs[] = $t;
        $totalAyahs++;
    }
    $out[(string) $num] = $ayahs;
}

if (!is_dir(dirname($outFile))) {
    mkdir(dirname($outFile), 0775, true);
}

$json = json_encode($out, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
if ($json === false) {
    fwrite(STDERR, "Failed to encode JSON.\n");
    exit(1);
}
file_put_contents($outFile, $json);

printf(
    "Wrote %s (%d surahs, %d ayahs, %.1f KB)\n",
    $outFile,
    count($out),
    $totalAyahs,
    strlen($json) / 1024
);
