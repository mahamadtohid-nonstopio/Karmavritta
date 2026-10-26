import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as safety from './lib/safety.mjs';
import { getPluginInstallDir, getRuntimeDir } from './lib/paths.mjs';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAYLOAD = ['.claude-plugin', 'bin', 'commands', 'hooks', 'prompts', 'scripts', 'skills'];

export async function installPlugin() {
  const target = getPluginInstallDir();
  copyPayload(target);

  // A second copy under the data home. The scheduled tick points here, so a
  // plugin upgrade that relocates files cannot leave a dangling scheduled task.
  const runtime = getRuntimeDir();
  copyPayload(runtime);

  console.log(`Installed Worklog plugin at: ${target}`);
  console.log(`Runtime copy for the tick:   ${runtime}`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Restart Claude Code (or /plugin reload) so it picks the plugin up.');
  console.log('  2. Run `worklog setup` to create the data home and schedule the tick.');
  console.log('  3. Run `worklog doctor` to confirm hooks, tick and runtime are healthy.');
  console.log('  4. Optionally add repos/docsFolders to the config and run `worklog backfill`.');
}

function copyPayload(target) {
  safety.mkdirp(path.dirname(target));
  if (fs.existsSync(target)) safety.removePath(target, { recursive: true });
  safety.mkdirp(target);
  for (const dir of PAYLOAD) {
    const src = path.join(PACKAGE_ROOT, dir);
    if (!fs.existsSync(src)) continue;
    safety.copyTree(src, path.join(target, dir));
  }
}
