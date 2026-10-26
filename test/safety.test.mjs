import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'worklog-safety-'));
  process.env.WORKLOG_DIR = path.join(dir, 'home');
  return dir;
}

const safety = await import('../scripts/lib/safety.mjs');

test('writes inside the data home are allowed', () => {
  sandbox();
  const target = path.join(process.env.WORKLOG_DIR, 'nested', 'a.json');
  safety.writeFileAtomic(target, '{}');
  assert.equal(fs.readFileSync(target, 'utf8'), '{}');
});

test('writes outside the allowlist are refused', () => {
  sandbox();
  const outside = path.join(os.homedir(), 'worklog-should-never-exist.txt');
  assert.throws(() => safety.writeFileAtomic(outside, 'nope'), (e) => {
    assert.equal(e.code, 'WORKLOG_SAFETY_DENIED');
    return true;
  });
  assert.equal(fs.existsSync(outside), false);
});

test('a work repo path is never writable', () => {
  sandbox();
  const repoish = path.join(path.parse(process.cwd()).root, 'Projects', 'SomeRepo', 'src', 'x.cs');
  assert.equal(safety.isWritable(repoish), false);
  assert.throws(() => safety.removePath(repoish), /WORKLOG_SAFETY_DENIED|Refusing/);
});

test('a symlink out of the data home cannot smuggle a write', { skip: process.platform === 'win32' }, () => {
  const dir = sandbox();
  const escape = path.join(dir, 'escape');
  fs.mkdirSync(escape, { recursive: true });
  fs.mkdirSync(process.env.WORKLOG_DIR, { recursive: true });
  fs.symlinkSync(escape, path.join(process.env.WORKLOG_DIR, 'link'), 'dir');
  assert.throws(
    () => safety.writeFileAtomic(path.join(process.env.WORKLOG_DIR, 'link', 'x.txt'), 'nope'),
    /Refusing to write/
  );
});

test('commands off the allowlist are refused', () => {
  sandbox();
  assert.throws(() => safety.runCapture('curl', ['https://example.com']), (e) => {
    assert.equal(e.code, 'WORKLOG_SAFETY_DENIED');
    return true;
  });
});

test('allowlisted command that is missing degrades instead of throwing', () => {
  sandbox();
  const r = safety.runCapture('claude', ['--definitely-not-a-flag-xyz']);
  assert.equal(typeof r.ok, 'boolean');
});

test('config can widen the command allowlist but not bypass write roots', () => {
  sandbox();
  safety.allowCommands(['rg']);
  assert.doesNotThrow(() => safety.runCapture('rg', ['--version']));
  const outside = path.join(os.homedir(), 'still-not-allowed.txt');
  assert.equal(safety.isWritable(outside), false);
});

test('tryMkdirExclusive reports contention instead of throwing', () => {
  sandbox();
  safety.mkdirp(process.env.WORKLOG_DIR);
  const lock = path.join(process.env.WORKLOG_DIR, '.lock');
  assert.equal(safety.tryMkdirExclusive(lock), true);
  assert.equal(safety.tryMkdirExclusive(lock), false);
  assert.equal(safety.removeDirIfEmpty(lock), true);
});
