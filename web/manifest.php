<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Web App Manifest PHP Delivery
 *
 * Emits the manifest with appropriate headers and credentials support
 * for shared hosting and mobile browsers.
 */

header('Content-Type: application/manifest+json; charset=utf-8');
header('Cache-Control: public, max-age=3600');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Credentials: true');
header('X-Content-Type-Options: nosniff');

$manifestFile = __DIR__ . '/manifest.json';
if (is_file($manifestFile)) {
    readfile($manifestFile);
} else {
    http_response_code(404);
    echo json_encode(['error' => 'manifest.json not found']);
}
exit();
