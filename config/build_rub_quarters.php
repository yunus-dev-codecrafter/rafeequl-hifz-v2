<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz — build the exact 240-entry rub' al-hizb catalog.
 *
 * One-off operator script. The generated file is committed, so the app never
 * calls an external API at runtime.
 *
 * Source of truth for boundaries: the `rub_el_hizb_number` field on every verse
 * (Quran.com API v4). Page numbers come from the app's own
 * web/js/madinah_page_verses.json, and station counts use the same splitter as
 * the API (api/tasks/_rub.php).
 *
 * Run (CLI):  php config/build_rub_quarters.php
 * Run (web):  https://your-host/config/build_rub_quarters.php?confirm=1
 */

require __DIR__ . '/../api/tasks/_rub.php';

if (PHP_SAPI !== 'cli') {
    header('Content-Type: text/plain; charset=utf-8');
    if (($_GET['confirm'] ?? '') !== '1') {
        http_response_code(400);
        echo "Refusing to run. Append ?confirm=1 to the URL.\n";
        exit;
    }
}

$log = static function (string $msg): void {
    echo $msg . "\n";
    if (PHP_SAPI !== 'cli') {
        @ob_flush();
        @flush();
    }
};

$baseDir = dirname(__DIR__);
$dataDir = $baseDir . '/api/data';
$startsPath = $dataDir . '/rub_starts.json';
$outPath = $dataDir . '/rub_quarters.json';
$cacheDir = $dataDir . '/.cache';

$log('== Rafeequl Hifz — rub quarters builder ==');

/* -------------------------------------------------------------------------
 * 1. Fetch every verse's rub number (30 juz, paginated).
 * ---------------------------------------------------------------------- */

/**
 * Fetch a URL with retries using curl when available.
 */
function builder_fetch(string $url, int $attempts = 4): ?string
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
                CURLOPT_USERAGENT      => 'rafeequl-hifz-rub-builder/1.0',
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
                    'header'  => "User-Agent: rafeequl-hifz-rub-builder/1.0\r\nAccept: application/json\r\n",
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
            $log("  ! request failed (attempt {$i}), retrying…");
            sleep(2);
        }
    }
    return null;
}

$starts = null;

// Prefer a previously fetched boundary file (allows fully offline re-builds).
if (is_file($startsPath)) {
    $cached = json_decode((string) file_get_contents($startsPath), true);
    if (is_array($cached) && count($cached) === 240) {
        $starts = $cached;
        $log('- using cached ' . $startsPath);
    }
}

if ($starts === null) {
    if (!is_dir($cacheDir)) {
        @mkdir($cacheDir, 0775, true);
    }

    $byRub = []; // rub number => ['key'=>, 'juz'=>, 'hizb'=>]
    $requests = 0;

    for ($juz = 1; $juz <= 30; $juz++) {
        $page = 1;
        while (true) {
            $cacheFile = $cacheDir . '/juz-' . $juz . '-p' . $page . '.json';
            $decoded = null;

            // A cached file is only trusted when it decodes completely (an
            // interrupted download must not poison later builds).
            if (is_file($cacheFile)) {
                $cachedRaw = (string) file_get_contents($cacheFile);
                $cachedDecoded = json_decode($cachedRaw, true);
                if (is_array($cachedDecoded) && isset($cachedDecoded['verses']) && is_array($cachedDecoded['verses'])) {
                    $decoded = $cachedDecoded;
                } else {
                    @unlink($cacheFile);
                    $log('  ! discarded truncated cache for juz ' . $juz . ' page ' . $page);
                }
            }

            if ($decoded === null) {
                $url = 'https://api.quran.com/api/v4/verses/by_juz/' . $juz
                    . '?fields=rub_el_hizb_number&per_page=300&page=' . $page;
                for ($try = 1; $try <= 4 && $decoded === null; $try++) {
                    $raw = builder_fetch($url);
                    $requests++;
                    if ($raw === null) {
                        continue;
                    }
                    $candidate = json_decode($raw, true);
                    if (is_array($candidate) && isset($candidate['verses']) && is_array($candidate['verses'])) {
                        $decoded = $candidate;
                        @file_put_contents($cacheFile, $raw);
                    } else {
                        $log('  ! incomplete payload for juz ' . $juz . ' page ' . $page . ' (try ' . $try . ')');
                        sleep(2);
                    }
                }
                if ($decoded === null) {
                    $log('!! could not fetch juz ' . $juz . ' page ' . $page);
                    exit(1);
                }
            }

            foreach ($decoded['verses'] as $verse) {
                $rub = (int) ($verse['rub_el_hizb_number'] ?? 0);
                if ($rub < 1 || $rub > 240 || isset($byRub[$rub])) {
                    continue;
                }
                $byRub[$rub] = [
                    'key'  => (string) ($verse['verse_key'] ?? ''),
                    'juz'  => (int) ($verse['juz_number'] ?? $juz),
                    'hizb' => (int) ($verse['hizb_number'] ?? 0),
                ];
            }

            $next = $decoded['pagination']['next_page'] ?? null;
            if (!$next) {
                break;
            }
            $page = (int) $next;
        }
        $log('- juz ' . $juz . ' done (' . count($byRub) . '/240 rubs seen)');
    }

    if (count($byRub) !== 240) {
        $log('!! expected 240 rubs, got ' . count($byRub) . ' — aborting.');
        exit(1);
    }

    ksort($byRub);
    $starts = [];
    foreach ($byRub as $rub => $info) {
        $starts[] = $info['key'];
    }
    @file_put_contents(
        $startsPath,
        json_encode($starts, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n"
    );
    $log('- wrote ' . $startsPath . ' (' . count($starts) . ' starts, ' . $requests . ' requests)');
}

/* -------------------------------------------------------------------------
 * 2. Expand boundaries, pages and station counts.
 * ---------------------------------------------------------------------- */

$quran = rh_load_quran();
$pageMap = rh_verse_page_map();
if (!$quran || !$pageMap) {
    $log('!! quran text or page map missing.');
    exit(1);
}

/** Parse "s:a". */
$parseRef = static function (string $key): array {
    $parts = explode(':', $key);
    return [(int) ($parts[0] ?? 0), (int) ($parts[1] ?? 0)];
};

/** Last ayah of a surah. */
$surahLength = static function (int $surah) use ($quran): int {
    $arr = $quran[(string) $surah] ?? [];
    return is_array($arr) ? count($arr) : 0;
};

/** The verse immediately before (s,a), or null at 1:1. */
$prevRef = static function (int $s, int $a) use ($surahLength): ?array {
    if ($a > 1) {
        return [$s, $a - 1];
    }
    $prevSurah = $s - 1;
    while ($prevSurah >= 1) {
        $len = $surahLength($prevSurah);
        if ($len > 0) {
            return [$prevSurah, $len];
        }
        $prevSurah--;
    }
    return null;
};

$verseText = static function (int $s, int $a) use ($quran): string {
    $arr = $quran[(string) $s] ?? [];
    return is_array($arr) ? (string) ($arr[$a - 1] ?? '') : '';
};

// page number => juz / hizb (from the app's own page metadata)
$pageInfo = [];
$metaRaw = @file_get_contents(__DIR__ . '/../api/data/madinah_pages.json');
$meta = $metaRaw !== false ? json_decode($metaRaw, true) : null;
if (is_array($meta)) {
    foreach ($meta as $row) {
        $pageInfo[(int) $row['page_number']] = [
            'juz'  => (int) $row['juz_number'],
            'hizb' => (int) $row['hizb_number'],
        ];
    }
}

$rubs = [];
$segmentsSum = 0;
$versesSum = 0;

for ($rub = 1; $rub <= 240; $rub++) {
    $startKey = $starts[$rub - 1] ?? '';
    if (!preg_match('/^\d+:\d+$/', $startKey)) {
        $log('!! invalid start for rub ' . $rub . ': ' . $startKey);
        exit(1);
    }
    [$s, $a] = $parseRef($startKey);

    if ($rub < 240) {
        [$nextS, $nextA] = $parseRef($starts[$rub]);
        $prev = $prevRef($nextS, $nextA);
        if ($prev === null) {
            $log('!! could not derive end for rub ' . $rub);
            exit(1);
        }
        [$es, $ea] = $prev;
    } else {
        $es = 114;
        $ea = $surahLength(114);
    }

    $startPageGuess = $pageMap[$startKey] ?? null;
    $info = ($startPageGuess !== null && isset($pageInfo[$startPageGuess]))
        ? $pageInfo[$startPageGuess]
        : ['juz' => 0, 'hizb' => 0];

    // Walk the span: verse count + station count + page bounds.
    $vCount = 0;
    $segCount = 0;
    $startPage = null;
    $endPage = null;
    $cs = $s;
    $ca = $a;
    $guard = 0;
    while ($guard++ < 20000) {
        if ($cs > $es || ($cs === $es && $ca > $ea)) {
            break;
        }
        $text = $verseText($cs, $ca);
        if ($text !== '') {
            $vCount++;
            $split = rh_split_verse($text);
            $segCount += count($split['segments']);
            $page = $pageMap[$cs . ':' . $ca] ?? null;
            if ($page !== null) {
                if ($startPage === null || $page < $startPage) {
                    $startPage = $page;
                }
                if ($endPage === null || $page > $endPage) {
                    $endPage = $page;
                }
            }
        }
        if ($ca >= $surahLength($cs)) {
            $cs++;
            $ca = 1;
        } else {
            $ca++;
        }
    }

    if ($vCount < 1 || $segCount < 1 || $startPage === null || $endPage === null) {
        $log('!! empty rub ' . $rub . ' (' . $startKey . ' → ' . $es . ':' . $ea . ')');
        exit(1);
    }

    $rubs[] = [
        'id'             => $rub,
        'juz'            => $info['juz'],
        'hizb'           => $info['hizb'],
        'start'          => ['surah' => $s, 'ayah' => $a],
        'end'            => ['surah' => $es, 'ayah' => $ea],
        'start_page'     => $startPage,
        'end_page'       => $endPage,
        'verse_count'    => $vCount,
        'segments_total' => $segCount,
    ];
    $segmentsSum += $segCount;
    $versesSum += $vCount;
}

/* -------------------------------------------------------------------------
 * 3. Validate + write.
 * ---------------------------------------------------------------------- */

$errors = [];
if (count($rubs) !== 240) {
    $errors[] = 'expected 240 rubs, got ' . count($rubs);
}
if ($rubs[0]['start'] !== ['surah' => 1, 'ayah' => 1]) {
    $errors[] = 'rub 1 must start at 1:1';
}
if ($rubs[239]['end'] !== ['surah' => 114, 'ayah' => 6]) {
    $errors[] = 'rub 240 must end at 114:6';
}
for ($i = 0; $i < 239; $i++) {
    $next = $rubs[$i + 1]['start'];
    $end = $rubs[$i]['end'];
    $ok = ($next['surah'] === $end['surah'] && $next['ayah'] === $end['ayah'] + 1)
        || ($next['surah'] === $end['surah'] + 1 && $next['ayah'] === 1);
    if (!$ok) {
        $errors[] = 'gap between rub ' . ($i + 1) . ' and ' . ($i + 2);
        break;
    }
}
foreach ($rubs as $r) {
    if ($r['end_page'] < $r['start_page'] || $r['start_page'] < 1 || $r['end_page'] > 604) {
        $errors[] = 'bad page range on rub ' . $r['id'];
        break;
    }
}

if ($errors) {
    foreach ($errors as $e) {
        $log('!! ' . $e);
    }
    exit(1);
}

$payload = [
    'version' => 1,
    'source'  => 'quran.com rub_el_hizb_number + web/js/madinah_page_verses.json',
    'built_at' => gmdate('c'),
    'rubs'    => $rubs,
];

@file_put_contents(
    $outPath,
    json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n"
);

$log('');
$log('+ wrote ' . $outPath);
$log('  rubs            : ' . count($rubs));
$log('  verses          : ' . $versesSum);
$log('  stop stations   : ' . $segmentsSum . ' (avg ' . round($segmentsSum / 240, 1) . ' / rub)');
$log('  rub 1           : ' . $rubs[0]['start']['surah'] . ':' . $rubs[0]['start']['ayah']
    . ' → ' . $rubs[0]['end']['surah'] . ':' . $rubs[0]['end']['ayah']
    . ' (pages ' . $rubs[0]['start_page'] . '-' . $rubs[0]['end_page'] . ')');
$log('  rub 3           : ' . $rubs[2]['start']['surah'] . ':' . $rubs[2]['start']['ayah']
    . ' → ' . $rubs[2]['end']['surah'] . ':' . $rubs[2]['end']['ayah']
    . ' (pages ' . $rubs[2]['start_page'] . '-' . $rubs[2]['end_page'] . ')');
$log('== done ==');
