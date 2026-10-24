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
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  return { ...structuredClone(DEFAULT_CONFIG), ...raw };
}

export function saveConfig(cfg) {
  ensureWorklogDir();
  fs.writeFileSync(getConfigPath(), JSON.stringify(cfg, null, 2));
}
