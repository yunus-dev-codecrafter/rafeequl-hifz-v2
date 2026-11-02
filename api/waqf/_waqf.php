<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - shared helpers for flagged waqf stations.
 *
 * A flagged waqf is one exact stop-station inside an ayah. It is created from
 * the Rub' Consolidation page, practised 10 times in the third step of the
 * entry gate, and can be deleted by the user after it is complete.
 */

require_once __DIR__ . '/../tasks/_rub.php';
require_once __DIR__ . '/../mistakes/_practice.php';

const WAQF_PRACTICE_TARGET = 10;

function waqf_json_out(int $code, array $payload): void
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, max-age=0');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

/** Read GET plus an optional JSON/form body. */
function waqf_read_input(): array
{
    $input = $_GET;
    $raw = file_get_contents('php://input');
    if (is_string($raw) && $raw !== '') {
        $json = json_decode($raw, true);
        if (!is_array($json)) {
            waqf_json_out(400, ['success' => false, 'error' => 'Invalid JSON payload.']);
        }
        $input = array_merge($input, $json);
    } elseif (!empty($_POST)) {
        $input = array_merge($input, $_POST);
    }
    return $input;
}

function waqf_int($value, int $default = 0): int
{
    if (is_string($value) && ctype_digit($value)) {
        return (int) $value;
    }
    return is_int($value) ? $value : $default;
}

function waqf_clean_notes($value): ?string
{
    if (!is_string($value)) {
        return null;
    }
    $value = trim($value);
    if ($value === '') {
        return null;
    }
    return mb_substr($value, 0, 1000, 'UTF-8');
}

/**
 * True when (surah, ayah) falls inside the given rub'.
 */
function waqf_verse_in_rub(array $rub, int $surah, int $ayah): bool
{
    $ss = (int) ($rub['start']['surah'] ?? 0);
    $sa = (int) ($rub['start']['ayah'] ?? 0);
    $es = (int) ($rub['end']['surah'] ?? 0);
    $ea = (int) ($rub['end']['ayah'] ?? 0);

    if ($ss <= 0 || $es <= 0) {
        return false;
    }

    $afterStart = $surah > $ss || ($surah === $ss && $ayah >= $sa);
    $beforeEnd = $surah < $es || ($surah === $es && $ayah <= $ea);
    return $afterStart && $beforeEnd;
}

/**
 * Validate one station and return its canonical server-side data.
 *
 * @return array<string,mixed>|null
 */
function waqf_find_station(int $rubId, int $surah, int $ayah, int $segmentIndex): ?array
{
    $rub = rh_rub_by_id($rubId);
    if ($rub === null || $surah < 1 || $surah > 114 || $ayah < 1 || $segmentIndex < 0) {
        return null;
    }
    if (!waqf_verse_in_rub($rub, $surah, $ayah)) {
        return null;
    }

    $quran = rh_load_quran();
    $verseText = rh_verse_text($quran, $surah, $ayah);
    if ($verseText === '') {
        return null;
    }

    $split = rh_split_verse($verseText);
    $segments = $split['segments'];
    if (!isset($segments[$segmentIndex]) || !is_array($segments[$segmentIndex])) {
        return null;
    }

    $segment = $segments[$segmentIndex];
    $segmentText = trim((string) ($segment['text'] ?? ''));
    if ($segmentText === '') {
        return null;
    }

    $pageMap = rh_verse_page_map();
    $highlight = waqf_highlight_parts($verseText, $segmentText);

    return [
        'rub_id'         => $rubId,
        'surah_number'   => $surah,
        'ayah_number'    => $ayah,
        'page_number'    => (int) ($pageMap[$surah . ':' . $ayah] ?? 0),
        'segment_index'  => $segmentIndex,
        'station_key'    => $surah . ':' . $ayah . ':' . $segmentIndex,
        'segment_text'   => $segmentText,
        'stop_sign'      => $segment['stop'] ?? null,
        'stop_ar'        => (string) ($segment['stop_ar'] ?? ''),
        'stop_en'        => (string) ($segment['stop_en'] ?? ''),
        'verse_text'     => $verseText,
        'highlight'      => $highlight,
    ];
}

/**
 * Split a verse around its flagged segment so the client can paint it red
 * without any text-matching logic of its own.
 *
 * @return array{before:string,flag:string,after:string,found:bool}
 */
function waqf_highlight_parts(string $verse, string $segment): array
{
    if ($segment === '') {
        return ['before' => '', 'flag' => '', 'after' => '', 'found' => false];
    }

    $pos = mb_strpos($verse, $segment, 0, 'UTF-8');
    if ($pos === false) {
        return ['before' => '', 'flag' => '', 'after' => '', 'found' => false];
    }

    $len = mb_strlen($segment, 'UTF-8');
    return [
        'before' => mb_substr($verse, 0, $pos, 'UTF-8'),
        'flag'   => $segment,
        'after'  => mb_substr($verse, $pos + $len, null, 'UTF-8'),
        'found'  => true,
    ];
}

/** @return array<string,mixed>|null */
function waqf_payload(?array $row, bool $withVerse = false): ?array
{
    if (!$row) {
        return null;
    }

    $count = max(0, (int) ($row['practice_count'] ?? 0));
    $target = max(1, (int) ($row['practice_target'] ?? WAQF_PRACTICE_TARGET));

    $out = [
        'waqf_id'         => (int) $row['id'],
        'rub_id'          => (int) $row['rub_id'],
        'surah_number'    => (int) $row['surah_number'],
        'ayah_number'     => (int) $row['ayah_number'],
        'page_number'     => (int) $row['page_number'],
        'segment_index'   => (int) $row['segment_index'],
        'station_key'     => (string) $row['station_key'],
        'segment_text'    => (string) $row['segment_text'],
        'stop_sign'       => $row['stop_sign'] ?? null,
        'notes'           => (string) ($row['notes'] ?? ''),
        'status'          => (string) ($row['status'] ?? 'ACTIVE'),
        'practice_count'  => $count,
        'practice_target' => $target,
        'remaining'       => max(0, $target - $count),
        'progress_percent' => (int) round(($count / $target) * 100),
        'occurrence_count' => (int) ($row['occurrence_count'] ?? 1),
        'last_reviewed_at' => $row['last_reviewed_at'] ?? null,
        'graduated_at'    => $row['graduated_at'] ?? null,
        'created_at'      => $row['created_at'] ?? null,
    ];

    $stop = waqf_stop_info((string) ($row['stop_sign'] ?? ''));
    $out['stop_ar'] = $stop['ar'];
    $out['stop_en'] = $stop['en'];

    if ($withVerse) {
        $verseText = rh_verse_text(
            rh_load_quran(),
            (int) $row['surah_number'],
            (int) $row['ayah_number']
        );
        $highlight = waqf_highlight_parts($verseText, (string) $row['segment_text']);
        $out['verse_text'] = $verseText;
        $out['before'] = $highlight['before'];
        $out['flag'] = $highlight['flag'];
        $out['after'] = $highlight['after'];
        $out['highlight_found'] = $highlight['found'];
    }

    return $out;
}

/** @return array{ar:string,en:string} */
function waqf_stop_info(string $key): array
{
    if ($key === '') {
        return ['ar' => '', 'en' => ''];
    }
    foreach (rh_waqf_marks() as $mark) {
        if ((string) ($mark['key'] ?? '') === $key) {
            return ['ar' => (string) ($mark['ar'] ?? ''), 'en' => (string) ($mark['en'] ?? '')];
        }
    }
    return ['ar' => '', 'en' => ''];
}

/** Fetch one flag that belongs to the user. */
function waqf_fetch(PDO $pdo, int $userId, int $waqfId): ?array
{
    $stmt = $pdo->prepare('SELECT * FROM `waqf_flags` WHERE `id` = :id AND `user_id` = :u LIMIT 1');
    $stmt->execute([':id' => $waqfId, ':u' => $userId]);
    $row = $stmt->fetch();
    return $row ?: null;
}

/**
 * Return the flag locked in the entry gate, locking one when needed.
 */
function waqf_ensure_gate(PDO $pdo, int $userId): ?array
{
    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare('SELECT `gate_waqf_id` FROM `users` WHERE `id` = :u FOR UPDATE');
        $stmt->execute([':u' => $userId]);
        $gateId = (int) ($stmt->fetchColumn() ?: 0);

        if ($gateId > 0) {
            $stmt = $pdo->prepare(
                "SELECT * FROM `waqf_flags`
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
            "SELECT * FROM `waqf_flags`
             WHERE `user_id` = :u AND `status` = 'ACTIVE'
               AND `practice_count` < `practice_target`
             ORDER BY `practice_count` ASC, `occurrence_count` DESC, `id` ASC
             LIMIT 1"
        );
        $stmt->execute([':u' => $userId]);
        $row = $stmt->fetch();

        if ($row) {
            $stmt = $pdo->prepare(
                'UPDATE `users` SET `gate_waqf_id` = :wid, `gate_waqf_locked_at` = NOW() WHERE `id` = :u'
            );
            $stmt->execute([':wid' => (int) $row['id'], ':u' => $userId]);
            $pdo->commit();
            return $row;
        }

        $stmt = $pdo->prepare(
            'UPDATE `users` SET `gate_waqf_id` = NULL, `gate_waqf_locked_at` = NULL WHERE `id` = :u'
        );
        $stmt->execute([':u' => $userId]);
        $pdo->commit();
        return null;
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $e;
    }
}
