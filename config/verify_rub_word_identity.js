#!/usr/bin/env node
'use strict';

/**
 * Word-arrangement identity regression test.
 *
 * Repeated and adjacent duplicate words must be validated by their own
 * occurrence id + original word index, never by Arabic text equality alone.
 * Similar-looking words (different strict letters) must also stay distinct.
 *
 * Run: node config/verify_rub_word_identity.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const code = fs.readFileSync(path.join(__dirname, '..', 'web', 'js', 'rub-exercises.js'), 'utf8');
const sandbox = { window: {}, console, URL };
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'rub-exercises.js' });

const RubExercises = sandbox.window.RubExercises;
assert(RubExercises && typeof RubExercises.tokenMatchesPosition === 'function',
  'RubExercises.tokenMatchesPosition is missing');

const tokens = [
  { id: 'w0', wordIndex: 0, text: 'إِنَّ' },
  { id: 'w1', wordIndex: 1, text: 'إِنَّ' },
  { id: 'w2', wordIndex: 2, text: 'مَعَ' },
  { id: 'w3', wordIndex: 3, text: 'ٱلْعُسْرِ' },
  { id: 'w4', wordIndex: 4, text: 'يُسْرًا' },
  { id: 'd0', wordIndex: 0, text: 'إِنَّ', decoy: true },
  { id: 's0', wordIndex: 0, text: 'أَنَعْبُدُ' },
  { id: 's1', wordIndex: 1, text: 'انعبد' },
];

// Exact occurrence wins, including adjacent duplicates.
assert.strictEqual(RubExercises.tokenMatchesPosition(tokens, 'w0', 0), true);
assert.strictEqual(RubExercises.tokenMatchesPosition(tokens, 'w1', 1), true);

// The old bug: a text-equal duplicate at a different occurrence also passed.
assert.strictEqual(RubExercises.tokenMatchesPosition(tokens, 'w0', 1), false,
  'w0 must not satisfy position 1 just because w1 has the same Arabic text');
assert.strictEqual(RubExercises.tokenMatchesPosition(tokens, 'w1', 0), false,
  'w1 must not satisfy position 0 just because w0 has the same Arabic text');

// Repeated words remain individually addressable.
assert.strictEqual(RubExercises.tokenMatchesPosition(tokens, 'w2', 2), true);
assert.strictEqual(RubExercises.tokenMatchesPosition(tokens, 'w2', 3), false);

// Decoys never match, even when their text equals the target occurrence.
assert.strictEqual(RubExercises.tokenMatchesPosition(tokens, 'd0', 0), false);

// Similar-looking letters are not interchangeable. Both tokens are at the
// wrong positions; text normalisation must never rescue them.
assert.strictEqual(RubExercises.tokenMatchesPosition(tokens, 's0', 1), false);
assert.strictEqual(RubExercises.tokenMatchesPosition(tokens, 's1', 0), false);
assert.notStrictEqual(
  RubExercises.normalizeStrict(tokens.find((t) => t.id === 's0').text),
  RubExercises.normalizeStrict(tokens.find((t) => t.id === 's1').text),
  'strict normalisation must keep أ / ا distinct'
);

// Missing / malformed tokens fail closed.
assert.strictEqual(RubExercises.tokenMatchesPosition(tokens, 'missing', 0), false);
assert.strictEqual(RubExercises.tokenMatchesPosition(tokens, 'w0', -1), false);
assert.strictEqual(RubExercises.tokenMatchesPosition(null, 'w0', 0), false);

console.log('OK: duplicate, adjacent, decoy, and similar-word occurrences are validated by identity.');
