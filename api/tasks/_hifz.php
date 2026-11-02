<?php
declare(strict_types=1);

/**
 * Rafeequl Hifz - per-verse HIFZ_JADID progress helpers.
 *
 * The new-memorization task is not finished by marking a page complete. Every
 * verse is recited 20 times alone, every verse is then joined to the verse
 * before it 20 times (the adjacent pair), and the whole page is recited once at
 * the end. The browser stores that state as JSON; these helpers keep the
 * payload bounded and make sure a page can never be completed before every
 * verse, pair and the final page pass are done.
 *
 * State v2 shape:
 *   v          2
 *   page       1..604
 *   reps[]     0..20 per verse
 *   links[]    0..20 per verse; links[i] is the pair (i-1, i), links[0] unused
 *   page_pass  0|1
 *   current    0..verse_count-1
 *   phase      repeat | link | page | complete
 *   complete   bool
 */

const RH_HIFZ_STATE_VERSION = 2;
const RH_HIFZ_TARGET_REPS = 20;
const RH_HIFZ_PAIR_REPS = 20;
const RH_HIFZ_PAGE_PASS_TARGET = 1;
const RH_HIFZ_MAX_VERSES = 200;
const RH_HIFZ_PHASES = ['repeat', 'link', 'page', 'complete'];

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

if (!function_exists('rh_hifz_state_version')) {
    /** Version of a progress payload; 1 when the v1 (40x) shape is detected. */
    function rh_hifz_state_version($input): int
    {
        if (!is_array($input)) {
            return 0;
        }
        if (!array_key_exists('v', $input)) {
            return 1;
        }
        return (int) $input['v'];
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

if (!function_exists('rh_hifz_pairs_done')) {
    /** True when every adjacent pair (1..n-1) reached the target. */
    function rh_hifz_pairs_done(array $links): bool
    {
        $total = count($links);
        if ($total < 2) {
            return true;
        }
        for ($i = 1; $i < $total; $i++) {
            if ((int) ($links[$i] ?? 0) < RH_HIFZ_PAIR_REPS) {
                return false;
            }
        }
        return true;
    }
}

if (!function_exists('rh_hifz_legacy_complete_state')) {
    /**
     * Convert an already-complete v1 (40x cumulative) state into a v2 state for
     * read-only display. Partial legacy states return null: the client restarts
     * the page with the new 20x + adjacent-pair flow.
     */
    function rh_hifz_legacy_complete_state(?array $legacy, int $page): ?array
    {
        if ($legacy === null) {
            return null;
        }
        $reps = $legacy['reps'] ?? null;
        $links = $legacy['links'] ?? null;
        if (!is_array($reps) || !is_array($links) || count($reps) < 1 || count($reps) !== count($links)) {
            return null;
        }
        foreach ($reps as $value) {
            if ((int) $value < 40) {
                return null;
            }
        }
        foreach ($links as $value) {
            if ((int) $value !== 1) {
                return null;
            }
        }

        $total = count($reps);
        $newLinks = [];
        for ($i = 0; $i < $total; $i++) {
            $newLinks[] = $i === 0 ? 0 : RH_HIFZ_PAIR_REPS;
        }

        return [
            'v'          => RH_HIFZ_STATE_VERSION,
            'page'       => $page,
            'reps'       => array_fill(0, $total, RH_HIFZ_TARGET_REPS),
            'links'      => $newLinks,
            'page_pass'  => 1,
            'current'    => $total - 1,
            'phase'      => 'complete',
            'complete'   => true,
            'legacy'     => true,
            'updated_at' => gmdate('c'),
        ];
    }
}

if (!function_exists('rh_hifz_sanitize')) {
    /**
     * Validate and normalize a progress payload for one page.
     *
     * @param mixed $input
     * @param bool  $allowLegacyComplete accept an already-finished v1 state for
     *                                   read-only display (task history)
     * @return array<string,mixed>|null null when the payload is malformed
     */
    function rh_hifz_sanitize($input, int $page, bool $allowLegacyComplete = false): ?array
    {
        if (!is_array($input)) {
            return null;
        }

        $version = rh_hifz_state_version($input);
        if ($version !== RH_HIFZ_STATE_VERSION) {
            return $allowLegacyComplete ? rh_hifz_legacy_complete_state($input, $page) : null;
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
            if (!is_int($value) && !is_numeric($value)) {
                return null;
            }
            $links[] = max(0, min(RH_HIFZ_PAIR_REPS, (int) $value));
        }
        // links[0] has no previous verse to join with.
        $links[0] = 0;

        $currentValue = $input['current'] ?? 0;
        if (!is_int($currentValue) && !is_numeric($currentValue)) {
            return null;
        }
        $current = max(0, min($total - 1, (int) $currentValue));

        $phase = (string) ($input['phase'] ?? 'repeat');
        if (!in_array($phase, RH_HIFZ_PHASES, true)) {
            $phase = 'repeat';
        }

        $pagePassValue = $input['page_pass'] ?? 0;
        if (!is_int($pagePassValue) && !is_numeric($pagePassValue) && !is_bool($pagePassValue)) {
            return null;
        }
        $pagePass = $pagePassValue === true ? 1 : max(0, min(1, (int) $pagePassValue));

        $allReps = true;
        foreach ($reps as $value) {
            if ($value < RH_HIFZ_TARGET_REPS) {
                $allReps = false;
                break;
            }
        }
        $allPairs = rh_hifz_pairs_done($links);
        $complete = $allReps && $allPairs && $pagePass >= RH_HIFZ_PAGE_PASS_TARGET;

        $claimedComplete = (bool) ($input['complete'] ?? false);
        if ($claimedComplete && !$complete) {
            // A client must not be able to finish early by simply setting the
            // flag. Treat the payload as inconsistent instead of silently
            // accepting it.
            return null;
        }

        if ($complete) {
            $phase = 'complete';
            $current = $total - 1;
            $pagePass = RH_HIFZ_PAGE_PASS_TARGET;
        } else {
            if ($phase === 'complete') {
                $phase = 'repeat';
            }
            if ($phase === 'page' && !$allReps) {
                $phase = 'repeat';
            }
            if ($phase === 'link' && $current < 1) {
                $phase = 'repeat';
            }
        }

        return [
            'v'          => RH_HIFZ_STATE_VERSION,
            'page'       => $page,
            'reps'       => $reps,
            'links'      => $links,
            'page_pass'  => $pagePass,
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
        if (rh_hifz_state_version($state) !== RH_HIFZ_STATE_VERSION) {
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
        if (!rh_hifz_pairs_done(array_values($links))) {
            return false;
        }
        if ((int) ($state['page_pass'] ?? 0) < RH_HIFZ_PAGE_PASS_TARGET) {
            return false;
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
            $score += (int) $value;
        }
        $score += ((int) ($state['page_pass'] ?? 0)) * 100;
        if (!empty($state['complete'])) {
            $score += 1000;
        }
        return $score;
    }
}
