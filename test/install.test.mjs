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
