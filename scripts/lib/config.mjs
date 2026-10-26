import fs from 'node:fs';
import * as safety from './safety.mjs';
import {
  getWorklogDir, getConfigPath, getTicketsDir, getRawDir, getDailyDir,
  getItemsDir, getLogsDir, getBackupsDir, getStatePath, getLedgerPath,
  getInboxPath, getIndexPath, getEventsLog, getErrorsLog, getRawDayDir,
  getDailyNotePath, getItemDir, getItemNotePath, getPluginInstallDir, getRuntimeDir
} from './paths.mjs';

export {
  getWorklogDir, getConfigPath, getTicketsDir, getRawDir, getDailyDir,
  getItemsDir, getLogsDir, getBackupsDir, getStatePath, getLedgerPath,
  getInboxPath, getIndexPath, getEventsLog, getErrorsLog, getRawDayDir,
  getDailyNotePath, getItemDir, getItemNotePath, getPluginInstallDir, getRuntimeDir
};

export const DEFAULT_CONFIG = {
  repos: [],
  docsFolders: [],
  keyPrefixes: [],
  authors: { names: [], emails: [] },
  ado: { org: '', project: '' },
  jira: { site: '' },
  docOpenScheme: 'vscode',

  // Session capture. Hooks are fail-open and never block a tool call.
  capture: {
    enabled: true,
    paused: false,
    events: ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'SessionEnd'],
    maxFieldChars: 2000,
    retainRawDays: 30
  },

  // Masking applied at capture, again before any model call, again before export.
  redaction: {
    mode: 'secrets',      // local | secrets | public
    names: [],            // local name list, masked in free text
    extraPatterns: []     // user-supplied regex sources
  },

  // The background tick is the only writer of notes.
  tick: {
    intervalMinutes: 5,
    enabled: true
  },

  // Cost control is on from the start, not bolted on later.
  model: {
    enabled: true,
    command: 'claude',
    maxCallsPerDay: 40,
    maxCallsPerTick: 2,
    dailyBudgetUsd: 1.0,
    estimatedCostPerCallUsd: 0.02,
    timeoutMs: 120000
  },

  safety: {
    allowCommands: [],
    allowWriteRoots: []
  }
};

export function ensureWorklogDir() {
  safety.mkdirp(getWorklogDir());
  safety.mkdirp(getTicketsDir());
}

export function ensureDataHome() {
  ensureWorklogDir();
  for (const dir of [getRawDir(), getDailyDir(), getItemsDir(), getLogsDir(), getBackupsDir()]) {
    safety.mkdirp(dir);
  }
}

export function loadConfig() {
  ensureWorklogDir();
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    safety.writeJsonAtomic(configPath, DEFAULT_CONFIG);
    return applySafetyPolicy(structuredClone(DEFAULT_CONFIG));
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
  return applySafetyPolicy(mergeConfig(structuredClone(DEFAULT_CONFIG), raw));
}

function applySafetyPolicy(cfg) {
  safety.allowCommands(cfg.safety?.allowCommands || []);
  for (const root of cfg.safety?.allowWriteRoots || []) safety.allowWriteRoot(root);
  return cfg;
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
  safety.writeJsonAtomic(getConfigPath(), cfg);
}
