import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'worklog-doctor-'));
  process.env.WORKLOG_DIR = dir;
  return dir;
}

const { diagnose, formatReport } = await import('../scripts/lib/doctor.mjs');
const { loadConfig, saveConfig, getConfigPath } = await import('../scripts/lib/config.mjs');
const { captureEvent } = await import('../scripts/lib/capture.mjs');
const { runTick } = await import('../scripts/lib/agent.mjs');

function byName(report, name) {
  return report.checks.find((c) => c.name === name);
}

test('a fresh data home diagnoses without failing, and warns about what is missing', () => {
  sandbox();
  const cfg = loadConfig();
  cfg.model.enabled = false;
  saveConfig(cfg);

  const report = diagnose();
  assert.equal(report.healthy, true, 'nothing is broken, things are merely unconfigured');
  assert.equal(byName(report, 'node runtime').status, 'ok');
  assert.equal(byName(report, 'capture').status, 'warn');
  assert.equal(byName(report, 'last tick').status, 'warn');
  assert.ok(byName(report, 'capture').fix, 'a warning must come with the command that fixes it');
});

test('unparseable config is reported as a failure with the path to fix', () => {
  sandbox();
  loadConfig();
  fs.writeFileSync(getConfigPath(), '{ not json');

  const report = diagnose();
  const check = byName(report, 'config');
  assert.equal(check.status, 'fail');
  assert.equal(report.healthy, false);
  assert.match(check.fix, /config\.json/);
});

test('capture and tick flip to ok once events have been summarised', async () => {
  sandbox();
  const cfg = loadConfig();
  cfg.model.enabled = false;
  saveConfig(cfg);

  captureEvent({ hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt: 'DEMO-1 work' });
  await runTick();

  const report = diagnose();
  assert.equal(byName(report, 'capture').status, 'ok');
  assert.equal(byName(report, 'last tick').status, 'ok');
  assert.equal(byName(report, 'claude cli').detail, 'model extraction disabled in config');
});

test('logged errors surface in the report', () => {
  const dir = sandbox();
  loadConfig();
  fs.mkdirSync(path.join(dir, 'logs'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'logs', 'errors.log'),
    `${JSON.stringify({ ts: '2026-01-01T00:00:00Z', message: 'something went wrong' })}\n`
  );

  const report = diagnose();
  assert.equal(byName(report, 'recent errors').status, 'warn');
  assert.equal(report.errors.length, 1);
  assert.match(byName(report, 'recent errors').detail, /something went wrong/);
});

test('the formatted report shows a fix line under every non-ok check', () => {
  sandbox();
  const cfg = loadConfig();
  cfg.model.enabled = false;
  saveConfig(cfg);

  const report = diagnose();
  const text = formatReport(report);
  assert.match(text, /worklog doctor/);
  for (const c of report.checks) {
    if (c.fix) assert.ok(text.includes(`→ ${c.fix}`), `missing fix line for ${c.name}`);
  }
  assert.match(text, /\d+ ok, \d+ warning, \d+ failing/);
});

test('doctor writes nothing beyond its own probe', () => {
  const dir = sandbox();
  loadConfig();
  diagnose();
  assert.equal(fs.existsSync(path.join(dir, '.doctor-probe')), false);
});
