<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - Shared Spaced-Repetition (SRS) helpers
 *
 * Used by record_mistake.php, review_mistake.php, undo_review.php and
 * clear_mistake.php. Keeping the algorithm in one place means the deck
 * builder, the grader and the history page always agree on scheduling.
 *
 * Schedule model (SM-2 lite, integer day intervals):
 *   AGAIN (0) -> interval resets to 1 day, lapses++, streak reset
 *   HARD  (1) -> interval grows slowly, ease drops, streak reset
 *   GOOD  (2) -> interval advances through the ladder, streak++
 *   EASY  (3) -> interval jumps ahead, ease grows, streak++
 *
 * A card graduates (ARCHIVED) once it has been recalled successfully
 * (GOOD/EASY) on three consecutive reviews AND reached a >= 30-day interval.
 */

const SRS_GRADES = ['AGAIN' => 0, 'HARD' => 1, 'GOOD' => 2, 'EASY' => 3];
const SRS_MAX_INTERVAL = 365;
const SRS_MIN_EASE = 1.30;
const SRS_MAX_EASE = 2.80;
const SRS_GRADUATE_STREAK = 3;
const SRS_GRADUATE_MIN_INTERVAL = 30;

/**
 * Compute the next scheduling state for a card.
 *
 * @return array{interval:int,ease:float,streak:int,lapse:bool}
 */
function srs_next_schedule(int $intervalDays, float $ease, string $grade, int $streak): array
{
    $ease = max(SRS_MIN_EASE, min(SRS_MAX_EASE, $ease));

    switch ($grade) {
        case 'AGAIN':
            return [
                'interval' => 1,
                'ease'     => max(SRS_MIN_EASE, $ease - 0.20),
                'streak'   => 0,
                'lapse'    => true,
            ];

        case 'HARD':
            $iv = $intervalDays <= 0 ? 1 : max(1, (int) round($intervalDays * 1.2));
            return [
                'interval' => min($iv, SRS_MAX_INTERVAL),
                'ease'     => max(SRS_MIN_EASE, $ease - 0.15),
                'streak'   => 0,
                'lapse'    => false,
            ];

        case 'EASY':
            if ($intervalDays <= 0)      { $iv = 2; }
            elseif ($intervalDays === 1) { $iv = 4; }
            elseif ($intervalDays <= 3)  { $iv = 10; }
            else                         { $iv = (int) round($intervalDays * $ease * 1.3); }
            return [
                'interval' => min(max($iv, 1), SRS_MAX_INTERVAL),
                'ease'     => min(SRS_MAX_EASE, $ease + 0.10),
                'streak'   => $streak + 1,
                'lapse'    => false,
            ];

        case 'GOOD':
        default:
            if ($intervalDays <= 0)      { $iv = 1; }
            elseif ($intervalDays === 1) { $iv = 3; }
            elseif ($intervalDays <= 3)  { $iv = 7; }
            else                         { $iv = (int) round($intervalDays * $ease); }
            return [
                'interval' => min(max($iv, 1), SRS_MAX_INTERVAL),
                'ease'     => $ease,
                'streak'   => $streak + 1,
                'lapse'    => false,
            ];
    }
}

/** Snapshot of the scheduling-relevant fields, for undo support. */
function srs_prev_state(array $m): array
{
    return [
        'status'           => $m['status'] ?? null,
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
function srs_log_event(
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
        error_log('[SRS Event Failed] ' . $e->getMessage());
    }
}

/** Format a due date N days from now. */
function srs_due_datetime(int $intervalDays): string
{
    $dt = new DateTime('now');
    if ($intervalDays > 0) {
        $dt->modify('+' . $intervalDays . ' days');
    }
    return $dt->format('Y-m-d H:i:s');
}
