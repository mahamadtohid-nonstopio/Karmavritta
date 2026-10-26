import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'worklog.mjs');

function run(args, env = {}) {
  try {
    const out = execFileSync(process.execPath, [BIN, ...args], {
      encoding: 'utf8',
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return { ok: true, stdout: out, stderr: '' };
  } catch (e) {
    return { ok: false, stdout: e.stdout?.toString() || '', stderr: e.stderr?.toString() || '', code: e.status };
  }
}

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'worklog-cli-test-'));
}

test('help exits 0 and mentions key commands', () => {
  const r = run(['help']);
  assert.ok(r.ok);
  assert.match(r.stdout, /worklog install/);
  assert.match(r.stdout, /worklog search/);
  assert.match(r.stdout, /worklog note/);
});

test('unknown command exits 1', () => {
  const r = run(['bogus']);
  assert.equal(r.ok, false);
  assert.equal(r.code, 1);
});

test('bare ticket key works as show', () => {
  const dir = tmpdir();
  fs.mkdirSync(path.join(dir, 'tickets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'tickets', 'ESIN-1.json'), JSON.stringify({
    key: 'ESIN-1', title: 'test', status: '', repos: [], branches: [],
    firstActive: '2026-10-20', lastActive: '2026-10-20', activeDates: ['2026-10-20'],
    commits: [], prs: [], docs: [], findings: [], rca: null, notes: ''
  }));
  const r = run(['ESIN-1'], { WORKLOG_DIR: dir });
  assert.ok(r.ok, r.stderr);
  assert.match(r.stdout, /ESIN-1 — test/);
});

test('--json emits parseable JSON for ticket', () => {
  const dir = tmpdir();
  fs.mkdirSync(path.join(dir, 'tickets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'tickets', 'ESIN-1.json'), JSON.stringify({
    key: 'ESIN-1', title: 'test', status: '', repos: [], branches: [],
    firstActive: null, lastActive: null, activeDates: [],
    commits: [], prs: [], docs: [], findings: [], rca: null, notes: ''
  }));
  const r = run(['ESIN-1', '--json'], { WORKLOG_DIR: dir });
  assert.ok(r.ok);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.key, 'ESIN-1');
  assert.equal(parsed.title, 'test');
});

test('note persists a multi-word finding with correct kind', () => {
  const dir = tmpdir();
  fs.mkdirSync(path.join(dir, 'tickets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'tickets', 'ESIN-9.json'), JSON.stringify({
    key: 'ESIN-9', title: '', status: '', repos: [], branches: [],
    firstActive: null, lastActive: null, activeDates: [],
    commits: [], prs: [], docs: [], findings: [], rca: null, notes: ''
  }));
  const r = run(['note', '--ticket', 'ESIN-9', '--kind', 'ruled-out', 'the thing was not the cause'],
    { WORKLOG_DIR: dir });
  assert.ok(r.ok, r.stderr);
  const t = JSON.parse(fs.readFileSync(path.join(dir, 'tickets', 'ESIN-9.json'), 'utf8'));
  assert.equal(t.findings.length, 1);
  assert.equal(t.findings[0].kind, 'ruled-out');
  assert.equal(t.findings[0].text, 'the thing was not the cause');
  assert.match(t.findings[0].date, /^\d{4}-\d{2}-\d{2}$/);
});

test('note rejects invalid kind', () => {
  const dir = tmpdir();
  fs.mkdirSync(path.join(dir, 'tickets'), { recursive: true });
  const r = run(['note', '--ticket', 'ESIN-1', '--kind', 'bogus', 'text'], { WORKLOG_DIR: dir });
  assert.equal(r.ok, false);
  assert.match(r.stderr, /--kind must be one of/);
});

test('note rejects malformed ticket key', () => {
  const dir = tmpdir();
  const r = run(['note', '--ticket', 'notakey', 'text'], { WORKLOG_DIR: dir });
  assert.equal(r.ok, false);
  assert.match(r.stderr, /PROJ-123 format/);
});

test('search --json returns structured hits', () => {
  const dir = tmpdir();
  fs.mkdirSync(path.join(dir, 'tickets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'tickets', 'ESIN-1.json'), JSON.stringify({
    key: 'ESIN-1', title: 'deadlock in SF', status: '', repos: [], branches: [],
    firstActive: null, lastActive: null, activeDates: [],
    commits: [{ sha: 'abc', message: 'fix deadlock', date: '2026-10-20T00:00:00Z', repo: 'r' }],
    prs: [], docs: [], findings: [], rca: null, notes: ''
  }));
  const r = run(['search', 'deadlock', '--json'], { WORKLOG_DIR: dir });
  assert.ok(r.ok, r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.needle, 'deadlock');
  assert.equal(parsed.count, 1);
  assert.equal(parsed.hits[0].key, 'ESIN-1');
  assert.ok(parsed.hits[0].matches.length >= 2);
});

test('month YYYY-MM filters by activeDates', () => {
  const dir = tmpdir();
  fs.mkdirSync(path.join(dir, 'tickets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'tickets', 'A-1.json'), JSON.stringify({
    key: 'A-1', title: 'aug', status: '', repos: [], branches: [],
    firstActive: '2026-08-01', lastActive: '2026-08-05', activeDates: ['2026-08-01', '2026-08-05'],
    commits: [], prs: [], docs: [], findings: [], rca: null, notes: ''
  }));
  fs.writeFileSync(path.join(dir, 'tickets', 'B-2.json'), JSON.stringify({
    key: 'B-2', title: 'sep', status: '', repos: [], branches: [],
    firstActive: '2026-09-01', lastActive: '2026-09-10', activeDates: ['2026-09-01'],
    commits: [], prs: [], docs: [], findings: [], rca: null, notes: ''
  }));
  const r = run(['month', '2026-08', '--json'], { WORKLOG_DIR: dir });
  assert.ok(r.ok, r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.month, '2026-08');
  assert.equal(parsed.count, 1);
  assert.equal(parsed.tickets[0].key, 'A-1');
});

test('month rejects malformed arg', () => {
  const r = run(['month', '2026']);
  assert.equal(r.ok, false);
  assert.match(r.stderr, /YYYY-MM/);
});

test('bad JSON config is reported cleanly', () => {
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, 'config.json'), '{ bad json');
  // `backfill` loads config; `list` only reads the index. Use a config-loading command.
  const r = run(['backfill'], { WORKLOG_DIR: dir });
  assert.equal(r.ok, false);
  assert.match(r.stderr, /Could not parse/);
});
