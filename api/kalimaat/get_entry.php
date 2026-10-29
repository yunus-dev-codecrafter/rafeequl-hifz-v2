<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Entry gate state.
 *
 * Returns the one word and the one mistake card that must be practised before
 * the app opens. Both locks are created lazily and are stable across sessions
 * until their target is reached (1000 for kalimaat, 40 for mistakes).
 */

require __DIR__ . '/../../config/database.php';
require_once __DIR__ . '/../../config/auth.php';
require_once __DIR__ . '/_catalog.php';

try {
    $authUser = rh_require_login($pdo);
    $userId = (int) $authUser['id'];
    $zone = kal_zone($pdo, $userId);

    $catalogOk = true;
    $locked = null;
    $stats = [
        'total_words' => 0,
        'locked_words' => 0,
        'ready_words' => 0,
        'mastered_words' => 0,
        'total_repetitions' => 0,
        'test_pool' => 0,
    ];
    $zonePages = [];
    $zoneTotal = 0;
    $juzCounts = [];
    $reason = '';

    try {
        $meta = kal_meta();
        $pageCounts = is_array($meta['page_counts'] ?? null) ? $meta['page_counts'] : [];
        $pageJuz = is_array($meta['page_juz'] ?? null) ? $meta['page_juz'] : [];
        for ($p = (int) $zone['start']; $p <= (int) $zone['end']; $p++) {
            $count = (int) ($pageCounts[(string) $p] ?? 0);
            if ($count > 0) {
                $zonePages[(string) $p] = $count;
                $zoneTotal += $count;
                $juz = (int) ($pageJuz[(string) $p] ?? 0);
                if ($juz >= 1 && $juz <= 30) {
                    $juzCounts[$juz] = (int) ($juzCounts[$juz] ?? 0) + $count;
                }
            }
        }

        if ($zone['end'] < $zone['start']) {
            $reason = 'NO_ZONE';
        } else {
            $locked = kal_ensure_locked($pdo, $userId, $zone);
            $stats = kal_user_stats($pdo, $userId);
            if (!$locked && $zoneTotal === 0) {
                $reason = 'NO_WORDS';
            } elseif (!$locked && $stats['total_words'] >= $zoneTotal) {
                $reason = 'ALL_WORDS_STARTED';
            }
        }
    } catch (Throwable $e) {
        $catalogOk = false;
        $reason = 'CATALOG_MISSING';
        error_log('[Kalimaat get_entry] ' . $e->getMessage());
    }

    $mistakeRow = null;
    try {
        $mistakeRow = kal_ensure_gate_mistake($pdo, $userId);
    } catch (Throwable $e) {
        error_log('[Mistake gate get_entry] ' . $e->getMessage());
    }

    $mustChange = (bool) ($authUser['must_change_password'] ?? false);
    $kalimaat = [
        'available' => !$mustChange && $catalogOk && $locked !== null,
        'catalog_ok' => $catalogOk,
        'locked' => $locked ? kal_word_payload([], $locked) : null,
        'target' => KALIMAAT_TARGET,
        'entry_min' => 10,
        'test_mastery_correct' => KALIMAAT_TEST_MASTERY_CORRECT,
        'stats' => $stats,
        'zone_pages' => $zonePages,
        'zone_total' => $zoneTotal,
        'juz_counts' => $juzCounts,
        'test_available' => $stats['test_pool'] > 0,
        'reason' => $reason,
    ];

    $mistake = [
        'available' => !$mustChange && $mistakeRow !== null,
        'entry_min' => 10,
        'card' => kal_mistake_payload($mistakeRow),
    ];

    kal_json_out(200, [
        'success' => true,
        'must_change_password' => $mustChange,
        'zone' => $zone,
        'kalimaat' => $kalimaat,
        'mistake' => $mistake,
        'time' => date('c'),
    ]);
} catch (Throwable $e) {
    error_log('[Kalimaat get_entry] ' . $e->getMessage());
    kal_json_out(500, ['success' => false, 'error' => 'Server error. Please try again.']);
}
