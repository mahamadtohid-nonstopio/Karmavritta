// Portable test entry point (dev-only, not shipped). `node --test "test/*.test.mjs"`
// needs Node 21+ to expand the glob, and `node --test test/` is rejected by
// Node 22+, so list the files ourselves and hand them over explicitly.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => path.join(dir, f));
const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(r.status ?? 1);
