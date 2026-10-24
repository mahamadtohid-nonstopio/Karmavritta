import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadConfig } from './lib/config.mjs';
import { extractKeys } from './lib/keys.mjs';
import { upsertTicket, mergeCommit, mergeDoc } from './lib/store.mjs';

const UNIT_SEP = '\x1f';

function gitLog(repoPath, { since, authorRegex } = {}) {
  const fmt = ['%H', '%an', '%ae', '%aI', '%D', '%s'].join(UNIT_SEP);
  const args = ['log', '--all', '--no-merges', `--pretty=format:${fmt}`];
  if (since) args.push(`--since=${since}`);
  if (authorRegex) args.push(`--author=${authorRegex}`, '--regexp-ignore-case');
  try {
    return execFileSync('git', args, {
      cwd: repoPath,
      encoding: 'utf8',
      maxBuffer: 200 * 1024 * 1024,
      windowsHide: true
    });
  } catch (e) {
    return null;
  }
}

function parseGitLog(output) {
  if (!output) return [];
  return output.split('\n').filter(Boolean).map((line) => {
    const [sha, author, email, date, refs, ...rest] = line.split(UNIT_SEP);
    return { sha, author, email, date, refs: refs || '', message: rest.join(UNIT_SEP) };
  });
}

function branchFromRefs(refs, keyPrefixes) {
  if (!refs) return '';
  // refs is comma-separated list of ref names
  const parts = refs.split(',').map((s) => s.trim().replace(/^HEAD -> /, ''));
  for (const p of parts) {
    const keys = extractKeys(p, keyPrefixes);
    if (keys.length) return p.replace(/^origin\//, '');
  }
  return '';
}

export async function syncGit({ since } = {}) {
  const cfg = loadConfig();
  let totalCommits = 0;
  let unassigned = 0;
  const errors = [];
  const authorRegex = buildAuthorRegex(cfg.authors);

  for (const repoPath of cfg.repos) {
    if (!fs.existsSync(repoPath)) {
      errors.push(`Repo not found: ${repoPath}`);
      continue;
    }
    const repoName = path.basename(repoPath);
    const output = gitLog(repoPath, { since, authorRegex });
    if (output === null) {
      errors.push(`git log failed in ${repoPath}`);
      continue;
    }
    const commits = parseGitLog(output);
    for (const c of commits) {
      const branch = branchFromRefs(c.refs, cfg.keyPrefixes);
      const keys = new Set([
        ...extractKeys(c.message, cfg.keyPrefixes),
        ...extractKeys(branch, cfg.keyPrefixes)
      ]);
      const commit = {
        sha: c.sha,
        repo: repoName,
        date: c.date,
        message: c.message,
        branch,
        author: c.author,
        authorEmail: c.email
      };
      if (keys.size === 0) {
        unassigned++;
        await upsertTicket('_unassigned', (t) => { mergeCommit(t, commit); });
      } else {
        for (const key of keys) {
          await upsertTicket(key, (t) => { mergeCommit(t, commit); });
        }
        totalCommits++;
      }
    }
  }
  return { commits: totalCommits, unassigned, errors };
}

function buildAuthorRegex(authors) {
  if (!authors) return '';
  const parts = [...(authors.names || []), ...(authors.emails || [])]
    .filter(Boolean)
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return parts.length ? parts.join('|') : '';
}

export async function syncDocs() {
  const cfg = loadConfig();
  let total = 0;
  const errors = [];

  for (const docsFolder of cfg.docsFolders) {
    if (!fs.existsSync(docsFolder)) {
      errors.push(`Docs folder not found: ${docsFolder}`);
      continue;
    }
    for (const file of walkDocs(docsFolder)) {
      let stat;
      try { stat = fs.statSync(file); } catch { continue; }
      const name = path.basename(file);
      let heading = '';
      try {
        const head = fs.readFileSync(file, 'utf8').split(/\r?\n/).slice(0, 40).join('\n');
        const m = head.match(/^#\s+(.+)$/m);
        if (m) heading = m[1].trim();
      } catch {}

      const headerText = fs.existsSync(file)
        ? safeReadHead(file, 40)
        : '';
      const keys = new Set([
        ...extractKeys(name, cfg.keyPrefixes),
        ...extractKeys(headerText, cfg.keyPrefixes)
      ]);

      const doc = {
        path: file,
        title: heading || name.replace(/\.md$/, ''),
        created: stat.birthtime.toISOString(),
        modified: stat.mtime.toISOString()
      };

      if (keys.size === 0) {
        await upsertTicket('_unassigned', (t) => { mergeDoc(t, doc); });
      } else {
        for (const key of keys) {
          await upsertTicket(key, (t) => { mergeDoc(t, doc); });
        }
        total++;
      }
    }
  }
  return { docs: total, errors };
}

function safeReadHead(file, lines) {
  try {
    return fs.readFileSync(file, 'utf8').split(/\r?\n/).slice(0, lines).join('\n');
  } catch { return ''; }
}

function walkDocs(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(cur, e.name);
      if (e.isDirectory()) {
        if (!e.name.startsWith('.') && e.name !== 'node_modules') stack.push(p);
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
        out.push(p);
      }
    }
  }
  return out;
}
