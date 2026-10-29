<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Shared mistake-practice helpers
 *
 * A mistake card is practiced a fixed number of times (default 40). Each
 * correct recitation increments `practice_count`; a slip does not. When the
 * counter reaches `practice_target` the card is archived automatically and
 * leaves the practice deck. Logging the same mistake again resets the counter
 * and brings the card back.
 *
 * The old SM-2 columns (`interval_days`, `ease`, `lapses`, `streak_correct`,
 * `due_at`) are kept in the table for history/undo compatibility, but they no
 * longer drive the deck.
 *
 * Used by record_mistake.php, review_mistake.php, undo_review.php and
 * clear_mistake.php.
 */

const PRACTICE_TARGET = 40;

/**
 * Apply one practice result to a card.
 *
 * @return array{count:int,target:int,completed:bool,remaining:int}
 */
function practice_apply(int $count, int $target, string $result): array
{
    $target = $target > 0 ? $target : PRACTICE_TARGET;
    $count  = max(0, min($target, $count));

    $correct = ($result === 'CORRECT');
    if ($correct) {
        $count = min($target, $count + 1);
    }

    $completed = $correct && $count >= $target;

    return [
        'count'     => $count,
        'target'    => $target,
        'completed' => $completed,
        'remaining' => max(0, $target - $count),
    ];
}

/** Snapshot of the practice-relevant fields, for undo support. */
function practice_prev_state(array $m): array
{
    return [
        'status'           => $m['status'] ?? null,
        'practice_count'   => isset($m['practice_count']) ? (int) $m['practice_count'] : 0,
        'practice_target'  => isset($m['practice_target']) ? (int) $m['practice_target'] : PRACTICE_TARGET,
        'mastery_count'    => isset($m['mastery_count']) ? (int) $m['mastery_count'] : 0,
        'occurrence_count' => isset($m['occurrence_count']) ? (int) $m['occurrence_count'] : 1,
        'interval_days'    => isset($m['interval_days']) ? (int) $m['interval_days'] : 0,
        'ease'             => isset($m['ease']) ? (float) $m['ease'] : 2.5,
        'lapses'           => isset($m['lapses']) ? (int) $m['lapses'] : 0,
        'streak_correct'   => isset($m['streak_correct']) ? (int) $m['streak_correct'] : 0,
        'due_at'           => $m['due_at'] ?? null,
        'last_reviewed_at' => $m['last_reviewed_at'] ?? null,
        'graduated_at'     => $m['graduated_at'] ?? null,
    ];
}

/** Append an audit event. Never fatal - history is best-effort. */
function practice_log_event(
    PDO $pdo,
    int $userId,
    ?int $mistakeId,
    string $type,
    ?int $grade = null,
    ?int $before = null,
    ?int $after = null,
    ?array $prevState = null
): void {
    try {
        $stmt = $pdo->prepare(
            'INSERT INTO `mistake_events`
                (`user_id`, `mistake_id`, `event_type`, `grade`, `interval_before`, `interval_after`, `prev_state`)
             VALUES (:u, :m, :t, :g, :b, :a, :p)'
        );
        $stmt->execute([
            ':u' => $userId,
            ':m' => $mistakeId,
            ':t' => $type,
            ':g' => $grade,
            ':b' => $before,
            ':a' => $after,
            ':p' => $prevState !== null ? json_encode($prevState, JSON_UNESCAPED_UNICODE) : null,
        ]);
    } catch (PDOException $e) {
        error_log('[Practice Event Failed] ' . $e->getMessage());
    }
}
