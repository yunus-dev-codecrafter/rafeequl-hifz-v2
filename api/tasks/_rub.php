<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz — Rub' consolidation helpers (RUB_TAMKIN).
 *
 * Pure helpers shared by:
 *   - api/tasks/get_daily_tasks.php  (selection + task payload)
 *   - api/tasks/get_rub_verses.php   (segmented verse payload)
 *   - api/tasks/update_rub.php       (server-side validation + completion)
 *   - config/build_rub_quarters.php  (one-off catalog builder)
 *
 * The catalog (api/data/rub_quarters.json) is committed, so nothing here
 * touches the network at runtime.
 */

/* -------------------------------------------------------------------------
 * Waqf (stop) signs in the Uthmani text.
 *
 * Only the stop-preferring marks split a verse into separately repeated
 * stations. Signs meaning "continue" stay in the text and are explained by
 * the UI legend.
 * ---------------------------------------------------------------------- */
function rh_waqf_marks(): array
{
    return [
        0x06D6 => ['key' => 'salli',     'ar' => 'صلى: الوصل أولى',          'en' => 'Continue preferred',   'splits' => false],
        0x06D7 => ['key' => 'qala',      'ar' => 'قلى: الوقف أولى',          'en' => 'Stop preferred',       'splits' => true],
        0x06D8 => ['key' => 'lazim',     'ar' => 'لازم: الوقف لازم',         'en' => 'Obligatory stop',      'splits' => true],
        0x06D9 => ['key' => 'la',        'ar' => 'لا: لا تقف',               'en' => 'Do not stop',          'splits' => false],
        0x06DA => ['key' => 'jaiz',      'ar' => 'ج: الوقف جائز',            'en' => 'Permissible stop',     'splits' => false],
        0x06DB => ['key' => 'muanaqah',  'ar' => 'ۛ معانقة: قف على أحدهما',  'en' => 'Stop at one of the two', 'splits' => true],
        0x06DC => ['key' => 'saktah',    'ar' => 'س: سكتة لطيفة',            'en' => 'Brief pause',          'splits' => true],
    ];
}

function rh_rub_mark_cp(): int
{
    return 0x06DE; // ۞ start of rub' el hizb
}

function rh_sajdah_cp(): int
{
    return 0x06E9; // ۩
}

/** Split a UTF-8 string into Unicode codepoints (as ints). */
function rh_codepoints(string $text): array
{
    $chars = preg_split('//u', $text, -1, PREG_SPLIT_NO_EMPTY);
    if (!is_array($chars)) {
        return [];
    }
    $out = [];
    foreach ($chars as $ch) {
        $out[] = mb_ord($ch, 'UTF-8');
    }
    return $out;
}

/** Build a UTF-8 string from codepoints. */
function rh_from_codepoints(array $cps): string
{
    $out = '';
    foreach ($cps as $cp) {
        $out .= mb_chr($cp, 'UTF-8');
    }
    return $out;
}

/**
 * Split one verse into stop stations.
 *
 * Returns:
 *   [
 *     'segments' => [
 *        ['index'=>0, 'text'=>'...', 'stop'=>'lazim', 'stop_ar'=>'...', 'stop_en'=>'...'],
 *        ...
 *     ],
 *     'has_rub_mark' => bool,
 *     'has_sajdah'   => bool,
 *   ]
 *
 * A verse without a stop-preferring sign returns exactly one segment.
 */
function rh_split_verse(string $text): array
{
    $marks = rh_waqf_marks();
    $cps = rh_codepoints($text);
    if (!$cps) {
        return [
            'segments'     => [['index' => 0, 'text' => '', 'stop' => null, 'stop_ar' => '', 'stop_en' => '']],
            'has_rub_mark' => false,
            'has_sajdah'   => false,
        ];
    }

    $rubCp = rh_rub_mark_cp();
    $sajdahCp = rh_sajdah_cp();
    $hasRub = in_array($rubCp, $cps, true);
    $hasSajdah = in_array($sajdahCp, $cps, true);

    // Remove the decorative rub' marker; the UI renders its own badge.
    if ($hasRub) {
        $cps = array_values(array_filter($cps, static function (int $cp) use ($rubCp): bool {
            return $cp !== $rubCp;
        }));
    }

    // Mu'anaqah (ۛ) comes in pairs: stop at the first, continue at the
    // partner. Count them so an odd/rare case still splits sensibly.
    $muanaqahCount = 0;
    foreach ($cps as $cp) {
        if ($cp === 0x06DB) {
            $muanaqahCount++;
        }
    }
    $muanaqahEven = ($muanaqahCount % 2 === 0);
    $muanaqahSeen = 0;

    $segments = [];
    $buffer = [];

    foreach ($cps as $cp) {
        $buffer[] = $cp;
        if (!isset($marks[$cp]) || empty($marks[$cp]['splits'])) {
            continue;
        }

        $shouldSplit = true;
        if ($cp === 0x06DB) {
            $muanaqahSeen++;
            if ($muanaqahEven && ($muanaqahSeen % 2 === 0)) {
                $shouldSplit = false; // partner of the pair: keep reciting
            }
        }
        if (!$shouldSplit) {
            continue;
        }

        $segText = trim(rh_from_codepoints($buffer));
        if ($segText !== '') {
            $info = $marks[$cp];
            $segments[] = [
                'text'    => $segText,
                'stop'    => $info['key'],
                'stop_ar' => $info['ar'],
                'stop_en' => $info['en'],
            ];
        }
        $buffer = [];
    }

    $tail = trim(rh_from_codepoints($buffer));
    if ($tail !== '') {
        $segments[] = ['text' => $tail, 'stop' => null, 'stop_ar' => '', 'stop_en' => ''];
    }

    // Never return zero segments (e.g. a verse made only of a stop mark).
    if (!$segments) {
        $segments[] = ['text' => trim($text), 'stop' => null, 'stop_ar' => '', 'stop_en' => ''];
    }

    foreach ($segments as $i => &$seg) {
        $seg['index'] = $i;
    }
    unset($seg);

    return [
        'segments'     => $segments,
        'has_rub_mark' => $hasRub,
        'has_sajdah'   => $hasSajdah,
    ];
}

/* -------------------------------------------------------------------------
 * Static data loaders (cached per request)
 * ---------------------------------------------------------------------- */

function rh_quran_path(): string
{
    return __DIR__ . '/../../web/data/quran-uthmani.json';
}

function rh_catalog_path(): string
{
    return __DIR__ . '/../data/rub_quarters.json';
}

function rh_page_map_path(): string
{
    return __DIR__ . '/../../web/js/madinah_page_verses.json';
}

function rh_load_quran(): array
{
    static $quran = null;
    if ($quran !== null) {
        return $quran;
    }
    $raw = @file_get_contents(rh_quran_path());
    $decoded = $raw !== false ? json_decode($raw, true) : null;
    $quran = is_array($decoded) ? $decoded : [];
    return $quran;
}

/** verseKey "s:a" => page number (1..604) */
function rh_verse_page_map(): array
{
    static $map = null;
    if ($map !== null) {
        return $map;
    }
    $map = [];
    $raw = @file_get_contents(rh_page_map_path());
    $pages = $raw !== false ? json_decode($raw, true) : null;
    if (!is_array($pages)) {
        return $map;
    }
    foreach ($pages as $idx => $sections) {
        $page = $idx + 1;
        if (!is_array($sections)) {
            continue;
        }
        foreach ($sections as $section) {
            if (!is_array($section) || count($section) < 3) {
                continue;
            }
            $surah = (int) $section[0];
            $from = (int) $section[1];
            $to = (int) $section[2];
            for ($a = $from; $a <= $to; $a++) {
                $map[$surah . ':' . $a] = $page;
            }
        }
    }
    return $map;
}

/**
 * Full catalog. Returns ['version'=>int, 'rubs'=>[id => entry]].
 */
function rh_rub_catalog(): array
{
    static $catalog = null;
    if ($catalog !== null) {
        return $catalog;
    }
    $catalog = ['version' => 1, 'rubs' => []];
    $raw = @file_get_contents(rh_catalog_path());
    $decoded = $raw !== false ? json_decode($raw, true) : null;
    if (!is_array($decoded) || empty($decoded['rubs'])) {
        return $catalog;
    }
    foreach ($decoded['rubs'] as $entry) {
        if (isset($entry['id'])) {
            $catalog['rubs'][(int) $entry['id']] = $entry;
        }
    }
    $catalog['version'] = (int) ($decoded['version'] ?? 1);
    return $catalog;
}

function rh_rub_by_id(int $rubId): ?array
{
    $catalog = rh_rub_catalog();
    return $catalog['rubs'][$rubId] ?? null;
}

/* -------------------------------------------------------------------------
 * Verse expansion + segmentation
 * ---------------------------------------------------------------------- */

function rh_verse_text(array $quran, int $surah, int $ayah): string
{
    $arr = $quran[(string) $surah] ?? null;
    if (!is_array($arr)) {
        return '';
    }
    return (string) ($arr[$ayah - 1] ?? '');
}

/**
 * Expand a rub' in mushaf order into verses with segmented stations.
 *
 * @return array{rub:?array, verses:array, segments_total:int}
 */
function rh_rub_verses(int $rubId): array
{
    $rub = rh_rub_by_id($rubId);
    if ($rub === null) {
        return ['rub' => null, 'verses' => [], 'segments_total' => 0];
    }

    $quran = rh_load_quran();
    $pageMap = rh_verse_page_map();

    $s = (int) $rub['start']['surah'];
    $a = (int) $rub['start']['ayah'];
    $es = (int) $rub['end']['surah'];
    $ea = (int) $rub['end']['ayah'];

    $verses = [];
    $total = 0;
    $guard = 0;

    while ($guard++ < 20000) {
        if ($s > $es || ($s === $es && $a > $ea)) {
            break;
        }
        $text = rh_verse_text($quran, $s, $a);
        if ($text === '') {
            // Missing text: advance safely instead of looping forever.
            $arr = $quran[(string) $s] ?? [];
            $len = is_array($arr) ? count($arr) : 0;
            if ($a >= $len) {
                $s++;
                $a = 1;
            } else {
                $a++;
            }
            continue;
        }

        $split = rh_split_verse($text);
        $segments = $split['segments'];
        $total += count($segments);

        $verses[] = [
            'surah'        => $s,
            'ayah'         => $a,
            'page'         => $pageMap[$s . ':' . $a] ?? null,
            'text'         => $text,
            'has_rub_mark' => $split['has_rub_mark'],
            'has_sajdah'   => $split['has_sajdah'],
            'segments'     => $segments,
            'segments_total' => count($segments),
        ];

        $arr = $quran[(string) $s] ?? [];
        $len = is_array($arr) ? count($arr) : 0;
        if ($a >= $len) {
            $s++;
            $a = 1;
        } else {
            $a++;
        }
    }

    return ['rub' => $rub, 'verses' => $verses, 'segments_total' => $total];
}

/* -------------------------------------------------------------------------
 * Daily selection
 * ---------------------------------------------------------------------- */

/**
 * Pick a fair random rub' for the user.
 *
 * @param int    $frontier  Highest consolidated page (last_tikrar_page).
 * @param string $userType  NEW | EXISTING | COMPLETE
 * @param string $today     Y-m-d (server day)
 */
function rh_pick_rub(PDO $pdo, int $userId, int $frontier, string $userType, string $today): ?array
{
    $catalog = rh_rub_catalog();
    if (empty($catalog['rubs'])) {
        return null;
    }

    $pool = [];
    foreach ($catalog['rubs'] as $rub) {
        if ($userType === 'COMPLETE') {
            $pool[] = $rub;
            continue;
        }
        if ($frontier >= 1 && (int) $rub['end_page'] <= $frontier) {
            $pool[] = $rub;
        }
    }
    if (!$pool) {
        return null;
    }

    // History (last time each rub' was completed).
    $history = [];
    try {
        $stmt = $pdo->prepare('SELECT `rub_id`, `last_done_date` FROM `rub_history` WHERE `user_id` = :u');
        $stmt->execute([':u' => $userId]);
        foreach ($stmt->fetchAll() as $row) {
            $history[(int) $row['rub_id']] = (string) ($row['last_done_date'] ?? '');
        }
    } catch (Throwable $t) {
        $history = [];
    }

    // No repeat until the pool is exhausted: exclude everything used inside
    // the last (pool size - 1) days.
    $windowDays = max(1, count($pool) - 1);
    $windowStart = date('Y-m-d', strtotime($today . ' -' . $windowDays . ' days'));

    $fresh = [];
    foreach ($pool as $rub) {
        $last = $history[(int) $rub['id']] ?? '';
        if ($last === '' || $last < $windowStart) {
            $fresh[] = $rub;
        }
    }

    if ($fresh) {
        return $fresh[random_int(0, count($fresh) - 1)];
    }

    // Rare fallback (tiny pool or a long pause): least recently used wins.
    usort($pool, static function (array $x, array $y) use ($history): int {
        $lx = $history[(int) $x['id']] ?? '';
        $ly = $history[(int) $y['id']] ?? '';
        if ($lx === $ly) {
            return 0;
        }
        if ($lx === '') {
            return -1;
        }
        if ($ly === '') {
            return 1;
        }
        return strcmp($lx, $ly);
    });

    $bestDate = $history[(int) $pool[0]['id']] ?? '';
    $candidates = [];
    foreach ($pool as $rub) {
        if (($history[(int) $rub['id']] ?? '') === $bestDate) {
            $candidates[] = $rub;
        }
    }
    return $candidates[random_int(0, count($candidates) - 1)];
}

/** Create the rotation table lazily so the feature works before migration v6. */
function rh_ensure_history_table(PDO $pdo): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $done = true;

    $exists = false;
    try {
        $exists = (bool) $pdo->query(
            "SELECT 1 FROM `information_schema`.`TABLES`
             WHERE `TABLE_SCHEMA` = DATABASE() AND `TABLE_NAME` = 'rub_history'
             LIMIT 1"
        )->fetchColumn();
    } catch (Throwable $t) {
        // If information_schema is unavailable, fall through to CREATE IF NOT EXISTS.
        $exists = false;
    }
    if ($exists) {
        return;
    }

    try {
        $pdo->exec(
            "CREATE TABLE IF NOT EXISTS `rub_history` (
                `id` INT NOT NULL AUTO_INCREMENT,
                `user_id` INT NOT NULL,
                `rub_id` INT NOT NULL,
                `last_done_date` DATE NULL,
                `times_done` INT NOT NULL DEFAULT 0,
                PRIMARY KEY (`id`),
                UNIQUE KEY `uq_rub_history_user_rub` (`user_id`, `rub_id`),
                KEY `idx_rub_history_user_date` (`user_id`, `last_done_date`),
                CONSTRAINT `fk_rub_history_user`
                    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
                    ON DELETE CASCADE ON UPDATE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );
    } catch (Throwable $t) {
        error_log('[RubHistoryTable] ' . $t->getMessage());
    }
}

function rh_mark_rub_done(PDO $pdo, int $userId, int $rubId, string $taskDate): void
{
    try {
        $stmt = $pdo->prepare(
            'INSERT INTO `rub_history` (`user_id`, `rub_id`, `last_done_date`, `times_done`)
             VALUES (:u, :r, :d, 1)
             ON DUPLICATE KEY UPDATE
                `times_done` = `times_done` + 1,
                `last_done_date` = VALUES(`last_done_date`)'
        );
        $stmt->execute([':u' => $userId, ':r' => $rubId, ':d' => $taskDate]);
    } catch (Throwable $t) {
        // History is advisory only; never fail the task because of it.
        error_log('[RubHistory] ' . $t->getMessage());
    }
}

/** Undo a same-day completion so the rub' can be drawn again if needed. */
function rh_unmark_rub_done(PDO $pdo, int $userId, int $rubId, string $taskDate): void
{
    try {
        $stmt = $pdo->prepare(
            'SELECT `times_done`, `last_done_date` FROM `rub_history`
             WHERE `user_id` = :u AND `rub_id` = :r LIMIT 1'
        );
        $stmt->execute([':u' => $userId, ':r' => $rubId]);
        $row = $stmt->fetch();
        if (!$row || (string) ($row['last_done_date'] ?? '') !== $taskDate) {
            return;
        }

        if ((int) $row['times_done'] <= 1) {
            $del = $pdo->prepare('DELETE FROM `rub_history` WHERE `user_id` = :u AND `rub_id` = :r');
            $del->execute([':u' => $userId, ':r' => $rubId]);
            return;
        }

        $upd = $pdo->prepare(
            'UPDATE `rub_history`
             SET `times_done` = `times_done` - 1, `last_done_date` = NULL
             WHERE `user_id` = :u AND `rub_id` = :r'
        );
        $upd->execute([':u' => $userId, ':r' => $rubId]);
    } catch (Throwable $t) {
        error_log('[RubHistoryUndo] ' . $t->getMessage());
    }
}

/** Arabic ordinal label for a rub': "الربع 12". */
function rh_rub_label(int $rubId): string
{
    return 'الربع ' . $rubId;
}
