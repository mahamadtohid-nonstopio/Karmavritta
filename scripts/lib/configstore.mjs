import fs from 'node:fs';
import path from 'node:path';
import * as safety from './safety.mjs';
import {
  loadConfig, getConfigPath, getBackupsDir, ensureWorklogDir, DEFAULT_CONFIG
} from './config.mjs';

// The one write path for config.json. Every change is locked, backed up and
// recorded, so any setting can be reverted (PRD improvement #10).

const KEEP_BACKUPS = 50;

function configBackupDir() { return path.join(getBackupsDir(), 'config'); }
function historyPath()     { return path.join(configBackupDir(), 'history.jsonl'); }
function lockDir()         { return path.join(getBackupsDir(), '.config.lock'); }

const STALE_LOCK_MS = 15_000;

async function withLock(fn) {
  ensureWorklogDir();
  safety.mkdirp(getBackupsDir());
  const start = Date.now();
  while (!safety.tryMkdirExclusive(lockDir())) {
    try {
      const stat = fs.statSync(lockDir());
      if (Date.now() - stat.mtimeMs > STALE_LOCK_MS) { safety.removeDirIfEmpty(lockDir()); continue; }
    } catch {}
    if (Date.now() - start > 5000) throw new Error(`Could not acquire config lock at ${lockDir()}`);
    await new Promise((r) => setTimeout(r, 30));
  }
  try { return await fn(); } finally { safety.removeDirIfEmpty(lockDir()); }
}

/**
 * `prefix` keeps the undo chain honest. Snapshots taken *by* an undo are named
 * `pre-undo-` so they are not themselves candidates to restore — otherwise
 * repeated undos would oscillate between the last two values instead of
 * walking backwards through history.
 */
function backupCurrent(reason, prefix = 'config') {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) return null;
  safety.mkdirp(configBackupDir());
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(configBackupDir(), `${prefix}-${stamp}.json`);
  safety.copyFile(configPath, file);
  safety.appendLine(historyPath(), JSON.stringify({
    ts: new Date().toISOString(),
    reason: reason || 'update',
    file: path.basename(file)
  }));
  prune(prefix);
  return file;
}

function snapshots(prefix = 'config') {
  const dir = configBackupDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.startsWith(`${prefix}-`) && f.endsWith('.json'))
    .sort();
}

function prune(prefix = 'config') {
  const files = snapshots(prefix);
  for (const f of files.slice(0, Math.max(0, files.length - KEEP_BACKUPS))) {
    safety.removePath(path.join(configBackupDir(), f));
  }
}

export function history() {
  const p = historyPath();
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

/** Read-modify-write under lock, with a backup taken first. */
export async function updateConfig(mutator, { reason } = {}) {
  return withLock(async () => {
    const current = loadConfig();
    backupCurrent(reason);
    const next = mutator(structuredClone(current)) || current;
    safety.writeJsonAtomic(getConfigPath(), next);
    return next;
  });
}

function parseValue(raw) {
  if (typeof raw !== 'string') return raw;
  const trimmed = raw.trim();
  if (trimmed === '') return '';
  try { return JSON.parse(trimmed); } catch { return raw; }
}

function assertKnownPath(dotPath) {
  const parts = dotPath.split('.');
  let cursor = DEFAULT_CONFIG;
  for (const part of parts) {
    if (cursor === null || typeof cursor !== 'object' || !(part in cursor)) {
      throw new Error(
        `Unknown config key: ${dotPath}\nKnown top-level keys: ${Object.keys(DEFAULT_CONFIG).join(', ')}`
      );
    }
    cursor = cursor[part];
  }
  return parts;
}

/** `worklog config set redaction.mode public` */
export async function setValue(dotPath, rawValue) {
  const parts = assertKnownPath(dotPath);
  const value = parseValue(rawValue);
  return updateConfig((cfg) => {
    let cursor = cfg;
    for (const part of parts.slice(0, -1)) {
      if (cursor[part] === null || typeof cursor[part] !== 'object') cursor[part] = {};
      cursor = cursor[part];
    }
    cursor[parts.at(-1)] = value;
    return cfg;
  }, { reason: `set ${dotPath}` });
}

export function getValue(dotPath) {
  let cursor = loadConfig();
  for (const part of dotPath.split('.')) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

/** Restore the most recent backup. Taking a backup of the current state first. */
export async function undo() {
  return withLock(async () => {
    const newest = snapshots().at(-1);
    if (!newest) return { restored: null, reason: 'no backups yet' };
    const file = path.join(configBackupDir(), newest);
    const content = fs.readFileSync(file, 'utf8');
    backupCurrent(`undo ${newest}`, 'pre-undo');
    safety.writeFileAtomic(getConfigPath(), content);
    // The restored snapshot is now current; drop it so the next undo goes
    // one step further back rather than restoring the same file again.
    safety.removePath(file);
    return { restored: newest };
  });
}
