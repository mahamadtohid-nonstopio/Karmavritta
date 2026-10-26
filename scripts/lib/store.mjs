import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as safety from './safety.mjs';
import { getTicketsDir, ensureWorklogDir } from './config.mjs';

function lockDir() {
  return path.join(getTicketsDir(), '.lock');
}

const STALE_LOCK_MS = 15_000;

async function acquireLock(timeoutMs = 5000) {
  const start = Date.now();
  while (true) {
    if (safety.tryMkdirExclusive(lockDir())) return;
    // Opportunistic stale-lock recovery on every retry, not only at timeout.
    try {
      const stat = fs.statSync(lockDir());
      if (Date.now() - stat.mtimeMs > STALE_LOCK_MS) {
        safety.removeDirIfEmpty(lockDir());
        continue;
      }
    } catch {}
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Could not acquire worklog lock at ${lockDir()} (held for > ${timeoutMs}ms). If no other worklog process is running, delete this directory and retry.`);
    }
    await new Promise((r) => setTimeout(r, 30));
  }
}

function releaseLock() {
  safety.removeDirIfEmpty(lockDir());
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
    decisions: [],
    artifacts: [],
    files: [],
    sessions: [],
    days: [],
    rca: null,
    notes: ''
  };
}

/** Older ticket files predate the capture fields; fill them in on read-modify. */
function ensureShape(t) {
  const blank = newTicket(t.key);
  for (const [k, v] of Object.entries(blank)) {
    if (t[k] === undefined) t[k] = Array.isArray(v) ? [] : v;
  }
  return t;
}

export function writeAtomic(filePath, content) {
  return safety.writeFileAtomic(filePath, content);
}

export async function upsertTicket(key, mutator) {
  ensureWorklogDir();
  await acquireLock();
  try {
    const existing = ensureShape(readTicket(key) || newTicket(key));
    const next = mutator(existing) || existing;
    safety.writeFileAtomic(ticketPath(key), JSON.stringify(next, null, 2));
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

/**
 * Content-addressed id. Re-running the tick over the same raw events must
 * produce the same ids, which is what keeps the merge idempotent.
 */
export function stableId(kind, ...parts) {
  const norm = parts
    .map((p) => String(p ?? '').toLowerCase().replace(/\s+/g, ' ').trim())
    .join('');
  return `${kind}_${createHash('sha1').update(norm).digest('hex').slice(0, 12)}`;
}

/** Insert-or-update by `id`, preserving fields the caller did not supply. */
export function mergeById(list, entry) {
  const i = list.findIndex((x) => x.id === entry.id);
  if (i === -1) { list.push(entry); return true; }
  list[i] = { ...list[i], ...entry };
  return false;
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
  const entry = { id: finding.id || stableId('f', finding.kind, finding.text), ...finding };
  mergeById(ticket.findings, entry);
  touchDate(ticket, finding.date);
  return entry;
}

export function addDecision(ticket, decision) {
  const entry = { id: decision.id || stableId('d', decision.text), ...decision };
  mergeById(ticket.decisions, entry);
  touchDate(ticket, decision.date);
  return entry;
}

/** A saved request, query or command worth replaying later. */
export function addArtifact(ticket, artifact) {
  const entry = { id: artifact.id || stableId('a', artifact.kind, artifact.body), ...artifact };
  mergeById(ticket.artifacts, entry);
  touchDate(ticket, artifact.date);
  return entry;
}

/**
 * Counts are stored per day and summed, never incremented. Reprocessing a day
 * must replace that day's contribution rather than add to it, or the tick stops
 * being idempotent.
 */
export function addFileTouch(ticket, file) {
  const id = stableId('p', file.path);
  let entry = ticket.files.find((x) => x.id === id);
  if (!entry) {
    entry = { id, path: file.path, byDay: {}, count: 0, lastSeen: null };
    ticket.files.push(entry);
  }
  if (!entry.byDay) entry.byDay = { [file.date || 'unknown']: entry.count || 0 };
  entry.byDay[file.date || 'unknown'] = file.count || 1;
  entry.count = Object.values(entry.byDay).reduce((n, v) => n + v, 0);
  const days = Object.keys(entry.byDay).sort();
  entry.lastSeen = days.at(-1) || null;
  touchDate(ticket, file.date);
  return entry;
}

/** What this item looked like on one day — the daily note renders from these. */
export function upsertDay(ticket, day, entry) {
  const i = ticket.days.findIndex((d) => d.day === day);
  if (i === -1) ticket.days.push({ day, ...entry });
  else ticket.days[i] = { ...ticket.days[i], ...entry, day };
  ticket.days.sort((a, b) => a.day.localeCompare(b.day));
  touchDate(ticket, day);
}

export function addSession(ticket, session) {
  const entry = { id: session.id || stableId('s', session.sessionId, session.day), ...session };
  mergeById(ticket.sessions, entry);
  touchDate(ticket, session.day);
  return entry;
}
