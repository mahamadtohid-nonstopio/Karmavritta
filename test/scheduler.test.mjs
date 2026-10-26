import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// These tests only build the strings that would be handed to the OS. Nothing
// here registers a real task, and `install()` / `remove()` are never called.

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'worklog-sched-'));
  process.env.WORKLOG_DIR = dir;
  return dir;
}

const scheduler = await import('../scripts/lib/scheduler.mjs');
const { getRuntimeDir } = await import('../scripts/lib/paths.mjs');

test('the tick command points at the runtime copy, not the plugin dir', () => {
  sandbox();
  const script = scheduler.tickScript();
  assert.equal(script, path.join(getRuntimeDir(), 'scripts', 'tick.mjs'));
  const cmd = scheduler.tickCommandString();
  assert.ok(cmd.includes(process.execPath));
  assert.ok(cmd.includes('tick.mjs'));
  assert.match(cmd, /^"/, 'paths are quoted so spaces survive');
});

test('cron intervals snap to a value that divides an hour', () => {
  const allowed = new Set([1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 60]);
  const originalPlatform = process.platform;
  Object.defineProperty(process, 'platform', { value: 'linux' });
  try {
    for (const n of [1, 7, 8, 13, 17, 25, 45, 59, 90]) {
      assert.ok(allowed.has(scheduler.normalizeInterval(n)), `${n} -> ${scheduler.normalizeInterval(n)}`);
    }
    assert.equal(scheduler.normalizeInterval(7), 6);
    assert.equal(scheduler.normalizeInterval(13), 12);
  } finally {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  }
});

test('nonsense intervals fall back to the default rather than throwing', () => {
  assert.equal(scheduler.normalizeInterval('nope'), 5);
  assert.equal(scheduler.normalizeInterval(0), 5);
  assert.equal(scheduler.normalizeInterval(-10), 5);
  assert.equal(scheduler.normalizeInterval(99999), 1439);
});

test('the cron line carries the marker so removal can find it', () => {
  const originalPlatform = process.platform;
  Object.defineProperty(process, 'platform', { value: 'linux' });
  try {
    const line = scheduler.cronLine(5);
    assert.match(line, /^\*\/5 \* \* \* \* /);
    assert.ok(line.endsWith(scheduler.CRON_MARKER));
    assert.equal(scheduler.cronLine(60).startsWith('0 * * * *'), true, 'hourly is not */60');
  } finally {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  }
});

test('the launchd plist is well-formed and uses seconds', () => {
  sandbox();
  const xml = scheduler.plistContent(10);
  assert.match(xml, /<key>Label<\/key><string>io\.worklog\.tick<\/string>/);
  assert.match(xml, /<key>StartInterval<\/key><integer>600<\/integer>/);
  assert.match(xml, /<key>RunAtLoad<\/key><false\/>/);
  assert.ok(xml.includes('tick.mjs'));
});

test('kind matches the platform', () => {
  const expected = { win32: 'schtasks', darwin: 'launchd' }[process.platform] || 'cron';
  assert.equal(scheduler.kind(), expected);
});
