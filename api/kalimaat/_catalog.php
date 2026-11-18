<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - shared helpers for the kalimaat feature.
 *
 * Content is static (web/data/kalimaat/), progress is per-user in
 * `kalimaat_progress`. The entry gate also keeps one active mistake locked in
 * `users.gate_mistake_id` so the same card is practised until 15/15.
 */

const KALIMAAT_TARGET = 500;
const KALIMAAT_TEST_MASTERY_CORRECT = 3;

/**
 * Questions per test cycle. 0 means "every started word in the zone", which is
 * the intended behaviour. Set a positive number later to cap very large zones.
 * Keep it at 0 for now so a cycle always covers the full pool.
 */
const KALIMAAT_TEST_ROUND_LIMIT = 0;

function kal_json_out(int $code, array $payload): void
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, max-age=0');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

function kal_catalog_dir(): string
{
    return __DIR__ . '/../../web/data/kalimaat';
}

/** Read GET plus an optional JSON/form body. */
function kal_read_input(): array
{
    $input = $_GET;
    $raw = file_get_contents('php://input');
    if (is_string($raw) && $raw !== '') {
        $json = json_decode($raw, true);
        if (!is_array($json)) {
            kal_json_out(400, ['success' => false, 'error' => 'Invalid JSON payload.']);
        }
        $input = array_merge($input, $json);
    } elseif (!empty($_POST)) {
        $input = array_merge($input, $_POST);
    }
    return $input;
}

function kal_require_post(): array
{
    if (strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')) !== 'POST') {
        kal_json_out(405, ['success' => false, 'error' => 'Method not allowed. Use POST.']);
    }
    return kal_read_input();
}

/** @return array<string,mixed> */
function kal_meta(): array
{
    static $meta = null;
    if (is_array($meta)) return $meta;

    $file = kal_catalog_dir() . '/meta.json';
    if (!is_readable($file)) {
        throw new RuntimeException('Kalimaat catalog is not installed.');
    }
    $payload = json_decode((string) file_get_contents($file), true);
    if (!is_array($payload) || !isset($payload['meta']) || !is_array($payload['meta'])) {
        throw new RuntimeException('Kalimaat catalog metadata is invalid.');
    }
    $meta = $payload['meta'];
    return $meta;
}

/** @return array<int,array<string,mixed>> */
function kal_juz_words(int $juz): array
{
    static $cache = [];
    $juz = (int) $juz;
    if ($juz < 1 || $juz > 30) return [];
    if (isset($cache[$juz])) return $cache[$juz];

    $file = kal_catalog_dir() . '/juz/' . $juz . '.json';
    if (!is_readable($file)) return [];
    $payload = json_decode((string) file_get_contents($file), true);
    $words = is_array($payload) && isset($payload['words']) && is_array($payload['words'])
        ? $payload['words']
        : [];
    $cache[$juz] = $words;
    return $words;
}

/** @return array<int,array<string,mixed>> */
function kal_page_words(int $page): array
{
    $page = (int) $page;
    if ($page < 1 || $page > 604) return [];
    $meta = kal_meta();
    $juz = (int) ($meta['page_juz'][(string) $page] ?? 0);
    if ($juz < 1) return [];

    $out = [];
    foreach (kal_juz_words($juz) as $word) {
        if ((int) ($word['page'] ?? 0) === $page) {
            $out[] = $word;
        }
    }
    return $out;
}

/** Find a word inside a page, or null. */
function kal_find_word(int $page, string $key): ?array
{
    if ($key === '' || strlen($key) !== 40) return null;
    foreach (kal_page_words($page) as $word) {
        if (hash_equals((string) $word['key'], $key)) {
            return $word;
        }
    }
    return null;
}

/**
 * The memorization zone: all pages the user has memorized. COMPLETE users get
 * the whole mushaf. A user who has not set a page yet gets an empty zone.
 *
 * @return array{start:int,end:int,type:string,current:int}
 */
function kal_zone(PDO $pdo, int $userId): array
{
    $stmt = $pdo->prepare('SELECT `user_type`, `current_hifz_page` FROM `users` WHERE `id` = :u LIMIT 1');
    $stmt->execute([':u' => $userId]);
    $row = $stmt->fetch() ?: [];
    $type = strtoupper((string) ($row['user_type'] ?? 'NEW'));
    $current = max(0, min(604, (int) ($row['current_hifz_page'] ?? 0)));

    if ($type === 'COMPLETE') {
        return ['start' => 1, 'end' => 604, 'type' => $type, 'current' => $current];
    }
    if ($current < 1) {
        return ['start' => 1, 'end' => 0, 'type' => $type, 'current' => 0];
    }
    return ['start' => 1, 'end' => $current, 'type' => $type, 'current' => $current];
}

/** @return array<string,array<string,mixed>> keyed by word_key */
function kal_progress_map(PDO $pdo, int $userId): array
{
    $stmt = $pdo->prepare('SELECT * FROM `kalimaat_progress` WHERE `user_id` = :u');
    $stmt->execute([':u' => $userId]);
    $out = [];
    foreach ($stmt->fetchAll() as $row) {
        $out[(string) $row['word_key']] = $row;
    }
    return $out;
}

function kal_locked_row(PDO $pdo, int $userId): ?array
{
    $stmt = $pdo->prepare(
        "SELECT * FROM `kalimaat_progress`
         WHERE `user_id` = :u AND `status` = 'LOCKED'
         ORDER BY `locked_at` ASC, `id` ASC LIMIT 1"
    );
    $stmt->execute([':u' => $userId]);
    $row = $stmt->fetch();
    return $row ?: null;
}

/** @return array<string,mixed> */
function kal_word_payload(array $word, ?array $progress): array
{
    $count = (int) ($progress['repeat_count'] ?? 0);
    $count = max(0, min(KALIMAAT_TARGET, $count));
    $status = $progress ? (string) $progress['status'] : 'NEW';
    $remaining = max(0, KALIMAAT_TARGET - $count);

    return [
        'key' => (string) ($word['key'] ?? $progress['word_key'] ?? ''),
        'text' => (string) ($word['text'] ?? $progress['word_text'] ?? ''),
        'meaning' => (string) ($word['meaning'] ?? $progress['meaning'] ?? ''),
        'book' => (string) ($word['book'] ?? $progress['book_name'] ?? ''),
        'surah_number' => (int) ($word['surah'] ?? $progress['surah_number'] ?? 0),
        'ayah_number' => (int) ($word['ayah'] ?? $progress['ayah_number'] ?? 0),
        'page_number' => (int) ($word['page'] ?? $progress['page_number'] ?? 0),
        'kind' => (string) ($word['kind'] ?? 'word'),
        'repeat_count' => $count,
        'target' => KALIMAAT_TARGET,
        'remaining' => $remaining,
        'progress_percent' => (int) round(($count / KALIMAAT_TARGET) * 100),
        'status' => $status,
        'test_attempts' => (int) ($progress['test_attempts'] ?? 0),
        'test_correct' => (int) ($progress['test_correct'] ?? 0),
        'last_repeated_at' => $progress['last_repeated_at'] ?? null,
        'last_tested_at' => $progress['last_tested_at'] ?? null,
    ];
}

/** Pick a random eligible word from the user's zone. */
function kal_pick_word(PDO $pdo, int $userId, array $zone): ?array
{
    if ((int) $zone['end'] < (int) $zone['start']) return null;
    $meta = kal_meta();
    $pageCounts = is_array($meta['page_counts'] ?? null) ? $meta['page_counts'] : [];

    $pages = [];
    for ($p = (int) $zone['start']; $p <= (int) $zone['end']; $p++) {
        if ((int) ($pageCounts[(string) $p] ?? 0) > 0) {
            $pages[] = $p;
        }
    }
    if (!$pages) return null;

    $progress = kal_progress_map($pdo, $userId);
    shuffle($pages);

    foreach ($pages as $page) {
        $eligible = [];
        foreach (kal_page_words((int) $page) as $word) {
            if (!isset($progress[(string) $word['key']])) {
                $eligible[] = $word;
            }
        }
        if ($eligible) {
            return $eligible[random_int(0, count($eligible) - 1)];
        }
    }
    return null;
}

/**
 * Return the user's locked word, creating one atomically when needed.
 * The users row is locked so two tabs cannot lock two different words.
 */
function kal_ensure_locked(PDO $pdo, int $userId, array $zone): ?array
{
    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare('SELECT `id` FROM `users` WHERE `id` = :u FOR UPDATE');
        $stmt->execute([':u' => $userId]);

        $locked = kal_locked_row($pdo, $userId);
        if ($locked) {
            $pdo->commit();
            return $locked;
        }

        $word = kal_pick_word($pdo, $userId, $zone);
        if (!$word) {
            $pdo->commit();
            return null;
        }

        $stmt = $pdo->prepare(
            "INSERT INTO `kalimaat_progress`
                (`user_id`, `word_key`, `word_text`, `meaning`, `book_name`,
                 `surah_number`, `ayah_number`, `page_number`, `repeat_count`,
                 `status`, `locked_at`)
             VALUES
                (:u, :k, :t, :m, :b, :s, :a, :p, 0, 'LOCKED', NOW())
             ON DUPLICATE KEY UPDATE
                `status` = 'LOCKED',
                `locked_at` = COALESCE(`locked_at`, NOW())"
        );
        $stmt->execute([
            ':u' => $userId,
            ':k' => (string) $word['key'],
            ':t' => (string) $word['text'],
            ':m' => (string) $word['meaning'],
            ':b' => (string) ($word['book'] ?? ''),
            ':s' => (int) $word['surah'],
            ':a' => (int) $word['ayah'],
            ':p' => (int) $word['page'],
        ]);

        $row = kal_locked_row($pdo, $userId);
        $pdo->commit();
        return $row;
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
}

/** @return array<string,mixed>|null */
function kal_mistake_payload(?array $row): ?array
{
    if (!$row) return null;
    $count = (int) ($row['practice_count'] ?? 0);
    $target = max(1, (int) ($row['practice_target'] ?? 15));
    return [
        'mistake_id' => (int) $row['id'],
        'surah_number' => (int) $row['surah_number'],
        'ayah_number' => (int) $row['ayah_number'],
        'page_number' => (int) $row['page_number'],
        'mistake_type' => (string) $row['mistake_type'],
        'confused_with_surah' => isset($row['confused_with_surah']) && $row['confused_with_surah'] !== null
            ? (int) $row['confused_with_surah'] : null,
        'confused_with_ayah' => isset($row['confused_with_ayah']) && $row['confused_with_ayah'] !== null
            ? (int) $row['confused_with_ayah'] : null,
        'severity' => (int) ($row['severity'] ?? 1),
        'notes' => $row['notes'] ?? '',
        'practice_count' => $count,
        'practice_target' => $target,
        'remaining' => max(0, $target - $count),
        'progress_percent' => (int) round(($count / $target) * 100),
    ];
}

/** Return the locked mistake card, locking one when needed. */
function kal_ensure_gate_mistake(PDO $pdo, int $userId): ?array
{
    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare('SELECT `gate_mistake_id` FROM `users` WHERE `id` = :u FOR UPDATE');
        $stmt->execute([':u' => $userId]);
        $gateId = (int) ($stmt->fetchColumn() ?: 0);

        if ($gateId > 0) {
            $stmt = $pdo->prepare(
                "SELECT * FROM `mistakes`
                 WHERE `id` = :id AND `user_id` = :u AND `status` = 'ACTIVE'
                   AND `practice_count` < `practice_target`
                 LIMIT 1"
            );
            $stmt->execute([':id' => $gateId, ':u' => $userId]);
            $row = $stmt->fetch();
            if ($row) {
                $pdo->commit();
                return $row;
            }
        }

        $stmt = $pdo->prepare(
            "SELECT * FROM `mistakes`
             WHERE `user_id` = :u AND `status` = 'ACTIVE'
               AND `practice_count` < `practice_target`
             ORDER BY `practice_count` ASC, `occurrence_count` DESC, `id` ASC
             LIMIT 1"
        );
        $stmt->execute([':u' => $userId]);
        $row = $stmt->fetch();

        if ($row) {
            $stmt = $pdo->prepare(
                'UPDATE `users` SET `gate_mistake_id` = :mid, `gate_mistake_locked_at` = NOW() WHERE `id` = :u'
            );
            $stmt->execute([':mid' => (int) $row['id'], ':u' => $userId]);
            $pdo->commit();
            return $row;
        }

        $stmt = $pdo->prepare(
            'UPDATE `users` SET `gate_mistake_id` = NULL, `gate_mistake_locked_at` = NULL WHERE `id` = :u'
        );
        $stmt->execute([':u' => $userId]);
        $pdo->commit();
        return null;
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
}

/**
 * Build three distractor meanings from the same juz, then the wider catalog.
 *
 * @return array<int,array{id:int,text:string}>
 */
function kal_test_options(array $word, string $correct, int $count = 4): array
{
    $options = [$correct];
    $seen = [kal_norm_key($correct) => true];
    $juz = (int) (kal_meta()['page_juz'][(string) ((int) ($word['page'] ?? $word['page_number'] ?? 0))] ?? 0);
    $pool = kal_juz_words($juz);
    shuffle($pool);

    foreach ($pool as $candidate) {
        $meaning = trim((string) ($candidate['meaning'] ?? ''));
        if ($meaning === '' || isset($seen[kal_norm_key($meaning)])) continue;
        $seen[kal_norm_key($meaning)] = true;
        $options[] = $meaning;
        if (count($options) >= $count) break;
    }

    if (count($options) < $count) {
        $all = [];
        for ($j = 1; $j <= 30 && count($options) < $count; $j++) {
            foreach (kal_juz_words($j) as $candidate) {
                $meaning = trim((string) ($candidate['meaning'] ?? ''));
                if ($meaning === '' || isset($seen[kal_norm_key($meaning)])) continue;
                $seen[kal_norm_key($meaning)] = true;
                $options[] = $meaning;
                if (count($options) >= $count) break;
            }
        }
    }

    shuffle($options);
    $out = [];
    foreach ($options as $i => $text) {
        $out[] = ['id' => $i + 1, 'text' => $text];
    }
    return $out;
}

function kal_norm_key(string $text): string
{
    $t = preg_replace('/[\x{0610}-\x{061A}\x{064B}-\x{065F}\x{0670}\x{06D6}-\x{06ED}\x{0640}]/u', '', $text) ?? $text;
    // Match config/build_kalimaat.php so near-duplicate meanings collapse.
    $t = str_replace(['أ', 'إ', 'آ', 'ٱ'], 'ا', $t);
    $t = str_replace(['ى'], 'ي', $t);
    $t = str_replace(['ة'], 'ه', $t);
    $t = preg_replace('/[\x{060C}\x{061B}\x{061F}\x{066A}-\x{066D}\x{06D4}]/u', ' ', $t) ?? $t;
    $t = preg_replace('/\s+/u', ' ', $t) ?? $t;
    return trim($t);
}

/** @return array<string,int> */
function kal_user_stats(PDO $pdo, int $userId): array
{
    $stmt = $pdo->prepare(
        "SELECT
            COUNT(*) AS total_words,
            SUM(CASE WHEN `status` = 'LOCKED' THEN 1 ELSE 0 END) AS locked_words,
            SUM(CASE WHEN `status` = 'READY' THEN 1 ELSE 0 END) AS ready_words,
            SUM(CASE WHEN `status` = 'MASTERED' THEN 1 ELSE 0 END) AS mastered_words,
            COALESCE(SUM(`repeat_count`), 0) AS total_repetitions,
            COALESCE(SUM(CASE WHEN `repeat_count` > 0 AND `status` IN ('LOCKED', 'READY') THEN 1 ELSE 0 END), 0) AS test_pool
         FROM `kalimaat_progress` WHERE `user_id` = :u"
    );
    $stmt->execute([':u' => $userId]);
    $row = $stmt->fetch() ?: [];
    return [
        'total_words' => (int) ($row['total_words'] ?? 0),
        'locked_words' => (int) ($row['locked_words'] ?? 0),
        'ready_words' => (int) ($row['ready_words'] ?? 0),
        'mastered_words' => (int) ($row['mastered_words'] ?? 0),
        'total_repetitions' => (int) ($row['total_repetitions'] ?? 0),
        'test_pool' => (int) ($row['test_pool'] ?? 0),
    ];
}

/**
 * Started words in the user's zone: LOCKED practice words plus READY words.
 * MASTERED words and words with zero repetitions never enter a test cycle.
 *
 * Pass $createdBefore to freeze the pool at a cycle's start time, so a word
 * added from another tab mid-cycle cannot inflate or shrink the count.
 *
 * @return array{eligible:int,ready:int}
 */
function kal_test_pool_counts(PDO $pdo, int $userId, array $zone, ?string $createdBefore = null): array
{
    if ((int) $zone['end'] < (int) $zone['start']) {
        return ['eligible' => 0, 'ready' => 0];
    }
    $sql = "SELECT
            COUNT(*) AS eligible,
            COALESCE(SUM(CASE WHEN `status` = 'READY' THEN 1 ELSE 0 END), 0) AS ready
           FROM `kalimaat_progress`
          WHERE `user_id` = :u
            AND `repeat_count` > 0
            AND `status` IN ('LOCKED', 'READY')
            AND `page_number` BETWEEN :start AND :end";
    $params = [
        ':u' => $userId,
        ':start' => (int) $zone['start'],
        ':end' => (int) $zone['end'],
    ];
    if ($createdBefore !== null) {
        $sql .= ' AND `created_at` <= :cutoff';
        $params[':cutoff'] = $createdBefore;
    }
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $row = $stmt->fetch() ?: [];
    return [
        'eligible' => (int) ($row['eligible'] ?? 0),
        'ready' => (int) ($row['ready'] ?? 0),
    ];
}

/** How many questions this cycle is expected to cover. */
function kal_test_round_target(array $cycle): int
{
    $total = max(0, (int) ($cycle['eligible_total'] ?? 0));
    if (KALIMAAT_TEST_ROUND_LIMIT > 0) {
        return min($total, KALIMAAT_TEST_ROUND_LIMIT);
    }
    return $total;
}

/** @return array<string,int> */
function kal_test_cycle_counts(PDO $pdo, int $cycleId): array
{
    $stmt = $pdo->prepare(
        "SELECT
            COUNT(*) AS done,
            COALESCE(SUM(`correct`), 0) AS correct_count,
            COALESCE(SUM(`counted`), 0) AS counted_count
           FROM `kalimaat_test_attempts`
          WHERE `cycle_id` = :c"
    );
    $stmt->execute([':c' => $cycleId]);
    $row = $stmt->fetch() ?: [];
    return [
        'done' => (int) ($row['done'] ?? 0),
        'correct_count' => (int) ($row['correct_count'] ?? 0),
        'counted_count' => (int) ($row['counted_count'] ?? 0),
    ];
}

/** @return array<string,mixed> */
function kal_test_cycle_payload(PDO $pdo, array $cycle): array
{
    $counts = kal_test_cycle_counts($pdo, (int) $cycle['id']);
    $target = kal_test_round_target($cycle);
    $done = $counts['done'];
    return [
        'id' => (int) $cycle['id'],
        'cycle_no' => (int) $cycle['cycle_no'],
        'eligible_total' => (int) $cycle['eligible_total'],
        'ready_total' => (int) $cycle['ready_total'],
        'round_target' => $target,
        'done' => $done,
        'remaining' => max(0, $target - $done),
        'progress_percent' => $target > 0 ? min(100, (int) round(($done / $target) * 100)) : 0,
        'correct_count' => $counts['correct_count'],
        'counted_count' => $counts['counted_count'],
        'started_at' => $cycle['started_at'] ?? null,
        'completed_at' => $cycle['completed_at'] ?? null,
        'is_active' => empty($cycle['completed_at']),
    ];
}

/** @return array<string,mixed>|null */
function kal_test_active_cycle(PDO $pdo, int $userId): ?array
{
    $stmt = $pdo->prepare(
        'SELECT * FROM `kalimaat_test_cycles`
          WHERE `user_id` = :u AND `completed_at` IS NULL
          ORDER BY `cycle_no` DESC LIMIT 1'
    );
    $stmt->execute([':u' => $userId]);
    $row = $stmt->fetch();
    return $row ?: null;
}

/** @return array<string,mixed>|null */
function kal_test_last_cycle(PDO $pdo, int $userId): ?array
{
    $stmt = $pdo->prepare(
        'SELECT * FROM `kalimaat_test_cycles`
          WHERE `user_id` = :u
          ORDER BY `cycle_no` DESC LIMIT 1'
    );
    $stmt->execute([':u' => $userId]);
    $row = $stmt->fetch();
    return $row ?: null;
}

/**
 * Start the next cycle. The users row is locked so two tabs cannot create two
 * active cycles with the same number.
 *
 * @return array<string,mixed>|null Null when the zone has no started words.
 */
function kal_test_create_cycle(PDO $pdo, int $userId, array $zone): ?array
{
    if ((int) $zone['end'] < (int) $zone['start']) {
        return null;
    }

    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare('SELECT `id` FROM `users` WHERE `id` = :u FOR UPDATE');
        $stmt->execute([':u' => $userId]);

        $active = kal_test_active_cycle($pdo, $userId);
        if ($active) {
            $pdo->commit();
            return $active;
        }

        // Freeze the pool boundary before counting: the queue uses the same
        // timestamp, so words added later cannot be counted but unasked.
        $startedAt = date('Y-m-d H:i:s');

        $pool = kal_test_pool_counts($pdo, $userId, $zone, $startedAt);
        if ($pool['eligible'] <= 0) {
            $pdo->commit();
            return null;
        }

        $stmt = $pdo->prepare(
            'SELECT COALESCE(MAX(`cycle_no`), 0) + 1 FROM `kalimaat_test_cycles` WHERE `user_id` = :u'
        );
        $stmt->execute([':u' => $userId]);
        $cycleNo = (int) $stmt->fetchColumn();

        $stmt = $pdo->prepare(
            "INSERT INTO `kalimaat_test_cycles`
                (`user_id`, `cycle_no`, `eligible_total`, `ready_total`,
                 `zone_start`, `zone_end`, `started_at`)
             VALUES (:u, :n, :eligible, :ready, :zs, :ze, :started)"
        );
        $stmt->execute([
            ':u' => $userId,
            ':n' => $cycleNo,
            ':eligible' => $pool['eligible'],
            ':ready' => $pool['ready'],
            ':zs' => (int) $zone['start'],
            ':ze' => (int) $zone['end'],
            ':started' => $startedAt,
        ]);
        $cycleId = (int) $pdo->lastInsertId();

        $stmt = $pdo->prepare('SELECT * FROM `kalimaat_test_cycles` WHERE `id` = :id LIMIT 1');
        $stmt->execute([':id' => $cycleId]);
        $cycle = $stmt->fetch() ?: null;
        $pdo->commit();
        return $cycle;
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
}

/**
 * Pick a started word from the cycle's zone that has no attempt in this cycle.
 * This is the queue: once a word is answered it is never drawn again in the
 * same cycle, so the round always advances instead of looping on one word.
 *
 * @return array<string,mixed>|null
 */
function kal_test_next_word(PDO $pdo, int $userId, array $cycle): ?array
{
    $target = kal_test_round_target($cycle);
    if ($target <= 0) {
        return null;
    }

    $counts = kal_test_cycle_counts($pdo, (int) $cycle['id']);
    if ($counts['done'] >= $target) {
        return null;
    }

    $stmt = $pdo->prepare(
        "SELECT p.*
           FROM `kalimaat_progress` p
          WHERE p.`user_id` = :u
            AND p.`status` IN ('LOCKED', 'READY')
            AND p.`repeat_count` > 0
            AND p.`created_at` <= :started
            AND p.`page_number` BETWEEN :zs AND :ze
            AND NOT EXISTS (
                SELECT 1 FROM `kalimaat_test_attempts` a
                 WHERE a.`cycle_id` = :cycle AND a.`word_key` = p.`word_key`
            )
          ORDER BY RAND()
          LIMIT 1"
    );
    $stmt->execute([
        ':u' => $userId,
        ':started' => (string) $cycle['started_at'],
        ':zs' => (int) ($cycle['zone_start'] ?? 1),
        ':ze' => (int) ($cycle['zone_end'] ?? 604),
        ':cycle' => (int) $cycle['id'],
    ]);
    $row = $stmt->fetch();
    return $row ?: null;
}

/** Mark a cycle finished once every due word has an attempt. */
function kal_test_finish_if_done(PDO $pdo, array $cycle): array
{
    if (!empty($cycle['completed_at'])) {
        return $cycle;
    }
    $counts = kal_test_cycle_counts($pdo, (int) $cycle['id']);
    if ($counts['done'] < kal_test_round_target($cycle)) {
        return $cycle;
    }
    $stmt = $pdo->prepare(
        'UPDATE `kalimaat_test_cycles` SET `completed_at` = NOW()
          WHERE `id` = :id AND `completed_at` IS NULL'
    );
    $stmt->execute([':id' => (int) $cycle['id']]);
    $cycle['completed_at'] = date('Y-m-d H:i:s');
    return $cycle;
}

/**
 * Force-complete a cycle that has no drawable question left. This protects the
 * UI from a dead "next question" loop if old data and the snapshot disagree.
 */
function kal_test_close_cycle(PDO $pdo, array $cycle): array
{
    if (!empty($cycle['completed_at'])) {
        return $cycle;
    }
    $stmt = $pdo->prepare(
        'UPDATE `kalimaat_test_cycles` SET `completed_at` = NOW()
          WHERE `id` = :id AND `completed_at` IS NULL'
    );
    $stmt->execute([':id' => (int) $cycle['id']]);
    $cycle['completed_at'] = date('Y-m-d H:i:s');
    return $cycle;
}

/**
 * Why a cycle cannot start, using the three observable states.
 *
 * @return array{reason:string,pool:array{eligible:int,ready:int}}
 */
function kal_test_no_pool_state(PDO $pdo, int $userId, array $zone): array
{
    $pool = kal_test_pool_counts($pdo, $userId, $zone);
    if ((int) $zone['end'] < (int) $zone['start']) {
        return ['reason' => 'ZONE_EMPTY', 'pool' => $pool];
    }

    $stmt = $pdo->prepare(
        "SELECT
            COUNT(*) AS words,
            COALESCE(SUM(CASE WHEN `status` = 'MASTERED' THEN 1 ELSE 0 END), 0) AS mastered,
            COALESCE(SUM(CASE WHEN `repeat_count` > 0 AND `status` IN ('LOCKED', 'READY') THEN 1 ELSE 0 END), 0) AS started
           FROM `kalimaat_progress`
          WHERE `user_id` = :u AND `page_number` BETWEEN :start AND :end"
    );
    $stmt->execute([
        ':u' => $userId,
        ':start' => (int) $zone['start'],
        ':end' => (int) $zone['end'],
    ]);
    $row = $stmt->fetch() ?: [];
    $words = (int) ($row['words'] ?? 0);
    $mastered = (int) ($row['mastered'] ?? 0);
    $started = (int) ($row['started'] ?? 0);

    if ($started <= 0 && $mastered > 0 && $mastered >= $words) {
        return ['reason' => 'ALL_MASTERED', 'pool' => $pool];
    }
    return ['reason' => 'NO_STARTED_WORDS', 'pool' => $pool];
}

/** @return array<string,mixed> */
function kal_test_question_payload(array $row, ?array $cycle = null): array
{
    $payload = kal_word_payload([], $row);
    $wasReady = (string) $row['status'] === 'READY';
    if ($wasReady && $cycle !== null) {
        $wasReady = empty($row['last_repeated_at'])
            || (string) $row['last_repeated_at'] <= (string) $cycle['started_at'];
    }
    return [
        'word' => $payload,
        'options' => kal_test_options($payload, (string) $row['meaning']),
        'was_ready' => $wasReady,
        'mastery_correct' => KALIMAAT_TEST_MASTERY_CORRECT,
    ];
}

/** Recompute mastery from attempts only, capped at the mastery target. */
function kal_test_correct_count(PDO $pdo, int $userId, string $wordKey): int
{
    $stmt = $pdo->prepare(
        'SELECT COUNT(DISTINCT `cycle_id`) FROM `kalimaat_test_attempts`
          WHERE `user_id` = :u AND `word_key` = :k AND `correct` = 1 AND `counted` = 1'
    );
    $stmt->execute([':u' => $userId, ':k' => $wordKey]);
    return min(KALIMAAT_TEST_MASTERY_CORRECT, (int) $stmt->fetchColumn());
}
