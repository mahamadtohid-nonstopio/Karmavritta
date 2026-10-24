import fs from 'node:fs';
import path from 'node:path';
import { getTicketsDir, ensureWorklogDir } from './config.mjs';

function lockDir() {
  return path.join(getTicketsDir(), '.lock');
}

async function acquireLock(timeoutMs = 5000) {
  const start = Date.now();
  while (true) {
    try {
      fs.mkdirSync(lockDir());
      return;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (Date.now() - start > timeoutMs) {
        // Stale-lock recovery: if the lock dir is older than 60s, remove it
        try {
          const stat = fs.statSync(lockDir());
          if (Date.now() - stat.mtimeMs > 60_000) {
            fs.rmdirSync(lockDir());
            continue;
          }
        } catch {}
        throw new Error('Could not acquire worklog lock');
      }
      await new Promise((r) => setTimeout(r, 30));
    }
  }
}

function releaseLock() {
  try { fs.rmdirSync(lockDir()); } catch {}
}

export function ticketPath(key) {
  return path.join(getTicketsDir(), `${key}.json`);
}

export function readTicket(key) {
  const p = ticketPath(key);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function listTickets() {
  ensureWorklogDir();
  return fs
    .readdirSync(getTicketsDir())
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

export function newTicket(key) {
  return {
    key,
    title: '',
    type: '',
    status: '',
    jiraUrl: '',
    repos: [],
    branches: [],
    firstActive: null,
    lastActive: null,
    activeDates: [],
    commits: [],
    prs: [],
    docs: [],
    findings: [],
    rca: null,
    notes: ''
  };
}

function writeAtomic(filePath, content) {
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, filePath);
}

export async function upsertTicket(key, mutator) {
  ensureWorklogDir();
  await acquireLock();
  try {
    const existing = readTicket(key) || newTicket(key);
    const next = mutator(existing) || existing;
    writeAtomic(ticketPath(key), JSON.stringify(next, null, 2));
    return next;
  } finally {
    releaseLock();
  }
}

export function touchDate(ticket, dateStr) {
  if (!dateStr) return;
  const d = dateStr.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
  if (!ticket.activeDates.includes(d)) {
    ticket.activeDates.push(d);
    ticket.activeDates.sort();
  }
  if (!ticket.firstActive || d < ticket.firstActive) ticket.firstActive = d;
  if (!ticket.lastActive || d > ticket.lastActive) ticket.lastActive = d;
}

export function mergeCommit(ticket, commit) {
  const dupe = ticket.commits.find(
    (c) => c.sha === commit.sha && c.repo === commit.repo
  );
  if (!dupe) ticket.commits.push(commit);
  if (commit.repo && !ticket.repos.includes(commit.repo)) ticket.repos.push(commit.repo);
  if (commit.branch && !ticket.branches.includes(commit.branch)) ticket.branches.push(commit.branch);
  touchDate(ticket, commit.date);
}

export function mergeDoc(ticket, doc) {
  const existing = ticket.docs.find((d) => d.path === doc.path);
  if (!existing) {
    ticket.docs.push(doc);
  } else {
    if (doc.modified) existing.modified = doc.modified;
    if (doc.title && !existing.title) existing.title = doc.title;
  }
  touchDate(ticket, doc.modified || doc.created);
}

export function mergePR(ticket, pr) {
  const idx = ticket.prs.findIndex((p) => p.id === pr.id);
  if (idx === -1) ticket.prs.push(pr);
  else ticket.prs[idx] = { ...ticket.prs[idx], ...pr };
  if (pr.repo && !ticket.repos.includes(pr.repo)) ticket.repos.push(pr.repo);
  touchDate(ticket, pr.created);
}

export function addFinding(ticket, finding) {
  ticket.findings.push(finding);
  touchDate(ticket, finding.date);
}
