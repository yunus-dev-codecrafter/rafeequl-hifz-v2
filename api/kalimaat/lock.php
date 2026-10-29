<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Manually lock a kalimaat word (dedicated page only).
 * POST JSON: word_key, page_number
 *
 * Automatic lock selection happens in get_entry.php. This endpoint exists so a
 * user can browse the catalog and choose a word when nothing is locked.
 */

require __DIR__ . '/../../config/database.php';
require_once __DIR__ . '/../../config/auth.php';
require_once __DIR__ . '/_catalog.php';

try {
    $input = kal_require_post();
    $authUser = rh_require_login($pdo);
    $userId = (int) $authUser['id'];

    $key = trim((string) ($input['word_key'] ?? ''));
    $page = (int) ($input['page_number'] ?? 0);
    if (strlen($key) !== 40 || $page < 1 || $page > 604) {
        kal_json_out(400, ['success' => false, 'error' => 'Invalid word_key or page_number.']);
    }

    $zone = kal_zone($pdo, $userId);
    if ($page < $zone['start'] || $page > $zone['end']) {
        kal_json_out(403, ['success' => false, 'error' => 'This page is outside your memorization zone.']);
    }

    $word = kal_find_word($page, $key);
    if (!$word) {
        kal_json_out(404, ['success' => false, 'error' => 'Word not found on this page.']);
    }

    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare('SELECT `id` FROM `users` WHERE `id` = :u FOR UPDATE');
        $stmt->execute([':u' => $userId]);

        $existing = kal_locked_row($pdo, $userId);
        if ($existing) {
            $pdo->commit();
            kal_json_out(200, [
                'success' => true,
                'already_locked' => true,
                'word' => kal_word_payload([], $existing),
            ]);
        }

        $stmt = $pdo->prepare(
            'SELECT `id` FROM `kalimaat_progress` WHERE `user_id` = :u AND `word_key` = :k LIMIT 1'
        );
        $stmt->execute([':u' => $userId, ':k' => $key]);
        if ($stmt->fetchColumn()) {
            $pdo->rollBack();
            kal_json_out(409, [
                'success' => false,
                'code' => 'ALREADY_STARTED',
                'error' => 'This word already has progress and is no longer lockable.',
            ]);
        }

        $stmt = $pdo->prepare(
            "INSERT INTO `kalimaat_progress`
                (`user_id`, `word_key`, `word_text`, `meaning`, `book_name`,
                 `surah_number`, `ayah_number`, `page_number`, `repeat_count`,
                 `status`, `locked_at`)
             VALUES
                (:u, :k, :t, :m, :b, :s, :a, :p, 0, 'LOCKED', NOW())"
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
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }

    kal_json_out(200, [
        'success' => true,
        'already_locked' => false,
        'word' => $row ? kal_word_payload([], $row) : kal_word_payload($word, null),
        'stats' => kal_user_stats($pdo, $userId),
    ]);
} catch (Throwable $e) {
    error_log('[Kalimaat lock] ' . $e->getMessage());
    kal_json_out(500, ['success' => false, 'error' => 'Server error. Please try again.']);
}
