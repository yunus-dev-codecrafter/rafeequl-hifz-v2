<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Page Notes (read)
 *
 * Returns the user's own quick-recall note(s) for one mushaf page or a range.
 *
 * GET or POST parameters:
 *   page_number  (optional) single page, 1..604
 *   from, to     (optional) inclusive range, 1..604
 *
 * Response (single):
 *   { success, available, page_number, note, updated_at }
 * Response (range / all):
 *   { success, available, notes: { "<page>": { note, updated_at } } }
 *
 * `available:false` means the page_notes table is not installed yet; the
 * client then keeps notes locally and retries later.
 */

require __DIR__ . '/../../config/database.php';

function json_out(int $code, array $payload): void
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

// ---------------------------------------------------------------------------
// Method & input
// ---------------------------------------------------------------------------

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if (!in_array($method, ['GET', 'POST'], true)) {
    json_out(400, ['success' => false, 'error' => 'Method not allowed. Use GET or POST.']);
}

$input = $_GET;
if ($method === 'POST') {
    $raw = file_get_contents('php://input');
    if (is_string($raw) && $raw !== '') {
        $json = json_decode($raw, true);
        if (!is_array($json)) {
            json_out(400, ['success' => false, 'error' => 'Invalid JSON payload.']);
        }
        $input = array_merge($input, $json);
    } elseif (!empty($_POST)) {
        $input = array_merge($input, $_POST);
    }
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

$userId = $input['user_id'] ?? $_SESSION['user_id'] ?? null;
if ($userId === null || $userId === '') {
    json_out(401, ['success' => false, 'error' => 'Authentication required.']);
}
if (!filter_var($userId, FILTER_VALIDATE_INT)) {
    json_out(400, ['success' => false, 'error' => 'Invalid user_id.']);
}
$userId = (int) $userId;

function read_opt_page($value): ?int
{
    if ($value === null || $value === '') {
        return null;
    }
    if (ctype_digit((string) $value)) {
        return (int) $value;
    }
    return null;
}

$pageNumber = read_opt_page($input['page_number'] ?? null);
$from       = read_opt_page($input['from'] ?? null);
$to         = read_opt_page($input['to'] ?? null);

if ($pageNumber !== null && ($pageNumber < 1 || $pageNumber > 604)) {
    json_out(400, ['success' => false, 'error' => 'page_number must be between 1 and 604.']);
}
if ($from !== null && ($from < 1 || $from > 604)) {
    json_out(400, ['success' => false, 'error' => 'from must be between 1 and 604.']);
}
if ($to !== null && ($to < 1 || $to > 604)) {
    json_out(400, ['success' => false, 'error' => 'to must be between 1 and 604.']);
}
if ($from !== null && $to !== null && $to < $from) {
    [$from, $to] = [$to, $from];
}

try {
    $stmt = $pdo->prepare('SELECT `id` FROM `users` WHERE `id` = :id');
    $stmt->execute([':id' => $userId]);
    if (!$stmt->fetch()) {
        json_out(401, ['success' => false, 'error' => 'Authentication required.']);
    }

    // Notes are opt-in storage; tolerate a database that has not been migrated.
    try {
        $pdo->query('SELECT 1 FROM `page_notes` LIMIT 1');
    } catch (Throwable $t) {
        json_out(200, [
            'success'    => true,
            'available'  => false,
            'notes'      => [],
            'page_number' => $pageNumber,
            'note'       => null,
            'updated_at' => null,
        ]);
    }

    if ($pageNumber !== null) {
        $stmt = $pdo->prepare(
            'SELECT `page_number`, `note`, `updated_at`
             FROM `page_notes`
             WHERE `user_id` = :u AND `page_number` = :p
             LIMIT 1'
        );
        $stmt->execute([':u' => $userId, ':p' => $pageNumber]);
        $row = $stmt->fetch();

        json_out(200, [
            'success'     => true,
            'available'   => true,
            'page_number' => $pageNumber,
            'note'        => $row ? (string) ($row['note'] ?? '') : '',
            'updated_at'  => $row ? (string) $row['updated_at'] : null,
        ]);
    }

    $sql = 'SELECT `page_number`, `note`, `updated_at` FROM `page_notes` WHERE `user_id` = :u';
    $params = [':u' => $userId];
    if ($from !== null && $to !== null) {
        $sql .= ' AND `page_number` BETWEEN :f AND :t';
        $params[':f'] = $from;
        $params[':t'] = $to;
    }
    $sql .= ' ORDER BY `page_number` ASC';

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);

    $notes = [];
    foreach ($stmt->fetchAll() as $row) {
        $notes[(string) (int) $row['page_number']] = [
            'note'       => (string) ($row['note'] ?? ''),
            'updated_at' => (string) $row['updated_at'],
        ];
    }

    json_out(200, [
        'success'   => true,
        'available' => true,
        'notes'     => $notes,
    ]);
} catch (PDOException $e) {
    error_log('[GetPageNotes Failed] ' . $e->getMessage());
    json_out(500, ['success' => false, 'error' => 'Server error. Please try again.']);
}
