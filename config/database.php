<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - PDO Database Connection
 * Connects safely to MySQL using utf8mb4 charset.
 */

// Set to true when uploaded to InfinityFree, or false when testing on local XAMPP
$is_production = true; 

if ($is_production) {
    // InfinityFree Live Credentials
    $host = 'sql303.infinityfree.com';
    $port = '3306';
    $name = 'if0_43086824_rafeequlhifz_db';
    $user = 'if0_43086824';
    $pass = 'rafeequlhifz081';
} else {
    // Local XAMPP Credentials
    $host = '127.0.0.1';
    $port = '3306';
    $name = 'rafeequl_hifz';
    $user = 'root';
    $pass = '';
}

$dsn = sprintf(
    'mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4',
    $host,
    $port,
    $name
);

$options = [
    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES   => false,
    PDO::ATTR_STRINGIFY_FETCHES  => false,
];

try {
    $pdo = new PDO($dsn, $user, $pass, $options);
} catch (PDOException $e) {
    error_log('[DB Connection Failed] ' . $e->getMessage());
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(
        ['success' => false, 'error' => 'Database connection failed.'],
        JSON_UNESCAPED_UNICODE
    );
    exit;
}