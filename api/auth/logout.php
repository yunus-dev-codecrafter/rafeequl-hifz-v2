<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Logout
 *
 * Really ends the session server-side (the previous "logout" only cleared a
 * localStorage name, leaving the session valid). POST (or GET) is accepted so
 * a plain link works.
 */

require __DIR__ . '/../../config/auth.php';

rh_session_start();
rh_destroy_session();

header('Content-Type: application/json; charset=utf-8');
echo json_encode(['success' => true], JSON_UNESCAPED_UNICODE);
