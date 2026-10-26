import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'worklog-cfg-test-'));
process.env.WORKLOG_DIR = TMP;

const cfgModule = await import('../scripts/lib/config.mjs?v=cfg');
const { loadConfig, DEFAULT_CONFIG, getConfigPath } = cfgModule;

function writeConfig(obj) {
  fs.mkdirSync(TMP, { recursive: true });
  fs.writeFileSync(getConfigPath(), typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2));
}

test('creates default config when missing', () => {
  const p = getConfigPath();
  if (fs.existsSync(p)) fs.unlinkSync(p);
  const cfg = loadConfig();
  assert.deepEqual(cfg.repos, []);
  assert.deepEqual(cfg.keyPrefixes, []);
  assert.deepEqual(cfg.authors, { names: [], emails: [] });
  assert.ok(fs.existsSync(p));
});

test('deep-merges user config over defaults (partial authors)', () => {
  writeConfig({
    repos: ['C:\\x'],
    authors: { names: ['me'] }
  });
  const cfg = loadConfig();
  assert.deepEqual(cfg.repos, ['C:\\x']);
  assert.deepEqual(cfg.authors.names, ['me']);
  assert.deepEqual(cfg.authors.emails, []);  // kept from default
});

test('bad JSON surfaces a WORKLOG_CONFIG_INVALID error', () => {
  writeConfig('{ not json');
  try {
    loadConfig();
    assert.fail('should have thrown');
  } catch (e) {
    assert.equal(e.code, 'WORKLOG_CONFIG_INVALID');
    assert.match(e.message, /Could not parse/);
  }
});

test('rejects top-level array config', () => {
  writeConfig([]);
  assert.throws(() => loadConfig(), /must contain a JSON object/);
});
