import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const DEFAULT_CONFIG = {
  repos: [],
  docsFolders: [],
  keyPrefixes: [],
  authors: { names: [], emails: [] },
  ado: { org: '', project: '' },
  jira: { site: '' },
  docOpenScheme: 'vscode'
};

export function getWorklogDir() {
  return process.env.WORKLOG_DIR || path.join(os.homedir(), '.worklog');
}

export function getConfigPath() {
  return path.join(getWorklogDir(), 'config.json');
}

export function getTicketsDir() {
  return path.join(getWorklogDir(), 'tickets');
}

export function getEventsLog() {
  return path.join(getWorklogDir(), 'events.log');
}

export function getErrorsLog() {
  return path.join(getWorklogDir(), 'errors.log');
}

export function ensureWorklogDir() {
  fs.mkdirSync(getWorklogDir(), { recursive: true });
  fs.mkdirSync(getTicketsDir(), { recursive: true });
}

export function loadConfig() {
  ensureWorklogDir();
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2));
    return structuredClone(DEFAULT_CONFIG);
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (e) {
    const msg = `Could not parse ${configPath} as JSON: ${e.message}\nFix the file or delete it to regenerate the default.`;
    const err = new Error(msg);
    err.code = 'WORKLOG_CONFIG_INVALID';
    throw err;
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${configPath} must contain a JSON object at the top level.`);
  }
  return mergeConfig(structuredClone(DEFAULT_CONFIG), raw);
}

function mergeConfig(base, override) {
  const out = { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (v === null || v === undefined) continue;
    if (
      typeof v === 'object' && !Array.isArray(v) &&
      typeof base[k] === 'object' && !Array.isArray(base[k]) && base[k] !== null
    ) {
      out[k] = mergeConfig(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function saveConfig(cfg) {
  ensureWorklogDir();
  fs.writeFileSync(getConfigPath(), JSON.stringify(cfg, null, 2));
}
