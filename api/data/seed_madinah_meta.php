<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Seed Script
 * Populates `madinah_pages_meta` with standard Madinah Mushaf metadata
 * for pages 1 through 604 (Juz, Hizb, Rub' el Hizb, Surah/Ayah boundaries).
 *
 * Usage:
 *   CLI: php api/data/seed_madinah_meta.php
 *   Web: Open in browser (e.g. http://localhost/rafeequl_hifz/api/data/seed_madinah_meta.php)
 */

require __DIR__ . '/../../config/database.php';

$isCli = (PHP_SAPI === 'cli');
if (!$isCli) {
    header('Content-Type: text/plain; charset=utf-8');
    if (($_GET['confirm'] ?? '') !== '1') {
        http_response_code(400);
        echo "Refusing to run. Append ?confirm=1, or use setup.php. Prefer CLI.\n";
        exit;
    }
}

$jsonFile = __DIR__ . '/madinah_pages.json';

if (!is_readable($jsonFile)) {
    $msg = "ERROR: missing dataset: $jsonFile\n";
    if ($isCli && defined('STDERR')) {
        fwrite(STDERR, $msg);
    } else {
        echo $msg;
    }
    exit(1);
}

$json = file_get_contents($jsonFile);
$pages = json_decode($json, true);

if (!is_array($pages) || count($pages) !== 604) {
    $msg = "ERROR: dataset must contain exactly 604 pages.\n";
    if ($isCli && defined('STDERR')) {
        fwrite(STDERR, $msg);
    } else {
        echo $msg;
    }
    exit(1);
}

$sql = 'INSERT INTO `madinah_pages_meta`
            (`page_number`, `juz_number`, `hizb_number`, `rub_el_hizb`, `start_surah_id`, `start_ayah_id`)
        VALUES (:page_number, :juz_number, :hizb_number, :rub_el_hizb, :start_surah_id, :start_ayah_id)
        ON DUPLICATE KEY UPDATE
            `juz_number`      = VALUES(`juz_number`),
            `hizb_number`     = VALUES(`hizb_number`),
            `rub_el_hizb`     = VALUES(`rub_el_hizb`),
            `start_surah_id`  = VALUES(`start_surah_id`),
            `start_ayah_id`   = VALUES(`start_ayah_id`)';

try {
    $pdo->beginTransaction();
    $stmt = $pdo->prepare($sql);

    foreach ($pages as $row) {
        $stmt->execute([
            ':page_number'     => (int) $row['page_number'],
            ':juz_number'      => (int) $row['juz_number'],
            ':hizb_number'     => (int) $row['hizb_number'],
            ':rub_el_hizb'     => (int) $row['rub_el_hizb'],
            ':start_surah_id'  => (int) $row['start_surah_id'],
            ':start_ayah_id'   => (int) $row['start_ayah_id'],
        ]);
    }

    $pdo->commit();
} catch (PDOException $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    $msg = "ERROR: seeding failed: " . $e->getMessage() . "\n";
    if ($isCli && defined('STDERR')) {
        fwrite(STDERR, $msg);
    } else {
        echo $msg;
    }
    exit(1);
}

$count = (int) $pdo->query('SELECT COUNT(*) FROM `madinah_pages_meta`')->fetchColumn();
echo "Seeding complete. madinah_pages_meta now holds {$count} rows.\n";
