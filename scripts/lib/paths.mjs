import path from 'node:path';
import os from 'node:os';

// Pure path resolution, no side effects and no imports beyond node builtins.
// Kept separate from config.mjs so safety.mjs can depend on it without a cycle.

export function getWorklogDir() {
  return process.env.WORKLOG_DIR || path.join(os.homedir(), '.worklog');
}

export function getConfigPath()  { return path.join(getWorklogDir(), 'config.json'); }
export function getTicketsDir()  { return path.join(getWorklogDir(), 'tickets'); }
export function getRawDir()      { return path.join(getWorklogDir(), 'raw'); }
export function getDailyDir()    { return path.join(getWorklogDir(), 'daily'); }
export function getItemsDir()    { return path.join(getWorklogDir(), 'items'); }
export function getExportsDir()  { return path.join(getWorklogDir(), 'exports'); }
export function getLogsDir()     { return path.join(getWorklogDir(), 'logs'); }
export function getBackupsDir()  { return path.join(getWorklogDir(), 'backups'); }
export function getStatePath()   { return path.join(getWorklogDir(), 'state.json'); }
export function getLedgerPath()  { return path.join(getWorklogDir(), 'spend.json'); }
export function getInboxPath()   { return path.join(getWorklogDir(), 'inbox.md'); }
export function getIndexPath()   { return path.join(getWorklogDir(), 'index.json'); }
export function getEventsLog()   { return path.join(getLogsDir(), 'events.log'); }
export function getErrorsLog()   { return path.join(getLogsDir(), 'errors.log'); }

export function getRawDayDir(day) { return path.join(getRawDir(), day); }
export function getDailyNotePath(day) { return path.join(getDailyDir(), `${day}.md`); }
export function getItemDir(key) { return path.join(getItemsDir(), key); }
export function getItemNotePath(key) { return path.join(getItemDir(key), 'README.md'); }

export function getPluginInstallDir() {
  return path.join(os.homedir(), '.claude', 'plugins', 'worklog');
}

// Stable runtime copy, so a plugin update that moves paths cannot break the
// scheduled tick (PRD risk: "Plugin path changes on update").
export function getRuntimeDir() {
  return path.join(getWorklogDir(), 'runtime');
}
