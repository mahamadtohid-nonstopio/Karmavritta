import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as safety from './safety.mjs';
import { getRuntimeDir } from './config.mjs';

// Registers the background tick with whatever the OS provides. The tick always
// points at the runtime copy under the data home, never at the plugin install
// dir, so a plugin upgrade that moves files cannot orphan the schedule.

export const TASK_NAME = 'WorklogTick';
export const LAUNCHD_LABEL = 'io.worklog.tick';
export const CRON_MARKER = '# worklog-tick';

export function tickScript() {
  return path.join(getRuntimeDir(), 'scripts', 'tick.mjs');
}

export function tickCommandString() {
  return `"${process.execPath}" "${tickScript()}"`;
}

export function plistPath() {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`);
}

export function kind() {
  if (process.platform === 'win32')  return 'schtasks';
  if (process.platform === 'darwin') return 'launchd';
  return 'cron';
}

/** Cron only understands step values that divide an hour cleanly. */
export function normalizeInterval(minutes) {
  const n = Math.round(Number(minutes) || 5);
  if (!Number.isFinite(n) || n < 1) return 5;
  if (n > 1439) return 1439;
  if (kind() !== 'cron') return n;
  const allowed = [1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 60];
  return allowed.reduce((best, c) => (Math.abs(c - n) < Math.abs(best - n) ? c : best), 5);
}

export function plistContent(intervalMinutes) {
  const seconds = normalizeInterval(intervalMinutes) * 60;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${tickScript()}</string>
  </array>
  <key>StartInterval</key><integer>${seconds}</integer>
  <key>RunAtLoad</key><false/>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
`;
}

export function cronLine(intervalMinutes) {
  const n = normalizeInterval(intervalMinutes);
  const spec = n === 60 ? '0 * * * *' : `*/${n} * * * *`;
  return `${spec} ${tickCommandString()} >/dev/null 2>&1 ${CRON_MARKER}`;
}

function currentCrontab() {
  const r = safety.runCapture('crontab', ['-l']);
  // A user with no crontab yet exits non-zero; that is not an error here.
  return r.ok ? r.stdout : '';
}

function writeCrontab(text) {
  const normalized = text.endsWith('\n') || text === '' ? text : `${text}\n`;
  return safety.runCapture('crontab', ['-'], { input: normalized });
}

export function status() {
  switch (kind()) {
    case 'schtasks': {
      const r = safety.runCapture('schtasks', ['/Query', '/TN', TASK_NAME]);
      return { kind: 'schtasks', installed: r.ok, detail: r.ok ? r.stdout.trim().split('\n').at(-1) : r.reason };
    }
    case 'launchd': {
      const exists = fs.existsSync(plistPath());
      const r = safety.runCapture('launchctl', ['list', LAUNCHD_LABEL]);
      return { kind: 'launchd', installed: exists && r.ok, detail: exists ? plistPath() : 'no plist' };
    }
    default: {
      const lines = currentCrontab().split('\n').filter((l) => l.includes(CRON_MARKER));
      return { kind: 'cron', installed: lines.length > 0, detail: lines[0] || 'no crontab entry' };
    }
  }
}

export function install(intervalMinutes = 5) {
  const n = normalizeInterval(intervalMinutes);
  switch (kind()) {
    case 'schtasks': {
      const r = safety.runCapture('schtasks', [
        '/Create', '/SC', 'MINUTE', '/MO', String(n),
        '/TN', TASK_NAME, '/TR', tickCommandString(), '/F'
      ]);
      return { ok: r.ok, kind: 'schtasks', intervalMinutes: n, detail: r.ok ? r.stdout.trim() : r.reason };
    }
    case 'launchd': {
      safety.writeFileAtomic(plistPath(), plistContent(n));
      safety.runCapture('launchctl', ['unload', plistPath()]);
      const r = safety.runCapture('launchctl', ['load', '-w', plistPath()]);
      return { ok: r.ok, kind: 'launchd', intervalMinutes: n, detail: r.ok ? plistPath() : r.reason };
    }
    default: {
      const kept = currentCrontab().split('\n').filter((l) => l.trim() && !l.includes(CRON_MARKER));
      const r = writeCrontab([...kept, cronLine(n)].join('\n'));
      return { ok: r.ok, kind: 'cron', intervalMinutes: n, detail: r.ok ? cronLine(n) : r.reason };
    }
  }
}

export function remove() {
  switch (kind()) {
    case 'schtasks': {
      const r = safety.runCapture('schtasks', ['/Delete', '/TN', TASK_NAME, '/F']);
      return { ok: r.ok, detail: r.ok ? 'deleted' : r.reason };
    }
    case 'launchd': {
      safety.runCapture('launchctl', ['unload', plistPath()]);
      if (fs.existsSync(plistPath())) safety.removePath(plistPath());
      return { ok: true, detail: 'unloaded' };
    }
    default: {
      const kept = currentCrontab().split('\n').filter((l) => l.trim() && !l.includes(CRON_MARKER));
      const r = writeCrontab(kept.join('\n'));
      return { ok: r.ok, detail: r.ok ? 'removed' : r.reason };
    }
  }
}
