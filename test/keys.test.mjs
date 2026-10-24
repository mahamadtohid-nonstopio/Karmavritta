import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractKeys, isValidKey, prefixOf } from '../scripts/lib/keys.mjs';

test('extracts a single key from a commit message', () => {
  assert.deepEqual(extractKeys('[ESIN-123] fix order summary'), ['ESIN-123']);
});

test('extracts multiple distinct keys', () => {
  assert.deepEqual(
    extractKeys('ESIN-2725-ESIN-2742-PR-55031-review.md'),
    ['ESIN-2725', 'ESIN-2742', 'PR-55031']
  );
});

test('deduplicates the same key', () => {
  assert.deepEqual(extractKeys('ESIN-123 and ESIN-123 again'), ['ESIN-123']);
});

test('returns empty on text with no keys', () => {
  assert.deepEqual(extractKeys('nothing to see'), []);
});

test('returns empty on null/undefined input', () => {
  assert.deepEqual(extractKeys(null), []);
  assert.deepEqual(extractKeys(undefined), []);
  assert.deepEqual(extractKeys(''), []);
});

test('filters by allowed prefixes when provided', () => {
  assert.deepEqual(
    extractKeys('ESIN-1 OPP-2 FOO-3', ['ESIN', 'OPP']),
    ['ESIN-1', 'OPP-2']
  );
});

test('empty prefix list = allow all (dynamic default)', () => {
  assert.deepEqual(
    extractKeys('ESIN-1 OPP-2 FOO-3 PROJ-99', []),
    ['ESIN-1', 'OPP-2', 'FOO-3', 'PROJ-99']
  );
});

test('ignores lowercase keys', () => {
  assert.deepEqual(extractKeys('esin-1 ESIN-2'), ['ESIN-2']);
});

test('ignores single-char prefix (regex requires 2+)', () => {
  assert.deepEqual(extractKeys('A-1 and AB-2'), ['AB-2']);
});

test('extracts from branch-like text', () => {
  assert.deepEqual(extractKeys('ESIN-4349/qa'), ['ESIN-4349']);
});

test('extracts from PR title "Merged PR 57261: [ESIN-4185] ..."', () => {
  // "PR 57261" has a space (not a dash) so only ESIN-4185 matches.
  assert.deepEqual(
    extractKeys('Merged PR 57261: [ESIN-4185] fix retry logic'),
    ['ESIN-4185']
  );
});

test('isValidKey', () => {
  assert.equal(isValidKey('ESIN-123'), true);
  assert.equal(isValidKey('AB-1'), true);
  assert.equal(isValidKey('A1-1'), true);
  assert.equal(isValidKey('A-1'), false);
  assert.equal(isValidKey('esin-1'), false);
  assert.equal(isValidKey('ESIN123'), false);
  assert.equal(isValidKey(''), false);
  assert.equal(isValidKey(null), false);
});

test('prefixOf', () => {
  assert.equal(prefixOf('ESIN-123'), 'ESIN');
  assert.equal(prefixOf('OPP-5'), 'OPP');
});
