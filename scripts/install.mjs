import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as safety from './lib/safety.mjs';
import { getRuntimeDir } from './lib/paths.mjs';
import { installedWorklog, registerCommands, pluginId, marketplaceName } from './lib/claudeplugins.mjs';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAYLOAD = ['.claude-plugin', 'bin', 'commands', 'hooks', 'prompts', 'scripts', 'skills'];

/**
 * Prepare this copy of Worklog and show how to add it to Claude Code.
 *
 * Claude Code loads plugins only from marketplaces (or `--plugin-dir`), so the
 * install itself is two `claude plugin` commands. Worklog prints them rather
 * than running them: it never writes Claude Code's settings on its own.
 */
export async function installPlugin() {
  const runtime = refreshRuntime();
  const installed = installedWorklog();
  const [addCmd, installCmd] = registerCommands(PACKAGE_ROOT);

  console.log(`Runtime for the background tick: ${runtime}`);
  console.log('');
  if (installed) {
    console.log(`✓ Claude Code already has ${installed.id}${installed.version ? ` v${installed.version}` : ''}.`);
    console.log(`  To move it to this version: claude plugin marketplace update ${marketplaceName(PACKAGE_ROOT)}`);
    console.log(`                              claude plugin update ${installed.id}`);
  } else {
    console.log('Add Worklog to Claude Code by running these two commands once:');
    console.log('');
    console.log(`  ${addCmd}`);
    console.log(`  ${installCmd}`);
    console.log('');
    console.log('(Inside Claude Code the same is: /plugin marketplace add <folder above>, then');
    console.log(`/plugin install ${pluginId(PACKAGE_ROOT)}.) Already added the GitHub marketplace? Skip this.`);
  }
  console.log('');
  console.log('Then restart Claude Code and run /worklog:setup (or `worklog setup`).');
}

/**
 * Refresh the runtime copy the scheduled tick runs from. `install` and `setup`
 * both call this, so a marketplace install (where nobody runs `worklog install`)
 * still gets a tick that exists, and re-running setup after an update refreshes it.
 */
export function refreshRuntime() {
  const runtime = getRuntimeDir();
  copyPayload(runtime);
  return runtime;
}

function copyPayload(target) {
  // mkdirp is recursive, so the parent needs no separate call. Creating the
  // parent explicitly would ask the safety layer to write outside the target.
  if (fs.existsSync(target)) safety.removePath(target, { recursive: true });
  safety.mkdirp(target);
  for (const dir of PAYLOAD) {
    const src = path.join(PACKAGE_ROOT, dir);
    if (!fs.existsSync(src)) continue;
    safety.copyTree(src, path.join(target, dir));
  }
}
