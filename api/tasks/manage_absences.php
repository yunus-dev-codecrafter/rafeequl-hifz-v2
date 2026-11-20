<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Planned Absence Management
 * GET: returns list of planned absences and remaining quota
 * POST JSON:
 *   action: 'ADD' | 'REMOVE'
 *   date: 'YYYY-MM-DD'
 *   notes?: string
 */

require __DIR__ . '/../../config/database.php';
require_once __DIR__ . '/../../config/auth.php';
require_once __DIR__ . '/_tafreet.php';

function json_out(int $code, array $payload): void
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

$authUser = rh_require_login($pdo);
$userId   = (int) $authUser['id'];

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    $info = rh_get_user_absences($pdo, $userId);
    json_out(200, array_merge(['success' => true], $info));
}

if ($method === 'POST') {
    $raw = file_get_contents('php://input');
    $input = [];
    if (is_string($raw) && $raw !== '') {
        $json = json_decode($raw, true);
        if (is_array($json)) {
            $input = $json;
        }
    }
    if (empty($input) && !empty($_POST)) {
        $input = $_POST;
    }

    $action = strtoupper((string) ($input['action'] ?? ''));
    $date   = trim((string) ($input['date'] ?? ''));
    $notes  = isset($input['notes']) ? trim((string) $input['notes']) : null;

    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
        json_out(400, ['success' => false, 'error' => 'صيغة التاريخ غير صحيحة (YYYY-MM-DD).']);
    }

    if ($action === 'ADD') {
        $res = rh_add_user_absence($pdo, $userId, $date, $notes);
        if (!$res['success']) {
            json_out(400, $res);
        }
        $info = rh_get_user_absences($pdo, $userId);
        json_out(200, array_merge(['success' => true, 'message' => 'تم تسجيل يوم الغياب بنجاح.'], $info));
    }

    if ($action === 'REMOVE') {
        $ok = rh_remove_user_absence($pdo, $userId, $date);
        $info = rh_get_user_absences($pdo, $userId);
        json_out(200, array_merge([
            'success' => true,
            'message' => $ok ? 'تم إلغاء يوم الغياب.' : 'لم يتم العثور على هذا التاريخ.',
        ], $info));
    }

    json_out(400, ['success' => false, 'error' => 'الإجراء غير مدعوم.']);
}

json_out(405, ['success' => false, 'error' => 'طريقة الطلب غير مسموح بها.']);
