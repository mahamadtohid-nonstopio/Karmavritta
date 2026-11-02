import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

// Read-only view of how Claude Code itself installed Worklog. Claude Code loads
// plugins from marketplaces (recorded in installed_plugins.json) or from
// `claude --plugin-dir <dir>`; a folder dropped into ~/.claude/plugins is not
// loaded. Worklog never writes Claude Code's settings: `worklog install` prints
// the commands and the user runs them.

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function claudePluginsDir() {
  return path.join(os.homedir(), '.claude', 'plugins');
}

/** The marketplace name this package declares (kept in one place: marketplace.json). */
export function marketplaceName(root = PACKAGE_ROOT) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'marketplace.json'), 'utf8')).name || 'karmavritta';
  } catch {
    return 'karmavritta';
  }
}

export function pluginId(root = PACKAGE_ROOT) {
  return `worklog@${marketplaceName(root)}`;
}

/**
 * Worklog's entry in Claude Code's installed_plugins.json, or null.
 * Returns { id, scope, installPath, version } for the first worklog@* entry.
 */
export function installedWorklog() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(claudePluginsDir(), 'installed_plugins.json'), 'utf8'));
    const plugins = raw.plugins || raw;
    const id = Object.keys(plugins).find((k) => /^worklog@/.test(k));
    if (!id) return null;
    const entry = [].concat(plugins[id])[0] || {};
    return { id, scope: entry.scope || '', installPath: entry.installPath || '', version: entry.version || '' };
  } catch {
    return null;
  }
}

/** The two commands that add this copy of Worklog to Claude Code. */
export function registerCommands(root = PACKAGE_ROOT) {
  return [
    `claude plugin marketplace add "${root}"`,
    `claude plugin install ${pluginId(root)}`
  ];
}
