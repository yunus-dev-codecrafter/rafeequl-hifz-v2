<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - page-by-page consolidation helpers.
 *
 * A consolidation page is the whole Madinah page, not a rub'. The page text
 * comes from the committed quran-uthmani.json bundle and the 604-page verse
 * map. Nothing here touches the network at runtime.
 */

require_once __DIR__ . '/_rollover.php';

/** True when migration v14 has been applied. Gate callers fail open otherwise. */
function rh_pg_schema_ready(PDO $pdo): bool
{
    static $ready = null;
    if ($ready !== null) {
        return $ready;
    }
    $ready = false;
    try {
        $t1 = $pdo->query("SHOW TABLES LIKE 'consolidation_pages'")->fetchColumn();
        $t2 = $pdo->query("SHOW TABLES LIKE 'consolidation_selections'")->fetchColumn();
        $col = $pdo->query("SHOW COLUMNS FROM `daily_task_logs` LIKE 'task_type'")->fetch();
        $ready = (bool) $t1
            && (bool) $t2
            && is_array($col)
            && strpos((string) ($col['Type'] ?? ''), "'PAGE_TAMKIN'") !== false;
    } catch (Throwable $t) {
        $ready = false;
    }
    return $ready;
}

function rh_pg_quran_path(): string
{
    return __DIR__ . '/../../web/data/quran-uthmani.json';
}

function rh_pg_page_map_path(): string
{
    return __DIR__ . '/../../web/js/madinah_page_verses.json';
}

function rh_pg_catalog_path(): string
{
    return __DIR__ . '/../data/rub_quarters.json';
}

function rh_pg_load_quran(): array
{
    static $quran = null;
    if ($quran !== null) {
        return $quran;
    }
    $raw = @file_get_contents(rh_pg_quran_path());
    $decoded = $raw !== false ? json_decode($raw, true) : null;
    $quran = is_array($decoded) ? $decoded : [];
    return $quran;
}

/** Raw page map: index 0 => page 1, each item is a list of [surah, from, to]. */
function rh_pg_page_sections(): array
{
    static $pages = null;
    if ($pages !== null) {
        return $pages;
    }
    $raw = @file_get_contents(rh_pg_page_map_path());
    $decoded = $raw !== false ? json_decode($raw, true) : null;
    $pages = is_array($decoded) ? $decoded : [];
    return $pages;
}

/** verseKey "s:a" => page number. */
function rh_pg_verse_page_map(): array
{
    static $map = null;
    if ($map !== null) {
        return $map;
    }
    $map = [];
    foreach (rh_pg_page_sections() as $idx => $sections) {
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
                $map[$surah . ':' . $a] = $idx + 1;
            }
        }
    }
    return $map;
}

function rh_pg_verse_text(int $surah, int $ayah): string
{
    $quran = rh_pg_load_quran();
    $arr = $quran[(string) $surah] ?? null;
    if (!is_array($arr)) {
        return '';
    }
    return (string) ($arr[$ayah - 1] ?? '');
}

/** Remove decorative markers (end-of-ayah, rub', sajdah); keep recitable text. */
function rh_pg_clean_text(string $text): string
{
    $clean = preg_replace('/[\x{06DD}\x{06DE}\x{06E9}]/u', '', $text);
    return trim($clean === null ? $text : $clean);
}

/** Split a verse into display words, dropping mark-only tokens. */
function rh_pg_split_words(string $text): array
{
    $parts = preg_split('/\s+/u', trim($text), -1, PREG_SPLIT_NO_EMPTY);
    if (!is_array($parts)) {
        return [];
    }
    $words = [];
    foreach ($parts as $part) {
        $part = trim((string) $part);
        if ($part === '' || !preg_match('/\p{L}/u', $part)) {
            continue;
        }
        $words[] = $part;
    }
    return $words;
}

/**
 * Whole-page payload used by both the gate and the in-app page.
 *
 * @return array<string,mixed>
 */
function rh_pg_page_payload(int $page): array
{
    $page = max(1, min(604, $page));
    $quran = rh_pg_load_quran();
    $pages = rh_pg_page_sections();
    $sections = $pages[$page - 1] ?? [];
    if (!is_array($sections)) {
        $sections = [];
    }

    $verses = [];
    $flatWords = [];
    $seen = [];

    foreach ($sections as $section) {
        if (!is_array($section) || count($section) < 3) {
            continue;
        }
        $surah = (int) $section[0];
        $from = max(1, (int) $section[1]);
        $to = max($from, (int) $section[2]);
        for ($ayah = $from; $ayah <= $to; $ayah++) {
            $key = $surah . ':' . $ayah;
            if (isset($seen[$key])) {
                continue;
            }
            $seen[$key] = true;

            $text = rh_pg_clean_text(rh_pg_verse_text($surah, $ayah));
            if ($text === '') {
                continue;
            }
            $words = rh_pg_split_words($text);
            $verseWords = [];
            foreach ($words as $index => $word) {
                $verseWords[] = ['index' => $index, 'text' => $word];
                $flatWords[] = [
                    'index'  => count($flatWords),
                    'text'   => $word,
                    'surah'  => $surah,
                    'ayah'   => $ayah,
                    'key'    => $key,
                ];
            }
            $verses[] = [
                'key'   => $key,
                'surah' => $surah,
                'ayah'  => $ayah,
                'text'  => $text,
                'words' => $verseWords,
            ];
        }
    }

    $intro = [];
    foreach (array_slice($flatWords, 0, 5) as $word) {
        $intro[] = $word['text'];
    }

    $first = $verses[0] ?? null;
    $last = $verses[count($verses) - 1] ?? null;

    return [
        'page_number' => $page,
        'surah'       => $first['surah'] ?? null,
        'ayah'        => $first['ayah'] ?? null,
        'start_ref'   => $first ? $first['key'] : null,
        'end_ref'     => $last ? $last['key'] : null,
        'verses'      => $verses,
        'words'       => $flatWords,
        'word_count'  => count($flatWords),
        'intro_words' => $intro,
    ];
}

/** @return array<int,array{id:int,start_page:int,end_page:int}> */
function rh_pg_surah_ranges(): array
{
    static $ranges = null;
    if ($ranges !== null) {
        return $ranges;
    }
    $quran = rh_pg_load_quran();
    $map = rh_pg_verse_page_map();
    $ranges = [];
    foreach ($quran as $surahKey => $ayat) {
        if (!is_array($ayat) || !$ayat) {
            continue;
        }
        $surah = (int) $surahKey;
        $first = null;
        $last = null;
        foreach ($ayat as $idx => $text) {
            $key = $surah . ':' . ($idx + 1);
            if (!isset($map[$key])) {
                continue;
            }
            if ($first === null) {
                $first = (int) $map[$key];
            }
            $last = (int) $map[$key];
        }
        if ($first !== null && $last !== null) {
            $ranges[$surah] = [
                'id'         => $surah,
                'start_page' => $first,
                'end_page'   => $last,
            ];
        }
    }
    ksort($ranges);
    return $ranges;
}

/** @return array<int,array<string,mixed>> keyed by rub id */
function rh_pg_rub_catalog(): array
{
    static $rubs = null;
    if ($rubs !== null) {
        return $rubs;
    }
    $rubs = [];
    $raw = @file_get_contents(rh_pg_catalog_path());
    $decoded = $raw !== false ? json_decode($raw, true) : null;
    if (!is_array($decoded) || empty($decoded['rubs']) || !is_array($decoded['rubs'])) {
        return $rubs;
    }
    foreach ($decoded['rubs'] as $entry) {
        if (isset($entry['id'])) {
            $rubs[(int) $entry['id']] = $entry;
        }
    }
    ksort($rubs);
    return $rubs;
}

function rh_pg_rub_by_id(int $rubId): ?array
{
    $rubs = rh_pg_rub_catalog();
    return $rubs[$rubId] ?? null;
}

function rh_pg_frontier(string $userType, int $lastTikrar): int
{
    if (strtoupper($userType) === 'COMPLETE') {
        return 604;
    }
    return max(0, min(604, $lastTikrar));
}

/**
 * Pages covered by a user target, clamped to the memorised frontier.
 *
 * @return int[]
 */
function rh_pg_target_pages(string $targetType, int $targetId, int $frontier): array
{
    $targetType = strtoupper($targetType);
    if ($frontier < 1 || $targetId < 1) {
        return [];
    }

    if ($targetType === 'PAGE') {
        return $targetId <= $frontier ? [$targetId] : [];
    }

    if ($targetType === 'RUB') {
        $rub = rh_pg_rub_by_id($targetId);
        if ($rub === null) {
            return [];
        }
        $start = max(1, (int) ($rub['start_page'] ?? 0));
        $end = min($frontier, (int) ($rub['end_page'] ?? 0));
        return $end >= $start ? range($start, $end) : [];
    }

    if ($targetType === 'SURAH') {
        $ranges = rh_pg_surah_ranges();
        $range = $ranges[$targetId] ?? null;
        if ($range === null) {
            return [];
        }
        $start = max(1, (int) $range['start_page']);
        $end = min($frontier, (int) $range['end_page']);
        return $end >= $start ? range($start, $end) : [];
    }

    return [];
}

/** @return array<string,mixed> */
function rh_pg_list_targets(int $frontier): array
{
    $surahs = [];
    foreach (rh_pg_surah_ranges() as $range) {
        if ((int) $range['start_page'] > $frontier) {
            continue;
        }
        $end = min($frontier, (int) $range['end_page']);
        $surahs[] = [
            'id'         => (int) $range['id'],
            'start_page' => (int) $range['start_page'],
            'end_page'   => $end,
            'pages'      => max(0, $end - (int) $range['start_page'] + 1),
        ];
    }

    $rubs = [];
    foreach (rh_pg_rub_catalog() as $rub) {
        $start = (int) ($rub['start_page'] ?? 0);
        $end = (int) ($rub['end_page'] ?? 0);
        if ($start < 1 || $start > $frontier) {
            continue;
        }
        $clampedEnd = min($frontier, $end);
        $rubs[] = [
            'id'         => (int) $rub['id'],
            'start_page' => $start,
            'end_page'   => $clampedEnd,
            'juz'        => $rub['juz'] ?? null,
            'hizb'       => $rub['hizb'] ?? null,
            'pages'      => max(0, $clampedEnd - $start + 1),
        ];
    }

    return [
        'frontier'   => $frontier,
        'page_count' => $frontier,
        'surahs'     => $surahs,
        'rubs'       => $rubs,
    ];
}

/** @return array{user_type:string,last_tikrar_page:int,frontier:int} */
function rh_pg_user_context(PDO $pdo, int $userId): array
{
    $stmt = $pdo->prepare(
        'SELECT `user_type`, COALESCE(`last_tikrar_page`, 0) AS `last_tikrar_page`
         FROM `users` WHERE `id` = :u LIMIT 1'
    );
    $stmt->execute([':u' => $userId]);
    $row = $stmt->fetch() ?: [];
    $type = strtoupper((string) ($row['user_type'] ?? 'NEW'));
    $last = (int) ($row['last_tikrar_page'] ?? 0);
    return [
        'user_type'        => $type,
        'last_tikrar_page' => $last,
        'frontier'         => rh_pg_frontier($type, $last),
    ];
}

/** @return array<int,array<string,mixed>> page_number => row */
function rh_pg_progress_map(PDO $pdo, int $userId): array
{
    $map = [];
    try {
        $stmt = $pdo->prepare('SELECT * FROM `consolidation_pages` WHERE `user_id` = :u');
        $stmt->execute([':u' => $userId]);
        foreach ($stmt->fetchAll() as $row) {
            $map[(int) $row['page_number']] = $row;
        }
    } catch (Throwable $t) {
        error_log('[PageProgress] ' . $t->getMessage());
    }
    return $map;
}

/** @return array<int,array<string,mixed>> */
function rh_pg_active_selections(PDO $pdo, int $userId, int $frontier): array
{
    $out = [];
    try {
        $stmt = $pdo->prepare(
            "SELECT `id`, `target_type`, `target_id`, `created_at`, `completed_at`
             FROM `consolidation_selections`
             WHERE `user_id` = :u AND `status` = 'ACTIVE'
             ORDER BY `created_at` ASC, `id` ASC"
        );
        $stmt->execute([':u' => $userId]);
        $rows = $stmt->fetchAll();
    } catch (Throwable $t) {
        return $out;
    }

    $progress = rh_pg_progress_map($pdo, $userId);
    foreach ($rows as $row) {
        $type = (string) $row['target_type'];
        $id = (int) $row['target_id'];
        $pages = rh_pg_target_pages($type, $id, $frontier);
        if (!$pages) {
            continue;
        }
        $done = 0;
        foreach ($pages as $page) {
            if ((string) ($progress[$page]['status'] ?? '') === 'DONE') {
                $done++;
            }
        }
        $total = count($pages);
        $out[] = [
            'id'               => (int) $row['id'],
            'target_type'      => $type,
            'target_id'        => $id,
            'created_at'       => (string) $row['created_at'],
            'pages_total'      => $total,
            'pages_done'       => $done,
            'progress_percent' => $total > 0 ? (int) round(($done / $total) * 100) : 0,
        ];
    }
    return $out;
}

/** Returns the first active selection covering each page. @return array<int,array<string,mixed>> */
function rh_pg_active_page_owner(PDO $pdo, int $userId, int $frontier): array
{
    $owners = [];
    $stmt = $pdo->prepare(
        "SELECT `id`, `target_type`, `target_id`, `created_at`
         FROM `consolidation_selections`
         WHERE `user_id` = :u AND `status` = 'ACTIVE'
         ORDER BY `created_at` ASC, `id` ASC"
    );
    $stmt->execute([':u' => $userId]);
    foreach ($stmt->fetchAll() as $row) {
        $pages = rh_pg_target_pages((string) $row['target_type'], (int) $row['target_id'], $frontier);
        foreach ($pages as $page) {
            if (!isset($owners[$page])) {
                $owners[$page] = $row;
            }
        }
    }
    return $owners;
}

function rh_pg_repoint_today_task(PDO $pdo, int $userId, string $today, int $page): void
{
    if ($page < 1) {
        return;
    }
    try {
        $stmt = $pdo->prepare(
            "UPDATE `daily_task_logs`
             SET `start_page` = :p_start, `end_page` = :p_end, `is_completed` = 0,
                 `completed_stations` = NULL
             WHERE `user_id` = :u AND `task_type` = 'PAGE_TAMKIN'
               AND `is_completed` = 0
             ORDER BY `id` DESC LIMIT 1"
        );
        $stmt->execute([
            ':p_start' => $page,
            ':p_end'   => $page,
            ':u'       => $userId,
        ]);
    } catch (Throwable $t) {
        error_log('[PageRepoint] ' . $t->getMessage());
    }
}

/**
 * Add or re-activate a weak target and enqueue its pages.
 *
 * @return array<string,mixed>|null
 */
function rh_pg_add_selection(PDO $pdo, int $userId, string $targetType, int $targetId, int $frontier, string $today): ?array
{
    $targetType = strtoupper($targetType);
    if (!in_array($targetType, ['SURAH', 'RUB', 'PAGE'], true)) {
        return null;
    }
    $pages = rh_pg_target_pages($targetType, $targetId, $frontier);
    if (!$pages) {
        return null;
    }

    $stmt = $pdo->prepare(
        'SELECT `id` FROM `consolidation_selections`
         WHERE `user_id` = :u AND `target_type` = :t AND `target_id` = :i LIMIT 1'
    );
    $stmt->execute([':u' => $userId, ':t' => $targetType, ':i' => $targetId]);
    $selectionId = (int) ($stmt->fetchColumn() ?: 0);

    if ($selectionId > 0) {
        $upd = $pdo->prepare(
            "UPDATE `consolidation_selections`
             SET `status` = 'ACTIVE', `created_at` = CURRENT_TIMESTAMP, `completed_at` = NULL
             WHERE `id` = :id AND `user_id` = :u"
        );
        $upd->execute([':id' => $selectionId, ':u' => $userId]);
    } else {
        $ins = $pdo->prepare(
            "INSERT INTO `consolidation_selections` (`user_id`, `target_type`, `target_id`, `status`)
             VALUES (:u, :t, :i, 'ACTIVE')"
        );
        $ins->execute([':u' => $userId, ':t' => $targetType, ':i' => $targetId]);
        $selectionId = (int) $pdo->lastInsertId();
    }

    $upsert = $pdo->prepare(
        "INSERT INTO `consolidation_pages`
            (`user_id`, `page_number`, `selection_id`, `source`, `status`, `last_result`, `completed_at`)
         VALUES (:u, :p, :s, :src, 'PENDING', NULL, NULL)
         ON DUPLICATE KEY UPDATE
            `selection_id` = VALUES(`selection_id`),
            `source` = VALUES(`source`),
            `status` = 'PENDING',
            `last_result` = NULL,
            `completed_at` = NULL"
    );
    foreach ($pages as $page) {
        $upsert->execute([
            ':u'   => $userId,
            ':p'   => $page,
            ':s'   => $selectionId,
            ':src' => $targetType,
        ]);
    }

    rh_pg_repoint_today_task($pdo, $userId, $today, $pages[0]);

    return [
        'id'          => $selectionId,
        'target_type' => $targetType,
        'target_id'   => $targetId,
        'pages'       => count($pages),
    ];
}

/** Remove an active target; pending pages are released or deleted. */
function rh_pg_remove_selection(PDO $pdo, int $userId, int $selectionId, int $frontier): bool
{
    if ($selectionId < 1) {
        return false;
    }
    $stmt = $pdo->prepare(
        'SELECT `id` FROM `consolidation_selections`
         WHERE `id` = :id AND `user_id` = :u LIMIT 1'
    );
    $stmt->execute([':id' => $selectionId, ':u' => $userId]);
    if (!$stmt->fetchColumn()) {
        return false;
    }

    $pdo->prepare(
        "UPDATE `consolidation_selections`
         SET `status` = 'REMOVED', `completed_at` = CURRENT_TIMESTAMP
         WHERE `id` = :id AND `user_id` = :u"
    )->execute([':id' => $selectionId, ':u' => $userId]);

    $owners = rh_pg_active_page_owner($pdo, $userId, $frontier);
    $rows = $pdo->prepare(
        'SELECT `page_number`, `status` FROM `consolidation_pages`
         WHERE `user_id` = :u AND `selection_id` = :s'
    );
    $rows->execute([':u' => $userId, ':s' => $selectionId]);

    $upd = $pdo->prepare(
        'UPDATE `consolidation_pages` SET `selection_id` = :s, `source` = :src
         WHERE `user_id` = :u AND `page_number` = :p'
    );
    $del = $pdo->prepare(
        'DELETE FROM `consolidation_pages` WHERE `user_id` = :u AND `page_number` = :p'
    );
    $clear = $pdo->prepare(
        'UPDATE `consolidation_pages` SET `selection_id` = NULL
         WHERE `user_id` = :u AND `page_number` = :p'
    );

    foreach ($rows->fetchAll() as $row) {
        $page = (int) $row['page_number'];
        $isPending = (string) $row['status'] === 'PENDING';
        if ($isPending && isset($owners[$page])) {
            $owner = $owners[$page];
            $upd->execute([
                ':s'   => (int) $owner['id'],
                ':src' => (string) $owner['target_type'],
                ':u'   => $userId,
                ':p'   => $page,
            ]);
        } elseif ($isPending) {
            $del->execute([':u' => $userId, ':p' => $page]);
        } else {
            $clear->execute([':u' => $userId, ':p' => $page]);
        }
    }

    return true;
}

function rh_pg_clear_selections(PDO $pdo, int $userId, int $frontier): void
{
    $stmt = $pdo->prepare(
        "SELECT `id` FROM `consolidation_selections`
         WHERE `user_id` = :u AND `status` = 'ACTIVE'"
    );
    $stmt->execute([':u' => $userId]);
    foreach ($stmt->fetchAll() as $row) {
        rh_pg_remove_selection($pdo, $userId, (int) $row['id'], $frontier);
    }
}

/**
 * Find the current active (uncompleted) consolidation task for the user.
 * Consolidation is continuous and not bound to a daily lockout.
 *
 * @return array<string,mixed>|null
 */
function rh_pg_find_active_task(PDO $pdo, int $userId): ?array
{
    try {
        $stmt = $pdo->prepare(
            "SELECT * FROM `daily_task_logs`
             WHERE `user_id` = :u AND `task_type` = 'PAGE_TAMKIN' AND `is_completed` = 0
             ORDER BY `id` DESC LIMIT 1"
        );
        $stmt->execute([':u' => $userId]);
        $row = $stmt->fetch();
        return $row ?: null;
    } catch (Throwable $t) {
        return null;
    }
}

/** Backwards-compatibility alias: finds the active consolidation task. */
function rh_pg_find_today_task(PDO $pdo, int $userId, string $today): ?array
{
    return rh_pg_find_active_task($pdo, $userId);
}

function rh_pg_find_task(PDO $pdo, int $userId, int $taskId): ?array
{
    if ($taskId < 1) {
        return null;
    }
    try {
        $stmt = $pdo->prepare(
            "SELECT * FROM `daily_task_logs`
             WHERE `id` = :id AND `user_id` = :u AND `task_type` = 'PAGE_TAMKIN' LIMIT 1"
        );
        $stmt->execute([':id' => $taskId, ':u' => $userId]);
        $row = $stmt->fetch();
        return $row ?: null;
    } catch (Throwable $t) {
        return null;
    }
}

/** Pick (and remember) the next pending page. */
function rh_pg_next_page(PDO $pdo, int $userId, int $frontier, string $today): ?int
{
    if ($frontier < 1) {
        return null;
    }

    // 1. Any pending page already queued, with selected targets first.
    try {
        $stmt = $pdo->prepare(
            "SELECT p.`page_number`
             FROM `consolidation_pages` p
             LEFT JOIN `consolidation_selections` s
                ON s.`id` = p.`selection_id` AND s.`status` = 'ACTIVE'
             WHERE p.`user_id` = :u
               AND p.`status` = 'PENDING'
               AND p.`page_number` BETWEEN 1 AND :f
             ORDER BY (p.`last_result` = 'IMPROVE') DESC,
                      (s.`id` IS NULL) ASC, s.`created_at` ASC, s.`id` ASC,
                      p.`page_number` ASC, p.`updated_at` ASC
             LIMIT 1"
        );
        $stmt->execute([':u' => $userId, ':f' => $frontier]);
        $page = $stmt->fetchColumn();
        if ($page !== false && $page !== null) {
            return (int) $page;
        }
    } catch (Throwable $t) {
        error_log('[PageNext] ' . $t->getMessage());
    }

    // 2. Random page, excluding pages already owned by active selections.
    $owners = rh_pg_active_page_owner($pdo, $userId, $frontier);
    $progress = rh_pg_progress_map($pdo, $userId);
    $windowStart = date('Y-m-d', strtotime($today . ' -30 days'));

    $fresh = [];
    $older = [];
    for ($page = 1; $page <= $frontier; $page++) {
        if (isset($owners[$page])) {
            continue;
        }
        $last = (string) ($progress[$page]['last_done_date'] ?? '');
        if ($last === '' || $last < $windowStart) {
            $fresh[] = $page;
        } else {
            $older[$page] = $last;
        }
    }

    if ($fresh) {
        $page = $fresh[random_int(0, count($fresh) - 1)];
    } else {
        asort($older);
        $bestDate = null;
        $candidates = [];
        foreach ($older as $candidate => $last) {
            if ($bestDate === null) {
                $bestDate = $last;
            }
            if ($last !== $bestDate) {
                break;
            }
            $candidates[] = $candidate;
        }
        if (!$candidates) {
            return null;
        }
        $page = $candidates[random_int(0, count($candidates) - 1)];
    }

    $pdo->prepare(
        "INSERT INTO `consolidation_pages`
            (`user_id`, `page_number`, `selection_id`, `source`, `status`, `last_result`, `completed_at`)
         VALUES (:u, :p, NULL, 'AUTO', 'PENDING', NULL, NULL)
         ON DUPLICATE KEY UPDATE
            `selection_id` = NULL,
            `source` = 'AUTO',
            `status` = 'PENDING',
            `last_result` = NULL,
            `completed_at` = NULL"
    )->execute([':u' => $userId, ':p' => $page]);

    return $page;
}

/** @return array<string,mixed>|null */
function rh_pg_ensure_task(PDO $pdo, int $userId, string $today): ?array
{
    if (!rh_pg_schema_ready($pdo)) {
        return null;
    }

    // The entry gate and page controller can boot concurrently. Serialise task
    // creation per user so concurrent requests never create duplicate rows.
    $lockName = 'rh_pg_task_' . $userId;
    $locked = false;
    try {
        $lock = $pdo->prepare('SELECT GET_LOCK(?, 5)');
        $lock->execute([$lockName]);
        $locked = (int) $lock->fetchColumn() === 1;
    } catch (Throwable $t) {
        $locked = false;
    }

    try {
        $existing = rh_pg_find_active_task($pdo, $userId);
        if ($existing !== null) {
            if ((string) ($existing['task_date'] ?? '') !== $today) {
                try {
                    $pdo->prepare('UPDATE `daily_task_logs` SET `task_date` = :d WHERE `id` = :id')
                        ->execute([':d' => $today, ':id' => (int) $existing['id']]);
                    $existing['task_date'] = $today;
                } catch (Throwable $t) {}
            }
            return $existing;
        }

        $ctx = rh_pg_user_context($pdo, $userId);
        if ($ctx['frontier'] < 1) {
            return null;
        }
        $page = rh_pg_next_page($pdo, $userId, $ctx['frontier'], $today);
        if ($page === null) {
            return null;
        }

        $hasRollover = rh_task_has_rollover($pdo);
        $extraColumns = $hasRollover ? ', `rollover_count`, `last_rollover_date`' : '';
        $extraValues  = $hasRollover ? ', 0, :rollover_date' : '';
        $stmt = $pdo->prepare(
            "INSERT INTO `daily_task_logs`
                (`user_id`, `task_date`, `task_type`, `start_page`, `end_page`, `is_completed`" . $extraColumns . ")
             VALUES (:u, :d, 'PAGE_TAMKIN', :p_start, :p_end, 0" . $extraValues . ")"
        );
        $params = [
            ':u'       => $userId,
            ':d'       => $today,
            ':p_start' => $page,
            ':p_end'   => $page,
        ];
        if ($hasRollover) {
            $params[':rollover_date'] = $today;
        }
        $stmt->execute($params);

        return rh_pg_find_task($pdo, $userId, (int) $pdo->lastInsertId());
    } finally {
        // When the caller owns a transaction, keep the lock until the
        // connection closes so a second request cannot miss the uncommitted row.
        if ($locked && !$pdo->inTransaction()) {
            try {
                $release = $pdo->prepare('SELECT RELEASE_LOCK(?)');
                $release->execute([$lockName]);
            } catch (Throwable $t) {
                // The lock is released automatically when the connection closes.
            }
        }
    }
}

/** @return array<string,mixed> */
function rh_pg_parse_words_done(?string $raw): int
{
    if ($raw === null || trim($raw) === '') {
        return 0;
    }
    $decoded = json_decode($raw, true);
    if (is_array($decoded) && isset($decoded['words_done'])) {
        return max(0, (int) $decoded['words_done']);
    }
    return is_numeric($raw) ? max(0, (int) $raw) : 0;
}

/** @return array<string,mixed> */
function rh_pg_task_payload(PDO $pdo, array $row, bool $includeWords = true): array
{
    $page = (int) ($row['start_page'] ?? 0);
    $payload = rh_pg_page_payload($page);
    $wordCount = (int) $payload['word_count'];
    $wordsDone = min($wordCount, rh_pg_parse_words_done(isset($row['completed_stations']) ? (string) $row['completed_stations'] : null));

    $progress = null;
    try {
        $stmt = $pdo->prepare(
            'SELECT * FROM `consolidation_pages` WHERE `user_id` = :u AND `page_number` = :p LIMIT 1'
        );
        $stmt->execute([':u' => (int) $row['user_id'], ':p' => $page]);
        $progress = $stmt->fetch() ?: null;
    } catch (Throwable $t) {
        $progress = null;
    }

    $isCompleted = (bool) ($row['is_completed'] ?? false);
    $result = $progress ? (string) ($progress['last_result'] ?? '') : '';
    if ($isCompleted) {
        $stage = 'done';
    } elseif ($wordCount > 0 && $wordsDone < $wordCount) {
        $stage = 'arrangement';
    } else {
        $stage = 'recitation';
    }

    if (!$includeWords) {
        unset($payload['words']);
    }

    return array_merge($payload, [
        'id'           => isset($row['id']) ? (int) $row['id'] : null,
        'task_date'    => (string) ($row['task_date'] ?? ''),
        'is_completed' => $isCompleted,
        'result'       => $result,
        'words_done'   => $wordsDone,
        'stage'        => $stage,
        'source'       => $progress ? (string) ($progress['source'] ?? 'AUTO') : 'AUTO',
        'attempts'     => $progress ? (int) ($progress['attempts'] ?? 0) : 0,
        'selection_id' => $progress && $progress['selection_id'] !== null ? (int) $progress['selection_id'] : null,
    ]);
}

/** @return array<string,mixed> */
function rh_pg_gate_payload(PDO $pdo, int $userId, string $today): array
{
    if (!rh_pg_schema_ready($pdo)) {
        return ['available' => false, 'reason' => 'SCHEMA'];
    }
    $ctx = rh_pg_user_context($pdo, $userId);
    if ($ctx['frontier'] < 1) {
        return ['available' => false, 'reason' => 'NO_PAGES'];
    }
    $task = rh_pg_ensure_task($pdo, $userId, $today);
    if ($task === null) {
        return ['available' => false, 'reason' => 'NO_PAGES'];
    }
    return [
        'available' => true,
        'task'      => rh_pg_task_payload($pdo, $task, false),
    ];
}

function rh_pg_save_words(PDO $pdo, int $userId, int $taskId, int $wordsDone): ?array
{
    $task = rh_pg_find_task($pdo, $userId, $taskId);
    if ($task === null) {
        return null;
    }
    $page = (int) $task['start_page'];
    $pagePayload = rh_pg_page_payload($page);
    $wordCount = (int) ($pagePayload['word_count'] ?? 0);
    $wordsDone = max(0, min($wordCount, $wordsDone));

    $stmt = $pdo->prepare(
        'UPDATE `daily_task_logs` SET `completed_stations` = :state
         WHERE `id` = :id AND `user_id` = :u'
    );
    $stmt->execute([
        ':state' => json_encode(['words_done' => $wordsDone], JSON_UNESCAPED_UNICODE),
        ':id'    => $taskId,
        ':u'     => $userId,
    ]);

    return ['words_done' => $wordsDone, 'word_count' => $wordCount];
}

function rh_pg_complete_finished_selections(PDO $pdo, int $userId, int $frontier): void
{
    $progress = rh_pg_progress_map($pdo, $userId);
    $stmt = $pdo->prepare(
        "SELECT `id`, `target_type`, `target_id` FROM `consolidation_selections`
         WHERE `user_id` = :u AND `status` = 'ACTIVE'"
    );
    $stmt->execute([':u' => $userId]);
    $done = $pdo->prepare(
        "UPDATE `consolidation_selections`
         SET `status` = 'COMPLETED', `completed_at` = CURRENT_TIMESTAMP
         WHERE `id` = :id AND `user_id` = :u"
    );
    foreach ($stmt->fetchAll() as $row) {
        $pages = rh_pg_target_pages((string) $row['target_type'], (int) $row['target_id'], $frontier);
        if (!$pages) {
            continue;
        }
        $allDone = true;
        foreach ($pages as $page) {
            if ((string) ($progress[$page]['status'] ?? '') !== 'DONE') {
                $allDone = false;
                break;
            }
        }
        if ($allDone) {
            $done->execute([':id' => (int) $row['id'], ':u' => $userId]);
        }
    }
}

/** Mark a page DONE or IMPROVE. @return array<string,mixed>|null */
function rh_pg_mark_result(PDO $pdo, int $userId, int $taskId, string $result, string $today): ?array
{
    $result = strtoupper($result);
    if (!in_array($result, ['DONE', 'IMPROVE'], true)) {
        return null;
    }
    $task = rh_pg_find_task($pdo, $userId, $taskId);
    if ($task === null) {
        return null;
    }
    $page = (int) $task['start_page'];
    $isDone = $result === 'DONE';

    $ownTransaction = !$pdo->inTransaction();
    if ($ownTransaction) {
        $pdo->beginTransaction();
    }
    try {
        $pdo->prepare(
            'UPDATE `daily_task_logs` SET `is_completed` = :done
             WHERE `id` = :id AND `user_id` = :u'
        )->execute([':done' => $isDone ? 1 : 0, ':id' => $taskId, ':u' => $userId]);

        $upsert = $pdo->prepare(
            "INSERT INTO `consolidation_pages`
                (`user_id`, `page_number`, `source`, `status`, `last_result`, `attempts`,
                 `times_done`, `last_done_date`, `completed_at`)
             VALUES (:u, :p, 'AUTO', :status, :result, 1, :times, :doneDate, :completedAt)
             ON DUPLICATE KEY UPDATE
                `status` = VALUES(`status`),
                `last_result` = VALUES(`last_result`),
                `attempts` = `attempts` + 1,
                `times_done` = `times_done` + VALUES(`times_done`),
                `last_done_date` = IF(VALUES(`last_result`) = 'DONE', VALUES(`last_done_date`), `last_done_date`),
                `completed_at` = IF(VALUES(`last_result`) = 'DONE', VALUES(`completed_at`), NULL)"
        );
        $upsert->execute([
            ':u'           => $userId,
            ':p'           => $page,
            ':status'      => $isDone ? 'DONE' : 'PENDING',
            ':result'      => $isDone ? 'DONE' : 'IMPROVE',
            ':times'       => $isDone ? 1 : 0,
            ':doneDate'    => $isDone ? $today : null,
            ':completedAt' => $isDone ? date('Y-m-d H:i:s') : null,
        ]);

        if ($isDone) {
            $ctx = rh_pg_user_context($pdo, $userId);
            rh_pg_complete_finished_selections($pdo, $userId, $ctx['frontier']);
        } else {
            // If IMPROVE, reset word arrangement progress so the page can be retried fresh
            $pdo->prepare('UPDATE `daily_task_logs` SET `completed_stations` = NULL WHERE `id` = :id')
                ->execute([':id' => $taskId]);
        }

        $stmt = $pdo->prepare(
            'SELECT * FROM `consolidation_pages` WHERE `user_id` = :u AND `page_number` = :p LIMIT 1'
        );
        $stmt->execute([':u' => $userId, ':p' => $page]);
        $row = $stmt->fetch() ?: null;

        if ($ownTransaction) {
            $pdo->commit();
        }
        return $row;
    } catch (Throwable $t) {
        if ($ownTransaction && $pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $t;
    }
}

/** Build the full state payload for the consolidation page. */
function rh_pg_state(PDO $pdo, int $userId, string $today, ?int $taskId = null): array
{
    $ctx = rh_pg_user_context($pdo, $userId);
    $task = null;
    if ($taskId !== null && $taskId > 0) {
        $task = rh_pg_find_task($pdo, $userId, $taskId);
    }
    if ($task === null) {
        $task = rh_pg_ensure_task($pdo, $userId, $today);
    }

    return [
        'success'    => true,
        'date'       => $today,
        'user_type'  => $ctx['user_type'],
        'frontier'   => $ctx['frontier'],
        'task'       => $task !== null ? rh_pg_task_payload($pdo, $task, true) : null,
        'selections' => rh_pg_active_selections($pdo, $userId, $ctx['frontier']),
        'targets'    => rh_pg_list_targets($ctx['frontier']),
    ];
}
