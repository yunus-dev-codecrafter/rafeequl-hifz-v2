<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Migration v5: detach stray "next verse" pairs.
 *
 * Before this release the generic mistake modal defaulted to
 * TRANSITION_FAILURE and auto-filled the following ayah, so non-transition
 * mistakes (tawaqquf / tashkeel / lafdh) could be stored with a
 * confused_with_surah + confused_with_ayah pair that they never had.
 *
 * This migration keeps the paired verse only where it is meaningful:
 *   - TRANSITION_FAILURE : the next verse the reciter forgot
 *   - MUTASHABIHAT       : the verse it was confused with
 * Every other type is cleared. The script is idempotent.
 *
 * Run (CLI):   php config/migrate_v5.php
 * Run (web):   https://your-host/config/migrate_v5.php?confirm=1
 */

require __DIR__ . '/database.php';

if (PHP_SAPI !== 'cli') {
    header('Content-Type: text/plain; charset=utf-8');
    if (($_GET['confirm'] ?? '') !== '1') {
        http_response_code(400);
        echo "Refusing to run. Append ?confirm=1 to the URL to apply the migration.\n";
        exit;
    }
}

$log = static function (string $msg): void {
    echo $msg . "\n";
    if (PHP_SAPI !== 'cli') { @ob_flush(); @flush(); }
};

$log('== Rafeequl Hifz migration v5 (paired-verse cleanup) ==');

try {
    $stmt = $pdo->prepare(
        "UPDATE `mistakes`
         SET `confused_with_surah` = NULL,
             `confused_with_ayah`  = NULL
         WHERE `mistake_type` NOT IN ('TRANSITION_FAILURE', 'MUTASHABIHAT')
           AND (`confused_with_surah` IS NOT NULL OR `confused_with_ayah` IS NOT NULL)"
    );
    $stmt->execute();
    $cleared = $stmt->rowCount();

    $log($cleared === 0
        ? '- no stray paired verses found.'
        : "+ cleared paired verses on $cleared mistake(s).");
    $log('== Migration v5 complete ==');
} catch (PDOException $e) {
    error_log('[MigrateV5 Failed] ' . $e->getMessage());
    http_response_code(500);
    echo 'Migration failed: ' . $e->getMessage() . "\n";
    exit(1);
}
