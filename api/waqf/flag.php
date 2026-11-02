<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Flag one exact waqf station.
 * POST JSON: rub_id, surah_number, ayah_number, segment_index, notes?
 *
 * The station is validated against the rub' catalog and the real Uthmani
 * splitter, so a client cannot invent a stop-station that does not exist.
 */

require __DIR__ . '/../../config/database.php';
require_once __DIR__ . '/../../config/auth.php';
require_once __DIR__ . '/_waqf.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    waqf_json_out(400, ['success' => false, 'error' => 'Method not allowed. Use POST.']);
}

$input = waqf_read_input();
$authUser = rh_require_login($pdo);
$userId = (int) $authUser['id'];

$rubId = waqf_int($input['rub_id'] ?? null);
$surah = waqf_int($input['surah_number'] ?? null);
$ayah = waqf_int($input['ayah_number'] ?? null);
$segmentIndex = waqf_int($input['segment_index'] ?? null, -1);
$notes = waqf_clean_notes($input['notes'] ?? null);

if ($rubId < 1 || $rubId > 240) {
    waqf_json_out(400, ['success' => false, 'errors' => ['rub_id' => 'rub_id must be between 1 and 240.']]);
}
if ($surah < 1 || $surah > 114 || $ayah < 1 || $segmentIndex < 0) {
    waqf_json_out(400, ['success' => false, 'error' => 'Invalid station reference.']);
}

$station = waqf_find_station($rubId, $surah, $ayah, $segmentIndex);
if ($station === null) {
    waqf_json_out(400, ['success' => false, 'error' => 'This waqf station was not found in the selected rub.']);
}

try {
    $stmt = $pdo->prepare(
        'SELECT * FROM `waqf_flags` WHERE `user_id` = :u AND `station_key` = :k LIMIT 1'
    );
    $stmt->execute([':u' => $userId, ':k' => $station['station_key']]);
    $existing = $stmt->fetch();

    if ($existing) {
        if ((string) $existing['status'] === 'ACTIVE') {
            $upd = $pdo->prepare(
                'UPDATE `waqf_flags`
                 SET `occurrence_count` = `occurrence_count` + 1,
                     `notes` = COALESCE(:notes, `notes`),
                     `last_reviewed_at` = `last_reviewed_at`
                 WHERE `id` = :id AND `user_id` = :u'
            );
            $upd->execute([':notes' => $notes, ':id' => (int) $existing['id'], ':u' => $userId]);
            $waqfId = (int) $existing['id'];
        } else {
            $upd = $pdo->prepare(
                "UPDATE `waqf_flags`
                 SET `rub_id` = :rub,
                     `page_number` = :page,
                     `segment_text` = :text,
                     `stop_sign` = :stop,
                     `notes` = COALESCE(:notes, `notes`),
                     `status` = 'ACTIVE',
                     `practice_count` = 0,
                     `practice_target` = :target,
                     `occurrence_count` = `occurrence_count` + 1,
                     `graduated_at` = NULL,
                     `last_reviewed_at` = NULL
                 WHERE `id` = :id AND `user_id` = :u"
            );
            $upd->execute([
                ':rub' => $rubId,
                ':page' => (int) $station['page_number'],
                ':text' => (string) $station['segment_text'],
                ':stop' => $station['stop_sign'],
                ':notes' => $notes,
                ':target' => WAQF_PRACTICE_TARGET,
                ':id' => (int) $existing['id'],
                ':u' => $userId,
            ]);
            $waqfId = (int) $existing['id'];
        }
    } else {
        $ins = $pdo->prepare(
            'INSERT INTO `waqf_flags`
                (`user_id`, `rub_id`, `surah_number`, `ayah_number`, `page_number`,
                 `segment_index`, `station_key`, `segment_text`, `stop_sign`, `notes`,
                 `practice_count`, `practice_target`, `occurrence_count`)
             VALUES
                (:u, :rub, :surah, :ayah, :page, :idx, :key, :text, :stop, :notes,
                 0, :target, 1)'
        );
        $ins->execute([
            ':u' => $userId,
            ':rub' => $rubId,
            ':surah' => $surah,
            ':ayah' => $ayah,
            ':page' => (int) $station['page_number'],
            ':idx' => $segmentIndex,
            ':key' => (string) $station['station_key'],
            ':text' => (string) $station['segment_text'],
            ':stop' => $station['stop_sign'],
            ':notes' => $notes,
            ':target' => WAQF_PRACTICE_TARGET,
        ]);
        $waqfId = (int) $pdo->lastInsertId();
    }

    $row = waqf_fetch($pdo, $userId, $waqfId);
    waqf_json_out(200, [
        'success' => true,
        'flag' => waqf_payload($row),
        'reactivated' => $existing && (string) $existing['status'] !== 'ACTIVE',
    ]);
} catch (PDOException $e) {
    error_log('[Waqf flag] ' . $e->getMessage());
    waqf_json_out(500, ['success' => false, 'error' => 'Server error. Please try again.']);
}
