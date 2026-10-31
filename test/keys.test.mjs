import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractKeys, isValidKey, prefixOf } from '../scripts/lib/keys.mjs';

test('extracts a single key from a commit message', () => {
  assert.deepEqual(extractKeys('[DEMO-123] fix order summary'), ['DEMO-123']);
});

test('extracts multiple distinct keys', () => {
  assert.deepEqual(
    extractKeys('DEMO-2725-DEMO-2742-PR-55031-review.md'),
    ['DEMO-2725', 'DEMO-2742', 'PR-55031']
  );
});

test('deduplicates the same key', () => {
  assert.deepEqual(extractKeys('DEMO-123 and DEMO-123 again'), ['DEMO-123']);
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
    extractKeys('DEMO-1 TASK-2 FOO-3', ['DEMO', 'TASK']),
    ['DEMO-1', 'TASK-2']
  );
});

test('empty prefix list = allow all (dynamic default)', () => {
  assert.deepEqual(
    extractKeys('DEMO-1 TASK-2 FOO-3 PROJ-99', []),
    ['DEMO-1', 'TASK-2', 'FOO-3', 'PROJ-99']
  );
});

test('ignores lowercase keys', () => {
  assert.deepEqual(extractKeys('demo-1 DEMO-2'), ['DEMO-2']);
});

test('ignores single-char prefix (regex requires 2+)', () => {
  assert.deepEqual(extractKeys('A-1 and AB-2'), ['AB-2']);
});

test('extracts from branch-like text', () => {
  assert.deepEqual(extractKeys('DEMO-4349/qa'), ['DEMO-4349']);
});

test('extracts from PR title "Merged PR 57261: [DEMO-4185] ..."', () => {
  // "PR 57261" has a space (not a dash) so only DEMO-4185 matches.
  assert.deepEqual(
    extractKeys('Merged PR 57261: [DEMO-4185] fix retry logic'),
    ['DEMO-4185']
  );
});

test('isValidKey', () => {
  assert.equal(isValidKey('DEMO-123'), true);
  assert.equal(isValidKey('AB-1'), true);
  assert.equal(isValidKey('A1-1'), true);
  assert.equal(isValidKey('A-1'), false);
  assert.equal(isValidKey('demo-1'), false);
  assert.equal(isValidKey('ESIN123'), false);
  assert.equal(isValidKey(''), false);
  assert.equal(isValidKey(null), false);
});

test('prefixOf', () => {
  assert.equal(prefixOf('DEMO-123'), 'DEMO');
  assert.equal(prefixOf('TASK-5'), 'TASK');
});
