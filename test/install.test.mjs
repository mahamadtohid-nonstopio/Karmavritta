import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'worklog-install-test-'));
process.env.WORKLOG_DIR = TMP;

const { refreshRuntime } = await import('../scripts/install.mjs');
const { tickScript } = await import('../scripts/lib/scheduler.mjs');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('refreshRuntime puts the tick script where the scheduler points', () => {
  const runtime = refreshRuntime();
  assert.equal(runtime, path.join(TMP, 'runtime'));
  assert.ok(fs.existsSync(tickScript()), `missing ${tickScript()}`);
  assert.ok(fs.existsSync(path.join(runtime, 'skills', 'recall', 'SKILL.md')));
  assert.ok(!fs.existsSync(path.join(runtime, 'test')), 'tests are not part of the runtime payload');
});

test('refreshRuntime replaces a stale copy rather than merging into it', () => {
  const stale = path.join(TMP, 'runtime', 'scripts', 'stale-leftover.mjs');
  fs.writeFileSync(stale, '// from an older version');
  refreshRuntime();
  assert.ok(!fs.existsSync(stale));
});

test('marketplace and plugin manifests agree with package.json', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const plugin = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
  const market = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'));
  const entry = market.plugins.find((p) => p.name === plugin.name);
  assert.ok(entry, 'marketplace lists the plugin by its plugin.json name');
  assert.equal(entry.source, './');
  assert.equal(plugin.version, pkg.version);
  assert.equal(entry.version, pkg.version);
});

// --- `worklog install` as a user runs it ------------------------------------------
// The home and temp folders are separate here. When home sits inside the temp
// folder, the safety layer allows everything and real bugs hide (one did: install
// tried to create ~/.claude/plugins, which is outside the write allowlist).

import { execFileSync } from 'node:child_process';

function isolated() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'worklog-install-iso-'));
  const home = path.join(root, 'home');
  const tmp = path.join(root, 'tmp');
  fs.mkdirSync(home); fs.mkdirSync(tmp);
  const env = { ...process.env, HOME: home, USERPROFILE: home, TEMP: tmp, TMP: tmp, TMPDIR: tmp, WORKLOG_DIR: path.join(home, '.worklog') };
  return { home, env };
}

function runCli(args, env) {
  try {
    return { ok: true, out: execFileSync(process.execPath, [path.join(ROOT, 'bin', 'worklog.mjs'), ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { ok: false, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

test('worklog install succeeds with a real home layout and writes nothing into ~/.claude', () => {
  const { home, env } = isolated();
  const r = runCli(['install'], env);
  assert.ok(r.ok, r.out);
  assert.match(r.out, /claude plugin marketplace add "/);
  assert.match(r.out, /claude plugin install worklog@karmavritta/);
  assert.ok(fs.existsSync(path.join(home, '.worklog', 'runtime', 'scripts', 'tick.mjs')), 'runtime prepared');
  assert.ok(!fs.existsSync(path.join(home, '.claude')), 'Claude Code settings are never written by Worklog');
});

test('worklog install recognises an existing Claude Code install', () => {
  const { home, env } = isolated();
  const dir = path.join(home, '.claude', 'plugins');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: {
    'worklog@karmavritta': [{ scope: 'user', installPath: path.join(dir, 'cache', 'x'), version: '0.4.0' }] } }));
  const r = runCli(['install'], env);
  assert.ok(r.ok, r.out);
  assert.match(r.out, /already has worklog@karmavritta v0\.4\.0/);
  assert.match(r.out, /claude plugin update worklog@karmavritta/);
});

test('doctor reads Claude Code\'s own install record', () => {
  const { home, env } = isolated();
  const before = JSON.parse(runCli(['doctor', '--json'], env).out);
  const plugin = (rep) => rep.checks.find((c) => c.name === 'plugin install');
  assert.equal(plugin(before).status, 'warn');
  assert.match(plugin(before).detail, /--plugin-dir/);
  assert.equal(before.checks.find((c) => c.name === 'hooks').status, 'ok', 'falls back to this package\'s manifest');

  const dir = path.join(home, '.claude', 'plugins');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: {
    'worklog@karmavritta': [{ scope: 'user', installPath: ROOT, version: '0.4.0' }] } }));
  const after = JSON.parse(runCli(['doctor', '--json'], env).out);
  assert.equal(plugin(after).status, 'ok');
  assert.match(plugin(after).detail, /worklog@karmavritta \(v0\.4\.0, user scope\)/);
});
