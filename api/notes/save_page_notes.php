<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Page Notes (save)
 *
 * POST JSON: page_number (1..604), note (string, <= 20000 chars)
 * Upserts one note per (user, page). An empty note deletes the row so empty
 * pages stay clean. Returns `available:false` (with success) when the
 * page_notes table has not been created yet.
 */

require __DIR__ . '/../../config/database.php';

function json_out(int $code, array $payload): void
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    json_out(400, ['success' => false, 'error' => 'Method not allowed. Use POST.']);
}

$input = $_GET;
$raw   = file_get_contents('php://input');
if (is_string($raw) && $raw !== '') {
    $json = json_decode($raw, true);
    if (!is_array($json)) {
        json_out(400, ['success' => false, 'error' => 'Invalid JSON payload.']);
    }
    $input = array_merge($input, $json);
} elseif (!empty($_POST)) {
    $input = array_merge($input, $_POST);
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

require_once __DIR__ . '/../../config/auth.php';

// Session is authoritative. A client-supplied user_id is accepted only from an
// administrator (so the admin panel can act on other accounts).
$authUser = rh_require_login($pdo);
$userId   = rh_resolve_user_id($pdo, $authUser, $input['user_id'] ?? null);

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

$pageRaw = $input['page_number'] ?? null;
if (!ctype_digit((string) $pageRaw)) {
    json_out(400, ['success' => false, 'error' => 'page_number must be an integer between 1 and 604.']);
}
$pageNumber = (int) $pageRaw;
if ($pageNumber < 1 || $pageNumber > 604) {
    json_out(400, ['success' => false, 'error' => 'page_number must be between 1 and 604.']);
}

$note = $input['note'] ?? '';
if (!is_string($note)) {
    json_out(400, ['success' => false, 'error' => 'note must be a string.']);
}
// Normalise line endings and trim trailing whitespace-only content.
$note = str_replace(["\r\n", "\r"], "\n", $note);
if (mb_strlen($note) > 20000) {
    json_out(400, ['success' => false, 'error' => 'note must be at most 20000 characters.']);
}
$isEmpty = trim($note) === '';

try {
    $stmt = $pdo->prepare('SELECT `id` FROM `users` WHERE `id` = :id');
    $stmt->execute([':id' => $userId]);
    if (!$stmt->fetch()) {
        json_out(401, ['success' => false, 'error' => 'Authentication required.']);
    }

    try {
        $pdo->query('SELECT 1 FROM `page_notes` LIMIT 1');
    } catch (Throwable $t) {
        json_out(200, [
            'success'     => true,
            'available'   => false,
            'page_number' => $pageNumber,
            'note'        => $note,
            'updated_at'  => null,
        ]);
    }

    if ($isEmpty) {
        $stmt = $pdo->prepare('DELETE FROM `page_notes` WHERE `user_id` = :u AND `page_number` = :p');
        $stmt->execute([':u' => $userId, ':p' => $pageNumber]);

        json_out(200, [
            'success'     => true,
            'available'   => true,
            'page_number' => $pageNumber,
            'note'        => '',
            'updated_at'  => null,
        ]);
    }

    $stmt = $pdo->prepare(
        'INSERT INTO `page_notes` (`user_id`, `page_number`, `note`)
         VALUES (:u, :p, :n)
         ON DUPLICATE KEY UPDATE `note` = VALUES(`note`), `updated_at` = CURRENT_TIMESTAMP'
    );
    $stmt->execute([':u' => $userId, ':p' => $pageNumber, ':n' => $note]);

    $stmt = $pdo->prepare(
        'SELECT `note`, `updated_at` FROM `page_notes`
         WHERE `user_id` = :u AND `page_number` = :p LIMIT 1'
    );
    $stmt->execute([':u' => $userId, ':p' => $pageNumber]);
    $row = $stmt->fetch();

    json_out(200, [
        'success'     => true,
        'available'   => true,
        'page_number' => $pageNumber,
        'note'        => $row ? (string) ($row['note'] ?? '') : $note,
        'updated_at'  => $row ? (string) $row['updated_at'] : null,
    ]);
} catch (PDOException $e) {
    error_log('[SavePageNotes Failed] ' . $e->getMessage());
    json_out(500, ['success' => false, 'error' => 'Server error. Please try again.']);
}
