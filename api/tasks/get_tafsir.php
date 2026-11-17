<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Tafsir API (Al-Mukhtasar fi al-Tafsir)
 *
 * Reads per-rub' tafsir JSON files and returns tafsir for:
 *   - page: integer (1..604)
 *   - or surah & ayah: integers
 */

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: public, max-age=86400');

function json_out(int $code, array $payload): void
{
    http_response_code($code);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

$page = isset($_GET['page']) && ctype_digit((string) $_GET['page']) ? (int) $_GET['page'] : null;
$surah = isset($_GET['surah']) && ctype_digit((string) $_GET['surah']) ? (int) $_GET['surah'] : null;
$ayah = isset($_GET['ayah']) && ctype_digit((string) $_GET['ayah']) ? (int) $_GET['ayah'] : null;

$catalogPath = __DIR__ . '/../data/rub_quarters.json';
$pageMapPath = __DIR__ . '/../../web/js/madinah_page_verses.json';
$tafsirDir   = __DIR__ . '/../data/tafsir';

if (!file_exists($catalogPath) || !is_dir($tafsirDir)) {
    json_out(500, ['success' => false, 'error' => 'Tafsir dataset missing']);
}

$catalogRaw = @file_get_contents($catalogPath);
$catalog = $catalogRaw ? json_decode($catalogRaw, true) : null;
$rubs = is_array($catalog) && isset($catalog['rubs']) ? $catalog['rubs'] : [];

$tafsirOut = [];

if ($page !== null && $page >= 1 && $page <= 604) {
    // Get ayat on this page from madinah_page_verses.json
    $targetKeys = [];
    if (file_exists($pageMapPath)) {
        $pageMapRaw = @file_get_contents($pageMapPath);
        $pageMap = $pageMapRaw ? json_decode($pageMapRaw, true) : [];
        $pageSections = $pageMap[$page - 1] ?? [];
        foreach ($pageSections as $sec) {
            if (is_array($sec) && count($sec) >= 3) {
                $sId = (int) $sec[0];
                $from = (int) $sec[1];
                $to = (int) $sec[2];
                for ($a = $from; $a <= $to; $a++) {
                    $targetKeys["$sId:$a"] = true;
                }
            }
        }
    }

    // Overlapping rubs for this page
    foreach ($rubs as $rub) {
        $sp = (int) ($rub['start_page'] ?? 0);
        $ep = (int) ($rub['end_page'] ?? 0);
        $rid = (int) ($rub['id'] ?? 0);
        if ($sp <= $page && $ep >= $page && $rid >= 1 && $rid <= 240) {
            $fPath = "$tafsirDir/$rid.json";
            if (file_exists($fPath)) {
                $fRaw = @file_get_contents($fPath);
                $fDec = $fRaw ? json_decode($fRaw, true) : null;
                if (is_array($fDec) && isset($fDec['verses']) && is_array($fDec['verses'])) {
                    foreach ($fDec['verses'] as $key => $val) {
                        if (empty($targetKeys) || isset($targetKeys[$key])) {
                            $tafsirOut[$key] = $val;
                        }
                    }
                }
            }
        }
    }

    // If rub range didn't find all target keys (e.g. rub boundary edge cases), scan adjacent rubs
    if (!empty($targetKeys) && count($tafsirOut) < count($targetKeys)) {
        foreach ($rubs as $rub) {
            $sp = (int) ($rub['start_page'] ?? 0);
            $ep = (int) ($rub['end_page'] ?? 0);
            $rid = (int) ($rub['id'] ?? 0);
            // Check adjacent rubs (+/- 1)
            if (($sp - 1 <= $page && $ep + 1 >= $page) && $rid >= 1 && $rid <= 240) {
                $fPath = "$tafsirDir/$rid.json";
                if (file_exists($fPath)) {
                    $fRaw = @file_get_contents($fPath);
                    $fDec = $fRaw ? json_decode($fRaw, true) : null;
                    if (is_array($fDec) && isset($fDec['verses']) && is_array($fDec['verses'])) {
                        foreach ($fDec['verses'] as $key => $val) {
                            if (isset($targetKeys[$key]) && !isset($tafsirOut[$key])) {
                                $tafsirOut[$key] = $val;
                            }
                        }
                    }
                }
            }
        }
    }

    json_out(200, [
        'success' => true,
        'page'    => $page,
        'source'  => 'المختصر في التفسير',
        'verses'  => $tafsirOut,
    ]);
}

if ($surah !== null && $ayah !== null) {
    $targetKey = "$surah:$ayah";
    foreach ($rubs as $rub) {
        $rid = (int) ($rub['id'] ?? 0);
        $fPath = "$tafsirDir/$rid.json";
        if (file_exists($fPath)) {
            $fRaw = @file_get_contents($fPath);
            $fDec = $fRaw ? json_decode($fRaw, true) : null;
            if (is_array($fDec) && isset($fDec['verses'][$targetKey])) {
                json_out(200, [
                    'success' => true,
                    'key'     => $targetKey,
                    'source'  => 'المختصر في التفسير',
                    'tafsir'  => $fDec['verses'][$targetKey],
                ]);
            }
        }
    }

    json_out(404, ['success' => false, 'error' => 'Verse not found in tafsir dataset']);
}

json_out(400, ['success' => false, 'error' => 'Missing page or surah/ayah parameter']);
