import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Skills are prompts that shell out to the CLI. This keeps them honest: every
// skill is well-formed, and every subcommand a skill tells Claude to run is
// one the CLI actually dispatches.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS = path.join(ROOT, 'skills');
const CLI_SRC = fs.readFileSync(path.join(ROOT, 'scripts', 'cli.mjs'), 'utf8');
const SUBCOMMANDS = new Set([...CLI_SRC.matchAll(/case '([a-z_-]+)':/g)].map((m) => m[1]));

// Model-invoked skills: everything else is an explicit /worklog:<name> command.
const MODEL_INVOKED = new Set(['recall', 'note']);

function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([a-z-]+):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].trim();
  }
  return fm;
}

const skills = fs.readdirSync(SKILLS).filter((d) => fs.existsSync(path.join(SKILLS, d, 'SKILL.md')));

test('there are skills to check', () => {
  assert.ok(skills.length >= 10, `found only ${skills.length}`);
});

for (const dir of skills) {
  const text = fs.readFileSync(path.join(SKILLS, dir, 'SKILL.md'), 'utf8');

  test(`skill ${dir}: frontmatter is well-formed`, () => {
    const fm = frontmatter(text);
    assert.ok(fm, 'missing --- frontmatter ---');
    assert.equal(fm.name, dir, 'name must match the folder');
    assert.ok((fm.description || '').length >= 40, 'description too short to route on');
    const explicitOnly = fm['disable-model-invocation'] === 'true';
    assert.equal(explicitOnly, !MODEL_INVOKED.has(dir),
      MODEL_INVOKED.has(dir) ? 'should be model-invoked' : 'should set disable-model-invocation: true');
  });

  test(`skill ${dir}: frontmatter values are valid YAML scalars`, () => {
    // An unquoted value containing ": " or " #" is a YAML error, and Claude Code
    // then loads the skill with NO metadata: the description silently vanishes.
    const block = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)[1];
    for (const line of block.split(/\r?\n/)) {
      const kv = line.match(/^([a-z-]+):\s+(.+)$/);
      if (!kv) continue;
      const v = kv[2].trim();
      if (/^["']/.test(v)) {
        assert.equal(v.at(-1), v[0], `${kv[1]}: quoted value must close with the same quote`);
        continue;
      }
      assert.doesNotMatch(v, /: | #/, `${kv[1]}: quote this value; ": " or " #" breaks YAML`);
    }
  });

  test(`skill ${dir}: every CLI subcommand it runs exists`, () => {
    const used = [...text.matchAll(/bin\/worklog\.mjs"\s+([a-z_-]+)/g)].map((m) => m[1]);
    for (const sub of used) assert.ok(SUBCOMMANDS.has(sub), `unknown subcommand "${sub}"`);
  });

  test(`skill ${dir}: no company names, hosts or real-looking secrets`, () => {
    assert.doesNotMatch(text, /https?:\/\/(?!127\.0\.0\.1|localhost)[a-z0-9.-]+\.[a-z]{2,}/i);
    assert.doesNotMatch(text, /\b(ghp_|xox[bp]-|AKIA)[A-Za-z0-9]{8,}/);
  });
}
