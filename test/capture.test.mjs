import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOK = path.join(ROOT, 'hooks', 'run.mjs');

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'worklog-capture-'));
  process.env.WORKLOG_DIR = dir;
  return dir;
}

const { captureEvent, buildRecord, summarizeTool, readRawDay, rawFileFor, dayOf } =
  await import('../scripts/lib/capture.mjs');
const { loadConfig, saveConfig } = await import('../scripts/lib/config.mjs');

function promptEvent(prompt, session = 's1') {
  return { hook_event_name: 'UserPromptSubmit', session_id: session, cwd: ROOT, prompt };
}

test('a prompt event lands as one json line in the day file', () => {
  sandbox();
  const r = captureEvent(promptEvent('looking at ESIN-4349 deadlock'));
  assert.equal(r.written, true);
  assert.ok(fs.existsSync(r.file));
  const lines = fs.readFileSync(r.file, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  const rec = JSON.parse(lines[0]);
  assert.equal(rec.event, 'UserPromptSubmit');
  assert.deepEqual(rec.keys, ['ESIN-4349']);
  assert.match(rec.summary, /deadlock/);
});

test('events append rather than overwrite, and read back in time order', () => {
  sandbox();
  captureEvent(promptEvent('first ESIN-1'));
  captureEvent(promptEvent('second ESIN-1'));
  captureEvent({ hook_event_name: 'PreToolUse', session_id: 's1', cwd: ROOT, tool_name: 'Bash', tool_input: { command: 'git status' } });
  const day = readRawDay(dayOf());
  assert.equal(day.length, 3);
  assert.deepEqual(day.map((e) => e.event), ['UserPromptSubmit', 'UserPromptSubmit', 'PreToolUse']);
});

test('secrets in a prompt never reach the raw file', () => {
  sandbox();
  const r = captureEvent(promptEvent('use token ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456 please'));
  const text = fs.readFileSync(r.file, 'utf8');
  assert.ok(!text.includes('ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456'), text);
  assert.match(text, /REDACTED/);
});

test('a bash command is captured as an artifact with its detail', () => {
  sandbox();
  captureEvent({
    hook_event_name: 'PreToolUse', session_id: 's2', cwd: ROOT,
    tool_name: 'Bash', tool_input: { command: 'dotnet test --filter Deadlock' }
  });
  const [rec] = readRawDay(dayOf());
  assert.equal(rec.kind, 'artifact');
  assert.equal(rec.summary, 'dotnet test --filter Deadlock');
  assert.equal(rec.detail.command, 'dotnet test --filter Deadlock');
});

test('file tools are classified as file touches', () => {
  sandbox();
  captureEvent({
    hook_event_name: 'PreToolUse', session_id: 's3', cwd: ROOT,
    tool_name: 'Edit', tool_input: { file_path: 'C:/Projects/App/Retry.cs' }
  });
  const [rec] = readRawDay(dayOf());
  assert.equal(rec.kind, 'file');
  assert.equal(rec.summary, 'C:/Projects/App/Retry.cs');
});

test('PostToolUse records failure and a clipped error', () => {
  sandbox();
  captureEvent({
    hook_event_name: 'PostToolUse', session_id: 's4', cwd: ROOT,
    tool_name: 'Bash', tool_input: { command: 'npm test' },
    tool_response: { error: 'boom'.repeat(500) }
  });
  const [rec] = readRawDay(dayOf());
  assert.equal(rec.ok, false);
  assert.ok(rec.error.length < 600, 'error should be clipped');
});

test('event ids are stable for identical input', () => {
  const cfg = { keyPrefixes: [], capture: { maxFieldChars: 2000 }, redaction: { mode: 'secrets' } };
  const now = new Date('2026-10-26T10:00:00.000Z');
  const payload = promptEvent('ESIN-1 hello');
  assert.equal(buildRecord(payload, cfg, { now }).id, buildRecord(payload, cfg, { now }).id);
});

test('capture honours the paused switch', () => {
  sandbox();
  const cfg = loadConfig();
  cfg.capture.paused = true;
  saveConfig(cfg);
  assert.deepEqual(captureEvent(promptEvent('ESIN-2 while paused')), { skipped: 'paused' });
  assert.equal(readRawDay(dayOf()).length, 0);
});

test('events outside the configured list are not captured', () => {
  sandbox();
  const cfg = loadConfig();
  cfg.capture.events = ['SessionStart'];
  saveConfig(cfg);
  assert.deepEqual(captureEvent(promptEvent('ESIN-3')), { skipped: 'event-not-captured' });
});

test('keyPrefixes restricts which keys are tagged', () => {
  sandbox();
  const cfg = loadConfig();
  cfg.keyPrefixes = ['ESIN'];
  saveConfig(cfg);
  captureEvent(promptEvent('ESIN-5 and OPP-9 together'));
  const [rec] = readRawDay(dayOf());
  assert.deepEqual(rec.keys, ['ESIN-5']);
});

test('summarizeTool picks the field that matters per tool', () => {
  assert.equal(summarizeTool('Bash', { command: 'ls' }), 'ls');
  assert.equal(summarizeTool('Read', { file_path: '/a/b.md' }), '/a/b.md');
  assert.equal(summarizeTool('Grep', { pattern: 'foo', path: 'src' }), 'foo in src');
  assert.equal(summarizeTool('WebFetch', { url: 'https://x.dev' }), 'https://x.dev');
  assert.equal(summarizeTool('Unknown', { something: 'else' }), 'else');
});

test('a corrupt raw line does not stop the day from being read', () => {
  sandbox();
  const r = captureEvent(promptEvent('ESIN-6 good line'));
  fs.appendFileSync(r.file, '{ this is not json\n');
  captureEvent(promptEvent('ESIN-6 another good line'));
  assert.equal(readRawDay(dayOf()).length, 2);
});

test('capture never throws, even on a garbage payload', () => {
  sandbox();
  assert.doesNotThrow(() => captureEvent(null));
  assert.doesNotThrow(() => captureEvent({ hook_event_name: 'PreToolUse', tool_input: { command: { nested: true } } }));
});

// --- the hook binary itself -------------------------------------------------

function runHook(payload, env = {}) {
  const start = Date.now();
  const out = execFileSync(process.execPath, [HOOK], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  return { stdout: out, ms: Date.now() - start };
}

test('hook binary exits 0 and prints nothing on a normal event', () => {
  const dir = sandbox();
  const r = runHook(promptEvent('ESIN-7 via the real hook'), { WORKLOG_DIR: dir });
  assert.equal(r.stdout, '');
  const file = rawFileFor(dayOf(), 's1');
  assert.ok(fs.existsSync(file), 'hook should have written the raw file');
});

test('hook binary exits 0 on malformed stdin', () => {
  const dir = sandbox();
  assert.doesNotThrow(() => runHook('not json at all', { WORKLOG_DIR: dir }));
});

test('hook binary exits 0 when the data home is unwritable', () => {
  // Pointing WORKLOG_DIR at a file makes every write fail. The hook must still
  // exit 0 rather than break the session.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'worklog-hostile-'));
  const asFile = path.join(dir, 'not-a-dir');
  fs.writeFileSync(asFile, 'x');
  assert.doesNotThrow(() => runHook(promptEvent('ESIN-8'), { WORKLOG_DIR: asFile }));
});
