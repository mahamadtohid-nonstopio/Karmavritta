import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function installPlugin() {
  const target = path.join(os.homedir(), '.claude', 'plugins', 'worklog');
  fs.mkdirSync(path.dirname(target), { recursive: true });

  if (fs.existsSync(target)) {
    console.log(`Removing existing install at ${target}`);
    fs.rmSync(target, { recursive: true, force: true });
  }

  fs.mkdirSync(target, { recursive: true });
  for (const dir of ['.claude-plugin', 'commands', 'scripts', 'skills']) {
    const src = path.join(PACKAGE_ROOT, dir);
    if (!fs.existsSync(src)) continue;
    copyRecursive(src, path.join(target, dir));
  }

  console.log(`Installed Worklog plugin at: ${target}`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Restart Claude Code (or /plugin reload) so it picks the plugin up.');
  console.log('  2. Run `worklog init` to create ~/.worklog/config.json.');
  console.log('  3. Edit the config: add your repos and docsFolders.');
  console.log('     Leave `keyPrefixes` empty to capture every PROJ-123 style key,');
  console.log('     or set e.g. ["ESIN","OPP"] to restrict.');
  console.log('  4. Run `worklog backfill --since 2026-01-01` to build history.');
  console.log('  5. Try `/worklog <KEY>` inside Claude Code.');
}

function copyRecursive(src, dst) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      copyRecursive(path.join(src, name), path.join(dst, name));
    }
  } else {
    fs.copyFileSync(src, dst);
  }
}
