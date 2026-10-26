import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'worklog-cfgstore-'));
  process.env.WORKLOG_DIR = dir;
  return dir;
}

const configstore = await import('../scripts/lib/configstore.mjs');
const { loadConfig, getConfigPath } = await import('../scripts/lib/config.mjs');

test('set writes a parsed value, not the raw string', async () => {
  sandbox();
  loadConfig();
  await configstore.setValue('redaction.mode', 'public');
  await configstore.setValue('tick.intervalMinutes', '15');
  await configstore.setValue('model.enabled', 'false');

  const cfg = loadConfig();
  assert.equal(cfg.redaction.mode, 'public');
  assert.equal(cfg.tick.intervalMinutes, 15);
  assert.equal(cfg.model.enabled, false);
});

test('an unknown key is refused with the known top-level keys listed', async () => {
  sandbox();
  loadConfig();
  await assert.rejects(
    () => configstore.setValue('redaction.nonsense', 'x'),
    (e) => /Unknown config key/.test(e.message) && /redaction/.test(e.message)
  );
});

test('every change is backed up and recorded in history', async () => {
  const dir = sandbox();
  loadConfig();
  await configstore.setValue('redaction.mode', 'public');
  await configstore.setValue('redaction.mode', 'local');

  const backups = fs.readdirSync(path.join(dir, 'backups', 'config'))
    .filter((f) => f.startsWith('config-'));
  assert.equal(backups.length, 2);

  const entries = configstore.history();
  assert.equal(entries.length, 2);
  assert.equal(entries[0].reason, 'set redaction.mode');
  assert.ok(entries[0].ts);
});

test('repeated undo walks the history backwards', async () => {
  sandbox();
  loadConfig();
  await configstore.setValue('redaction.mode', 'public');
  await configstore.setValue('redaction.mode', 'local');
  assert.equal(configstore.getValue('redaction.mode'), 'local');

  await configstore.undo();
  assert.equal(configstore.getValue('redaction.mode'), 'public');

  await configstore.undo();
  assert.equal(configstore.getValue('redaction.mode'), 'secrets', 'back to the default');
});

test('undo with no backups says so rather than throwing', async () => {
  sandbox();
  loadConfig();
  const r = await configstore.undo();
  assert.equal(r.restored, null);
  assert.match(r.reason, /no backups/);
});

test('get reads nested values and returns undefined for missing ones', async () => {
  sandbox();
  loadConfig();
  assert.equal(configstore.getValue('model.command'), 'claude');
  assert.equal(configstore.getValue('model.nope'), undefined);
  assert.equal(configstore.getValue('nope.nope'), undefined);
});

test('concurrent sets both land — the lock serialises them', async () => {
  sandbox();
  loadConfig();
  await Promise.all([
    configstore.setValue('redaction.mode', 'public'),
    configstore.setValue('tick.intervalMinutes', '30')
  ]);
  const cfg = JSON.parse(fs.readFileSync(getConfigPath(), 'utf8'));
  assert.equal(cfg.redaction.mode, 'public');
  assert.equal(cfg.tick.intervalMinutes, 30);
});
