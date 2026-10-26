<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - per-verse HIFZ_JADID progress helpers.
 *
 * The new-memorization task is not finished by marking a page complete. Every
 * verse has to be recited 40 times, and after each verse the previously
 * memorized verses are recited together as a cumulative link. The browser
 * stores that state as JSON; these helpers keep the payload bounded and make
 * sure a page can never be completed before every verse/link is done.
 */

const RH_HIFZ_TARGET_REPS = 40;
const RH_HIFZ_MAX_VERSES = 200;
const RH_HIFZ_PHASES = ['repeat', 'link', 'complete'];

if (!function_exists('rh_hifz_decode')) {
    /** Decode the stored JSON without trusting its contents. */
    function rh_hifz_decode(?string $raw): ?array
    {
        if ($raw === null || trim($raw) === '') {
            return null;
        }
        $decoded = json_decode($raw, true);
        return is_array($decoded) ? $decoded : null;
    }
}

if (!function_exists('rh_hifz_page_verse_count')) {
    /**
     * Number of ayat on a Madinah page, from the same map the browser uses.
     * Returns 0 when the map is unavailable, so a missing optional file never
     * blocks progress saves.
     */
    function rh_hifz_page_verse_count(int $page): int
    {
        static $pages = null;
        if ($pages === null) {
            $raw = @file_get_contents(__DIR__ . '/../../web/js/madinah_page_verses.json');
            $decoded = $raw !== false ? json_decode($raw, true) : null;
            $pages = is_array($decoded) ? $decoded : [];
        }

        $entry = $pages[$page - 1] ?? null;
        if (!is_array($entry)) {
            return 0;
        }

        $count = 0;
        foreach ($entry as $section) {
            if (is_array($section) && count($section) >= 3) {
                $from = (int) $section[1];
                $to = (int) $section[2];
                if ($to >= $from) {
                    $count += $to - $from + 1;
                }
            }
        }
        return $count;
    }
}

if (!function_exists('rh_hifz_sanitize')) {
    /**
     * Validate and normalize a progress payload for one page.
     *
     * @param mixed $input
     * @return array<string,mixed>|null null when the payload is malformed
     */
    function rh_hifz_sanitize($input, int $page): ?array
    {
        if (!is_array($input)) {
            return null;
        }

        $pageValue = $input['page'] ?? null;
        if (!is_int($pageValue) && !(is_string($pageValue) && ctype_digit($pageValue))) {
            return null;
        }
        if ((int) $pageValue !== $page) {
            return null;
        }

        $repsIn = $input['reps'] ?? null;
        $linksIn = $input['links'] ?? null;
        if (!is_array($repsIn) || !is_array($linksIn)) {
            return null;
        }

        $repsIn = array_values($repsIn);
        $linksIn = array_values($linksIn);
        $total = count($repsIn);
        if ($total < 1 || $total > RH_HIFZ_MAX_VERSES || count($linksIn) !== $total) {
            return null;
        }

        $expectedTotal = rh_hifz_page_verse_count($page);
        if ($expectedTotal > 0 && $total !== $expectedTotal) {
            return null;
        }

        $reps = [];
        foreach ($repsIn as $value) {
            if (!is_int($value) && !is_numeric($value)) {
                return null;
            }
            $reps[] = max(0, min(RH_HIFZ_TARGET_REPS, (int) $value));
        }

        $links = [];
        foreach ($linksIn as $value) {
            if (is_bool($value)) {
                $links[] = $value ? 1 : 0;
            } elseif (is_int($value) || is_numeric($value)) {
                $links[] = ((int) $value) === 1 ? 1 : 0;
            } else {
                return null;
            }
        }

        $currentValue = $input['current'] ?? 0;
        if (!is_int($currentValue) && !is_numeric($currentValue)) {
            return null;
        }
        $current = max(0, min($total - 1, (int) $currentValue));

        $phase = (string) ($input['phase'] ?? 'repeat');
        if (!in_array($phase, RH_HIFZ_PHASES, true)) {
            $phase = 'repeat';
        }

        $allReps = true;
        foreach ($reps as $value) {
            if ($value < RH_HIFZ_TARGET_REPS) {
                $allReps = false;
                break;
            }
        }
        $allLinks = true;
        foreach ($links as $value) {
            if ($value !== 1) {
                $allLinks = false;
                break;
            }
        }

        $complete = (bool) ($input['complete'] ?? false);
        if ($complete && (!$allReps || !$allLinks)) {
            // A client must not be able to finish early by simply setting the
            // flag. Treat the payload as inconsistent instead of silently
            // accepting it.
            return null;
        }

        if ($allReps && $allLinks) {
            $complete = true;
            $phase = 'complete';
            $current = $total - 1;
        } else {
            $complete = false;
            if ($phase === 'complete') {
                $phase = 'repeat';
            }
        }

        return [
            'v'          => 1,
            'page'       => $page,
            'reps'       => $reps,
            'links'      => $links,
            'current'    => $current,
            'phase'      => $phase,
            'complete'   => $complete,
            'updated_at' => gmdate('c'),
        ];
    }
}

if (!function_exists('rh_hifz_is_complete')) {
    function rh_hifz_is_complete(?array $state): bool
    {
        if ($state === null || empty($state['complete'])) {
            return false;
        }

        $reps = $state['reps'] ?? null;
        $links = $state['links'] ?? null;
        if (!is_array($reps) || !is_array($links) || count($reps) < 1 || count($reps) !== count($links)) {
            return false;
        }

        foreach ($reps as $value) {
            if ((int) $value < RH_HIFZ_TARGET_REPS) {
                return false;
            }
        }
        foreach ($links as $value) {
            if ((int) $value !== 1) {
                return false;
            }
        }
        return true;
    }
}

if (!function_exists('rh_hifz_json')) {
    function rh_hifz_json(array $state): string
    {
        return json_encode($state, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '{}';
    }
}

if (!function_exists('rh_hifz_state_score')) {
    /** Used by clients to merge a fresher local copy with the server copy. */
    function rh_hifz_state_score(?array $state): int
    {
        if ($state === null) {
            return -1;
        }
        $score = 0;
        foreach (($state['reps'] ?? []) as $value) {
            $score += (int) $value;
        }
        foreach (($state['links'] ?? []) as $value) {
            if ((int) $value === 1) {
                $score += RH_HIFZ_TARGET_REPS;
            }
        }
        if (!empty($state['complete'])) {
            $score += 1000;
        }
        return $score;
    }
}
