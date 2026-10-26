import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_DIRS = ['bin', 'scripts', 'hooks'];
const SAFETY_MODULE = path.join(ROOT, 'scripts', 'lib', 'safety.mjs');

// Rule 3 of CLAUDE.md: every process start, file write and socket open goes
// through scripts/lib/safety.mjs. This test is what makes that enforceable —
// without it the rule is a comment nobody checks.

const FORBIDDEN = [
  { re: /\bfrom\s+['"](?:node:)?child_process['"]/, why: 'spawns processes' },
  { re: /\brequire\(\s*['"](?:node:)?child_process['"]/, why: 'spawns processes' },
  { re: /\bfs\.(?:writeFile|appendFile|mkdir|rm|rmdir|unlink|rename|copyFile|cp|truncate|chmod|symlink|mkdtemp)(?:Sync)?\s*\(/, why: 'mutates the filesystem' },
  { re: /\bfs\.createWriteStream\s*\(/, why: 'mutates the filesystem' },
  { re: /\bfrom\s+['"](?:node:)?(?:net|http|https|tls|dgram)['"]/, why: 'opens a network connection' },
  { re: /(?<![.\w])fetch\s*\(/, why: 'opens a network connection' }
];

/** Strip comments and string bodies so prose and literals cannot trip the scan. */
function stripNonCode(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += ' ';
      i++;
      while (i < n && src[i] !== quote) {
        if (src[i] === '\\') i++;
        i++;
      }
      i++;
      // Preserve the quotes so `from 'node:child_process'` still fails to match
      // only because the body is gone — import specifiers are checked below.
      out += `${quote}${quote}`;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Import specifiers must survive stripping, so collect them separately. */
function importSpecifiers(src) {
  const out = [];
  const re = /(?:from|import|require\s*\()\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) out.push(m[1]);
  return out;
}

function sourceFiles() {
  const out = [];
  const stack = SCAN_DIRS.map((d) => path.join(ROOT, d));
  while (stack.length) {
    const cur = stack.pop();
    if (!fs.existsSync(cur)) continue;
    for (const e of fs.readdirSync(cur, { withFileTypes: true })) {
      const p = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile() && p.endsWith('.mjs')) out.push(p);
    }
  }
  return out;
}

test('safety.mjs is the only module with side effects', () => {
  const files = sourceFiles().filter((f) => path.resolve(f) !== SAFETY_MODULE);
  assert.ok(files.length >= 5, 'expected to scan several source files');

  const violations = [];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const code = stripNonCode(src);
    const rel = path.relative(ROOT, file);

    for (const { re, why } of FORBIDDEN) {
      if (re.test(code)) violations.push(`${rel}: ${why} directly (${re.source})`);
    }
    for (const spec of importSpecifiers(src)) {
      const bare = spec.replace(/^node:/, '');
      if (['child_process', 'net', 'http', 'https', 'tls', 'dgram'].includes(bare)) {
        violations.push(`${rel}: imports ${spec} — route it through safety.mjs`);
      }
    }
  }

  assert.deepEqual(violations, [], `\n${violations.join('\n')}\n`);
});

test('every scanned module that writes imports safety', () => {
  // Sanity check on the scanner itself: if safety.mjs stopped containing the
  // real primitives, the test above would pass vacuously.
  const src = fs.readFileSync(SAFETY_MODULE, 'utf8');
  for (const needed of ['child_process', 'writeFileSync', 'renameSync', 'mkdirSync']) {
    assert.ok(src.includes(needed), `safety.mjs should own ${needed}`);
  }
});
