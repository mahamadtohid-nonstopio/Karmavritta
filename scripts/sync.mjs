import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadConfig } from './lib/config.mjs';
import { extractKeys } from './lib/keys.mjs';
import { upsertTicket, mergeCommit, mergeDoc, readTicket, listTickets, writeAtomic } from './lib/store.mjs';
import { loadIndex, updateLastSync } from './lib/index.mjs';
import { getWorklogDir } from './lib/config.mjs';

const UNIT_SEP = '\x1f';

function gitLog(repoPath, { since, authorRegex } = {}) {
  const fmt = ['%H', '%an', '%ae', '%aI', '%D', '%s'].join(UNIT_SEP);
  const args = ['log', '--all', '--no-merges', `--pretty=format:${fmt}`];
  if (since) args.push(`--since=${since}`);
  if (authorRegex) args.push(`--author=${authorRegex}`, '--regexp-ignore-case');
  try {
    return { ok: true, output: execFileSync('git', args, {
      cwd: repoPath,
      encoding: 'utf8',
      maxBuffer: 200 * 1024 * 1024,
      windowsHide: true
    }) };
  } catch (e) {
    if (e.code === 'ENOENT') {
      return { ok: false, reason: 'git executable not found on PATH' };
    }
    const stderr = (e.stderr || '').toString().trim();
    return { ok: false, reason: stderr || e.message || 'git log failed' };
  }
}

export function detectGit() {
  try {
    const out = execFileSync('git', ['--version'], { encoding: 'utf8', windowsHide: true });
    return out.trim();
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

export async function syncGit({ since, onProgress } = {}) {
  const cfg = loadConfig();
  let totalCommits = 0;
  let unassigned = 0;
  const errors = [];
  const authorRegex = buildAuthorRegex(cfg.authors);

  if (cfg.repos.length && !detectGit()) {
    errors.push('git executable not found on PATH — install Git or add it to PATH, then re-run.');
    return { commits: 0, unassigned: 0, errors };
  }

  const existingIndex = loadIndex({ silent: true });
  const lastSyncMap = existingIndex?.lastSync || {};

  // Batch pass 1: group commits by ticket key so we only lock each ticket once.
  const byKey = new Map();  // key -> commit[]

  for (const repoPath of cfg.repos) {
    if (!fs.existsSync(repoPath)) {
      errors.push(`Repo not found: ${repoPath}`);
      continue;
    }
    const repoName = path.basename(repoPath);
    // Incremental: use explicit --since when provided; else fall back to the last
    // successful sync for this repo. If neither is set, scan full history.
    const effectiveSince = since || lastSyncMap[repoName] || undefined;
    onProgress?.(effectiveSince
      ? `  scanning ${repoName} since ${effectiveSince}...`
      : `  scanning ${repoName} (full history)...`);
    const result = gitLog(repoPath, { since: effectiveSince, authorRegex });
    if (!result.ok) {
      errors.push(`git log failed in ${repoPath}: ${result.reason}`);
      continue;
    }
    const commits = parseGitLog(result.output);
    for (const c of commits) {
      const branch = branchFromRefs(c.refs, cfg.keyPrefixes);
      const keys = new Set([
        ...extractKeys(c.message, cfg.keyPrefixes),
        ...extractKeys(branch, cfg.keyPrefixes)
      ]);
      const commit = {
        sha: c.sha, repo: repoName, date: c.date, message: c.message,
        branch, author: c.author, authorEmail: c.email
      };
      if (keys.size === 0) {
        unassigned++;
        pushTo(byKey, '_unassigned', commit);
      } else {
        totalCommits++;
        for (const key of keys) pushTo(byKey, key, commit);
      }
    }
    // Stamp the sync *after* a successful parse. Keep a 60s cushion so a commit
    // created during the same second as the sync isn't skipped next time.
    const stamp = new Date(Date.now() - 60_000).toISOString();
    updateLastSync(repoName, stamp);
  }

  // Batch pass 2: one lock + atomic write per touched ticket.
  for (const [key, commits] of byKey) {
    await upsertTicket(key, (t) => {
      for (const c of commits) mergeCommit(t, c);
    });
  }
  return { commits: totalCommits, unassigned, errors };
}

function pushTo(map, key, value) {
  let arr = map.get(key);
  if (!arr) { arr = []; map.set(key, arr); }
  arr.push(value);
}

function buildAuthorRegex(authors) {
  if (!authors) return '';
  const parts = [...(authors.names || []), ...(authors.emails || [])]
    .filter(Boolean)
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return parts.length ? parts.join('|') : '';
}

export async function syncDocs({ onProgress } = {}) {
  const cfg = loadConfig();
  let total = 0;
  let skipped = 0;
  const errors = [];

  const existingIndex = loadIndex({ silent: true });
  const lastDocsScan = existingIndex?.lastDocsScan ? new Date(existingIndex.lastDocsScan).getTime() : 0;

  const byKey = new Map();

  for (const docsFolder of cfg.docsFolders) {
    if (!fs.existsSync(docsFolder)) {
      errors.push(`Docs folder not found: ${docsFolder}`);
      continue;
    }
    onProgress?.(`  scanning ${docsFolder}${lastDocsScan ? ' (incremental)' : ''}...`);
    for (const file of walkDocs(docsFolder)) {
      let stat;
      try { stat = fs.statSync(file); } catch { continue; }
      // Skip files unchanged since the last scan. We still see new files because
      // their mtime is naturally after lastDocsScan.
      if (lastDocsScan && stat.mtime.getTime() < lastDocsScan) { skipped++; continue; }
      const name = path.basename(file);
      const head = safeReadHead(file, 40);
      const headingMatch = head.match(/^#\s+(.+)$/m);
      const heading = headingMatch ? headingMatch[1].trim() : '';

      const keys = new Set([
        ...extractKeys(name, cfg.keyPrefixes),
        ...extractKeys(head, cfg.keyPrefixes)
      ]);

      const doc = {
        path: file,
        title: heading || name.replace(/\.md$/, ''),
        created: stat.birthtime.toISOString(),
        modified: stat.mtime.toISOString()
      };

      if (keys.size === 0) {
        pushTo(byKey, '_unassigned', doc);
      } else {
        total++;
        for (const key of keys) pushTo(byKey, key, doc);
      }
    }
  }

  for (const [key, docs] of byKey) {
    await upsertTicket(key, (t) => {
      for (const d of docs) mergeDoc(t, d);
    });
  }

  // Mark docs that no longer exist on disk as `missing: true`.
  const stillMissing = await markMissingDocs();

  // Stamp the scan time so the next invocation skips untouched files.
  stampDocsScan();

  return { docs: total, skipped, missing: stillMissing, errors };
}

async function markMissingDocs() {
  let count = 0;
  for (const key of listTickets()) {
    const t = readTicket(key);
    if (!t?.docs?.length) continue;
    let changed = false;
    for (const d of t.docs) {
      const exists = fs.existsSync(d.path);
      if (!exists && !d.missing) { d.missing = true; changed = true; count++; }
      else if (exists && d.missing) { delete d.missing; changed = true; }
    }
    if (changed) {
      await upsertTicket(key, (orig) => {
        for (const d of orig.docs) {
          const latest = t.docs.find((x) => x.path === d.path);
          if (latest) {
            if (latest.missing) d.missing = true; else delete d.missing;
          }
        }
      });
    }
  }
  return count;
}

function stampDocsScan() {
  const idx = loadIndex({ silent: true }) || {
    generatedAt: new Date().toISOString(), ticketCount: 0, tickets: [], lastSync: {}
  };
  idx.lastDocsScan = new Date().toISOString();
  writeAtomic(path.join(getWorklogDir(), 'index.json'), JSON.stringify(idx, null, 2));
}

function safeReadHead(file, lines) {
  try {
    return fs.readFileSync(file, 'utf8').split(/\r?\n/).slice(0, lines).join('\n');
  } catch { return ''; }
}

const MAX_WALK_DEPTH = 12;
const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', '.hg', 'bin', 'obj', 'dist', 'build', 'out', '.next', '.cache']);

function walkDocs(root) {
  const out = [];
  const stack = [[root, 0]];
  const seen = new Set();
  while (stack.length) {
    const [cur, depth] = stack.pop();
    if (depth > MAX_WALK_DEPTH) continue;
    let real;
    try { real = fs.realpathSync(cur); } catch { continue; }
    if (seen.has(real)) continue;
    seen.add(real);
    let entries;
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(cur, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (!e.name.startsWith('.') && !SKIP_DIRS.has(e.name)) stack.push([p, depth + 1]);
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
        out.push(p);
      }
    }
  }
  return out;
}
