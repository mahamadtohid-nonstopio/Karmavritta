import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as safety from './safety.mjs';
import {
  loadConfig, ensureDataHome, getWorklogDir, getStatePath, getRawDayDir,
  getDailyNotePath, getItemNotePath, getItemDir, getErrorsLog
} from './config.mjs';
import { readRawDay, listRawDays } from './capture.mjs';
import {
  upsertTicket, readTicket, addFinding, addDecision, addArtifact,
  addFileTouch, addSession, upsertDay
} from './store.mjs';
import { runExtraction, deterministicSummary } from './extract.mjs';
import { renderDaily, renderItem } from './render.mjs';
import { buildIndex } from './index.mjs';

// The tick is the only writer of notes. It is lock-guarded, idempotent and
// never throws out of `runTick` — a scheduled run that fails must fail quietly
// and leave the next one a clean slate.

const STATE_VERSION = 1;
const MIN_EVENTS_FOR_MODEL = 3;

function lockDir() { return path.join(getWorklogDir(), '.tick.lock'); }

const STALE_LOCK_MS = 10 * 60_000; // a tick that outlives this is dead, not slow

function acquireTickLock() {
  if (safety.tryMkdirExclusive(lockDir())) return true;
  try {
    const stat = fs.statSync(lockDir());
    if (Date.now() - stat.mtimeMs > STALE_LOCK_MS) {
      safety.removeDirIfEmpty(lockDir());
      return safety.tryMkdirExclusive(lockDir());
    }
  } catch { /* vanished between the two calls; the next tick will get it */ }
  return false;
}

export function readState() {
  const p = getStatePath();
  if (!fs.existsSync(p)) return { version: STATE_VERSION, lastTick: null, days: {} };
  try {
    const s = JSON.parse(fs.readFileSync(p, 'utf8'));
    return { version: STATE_VERSION, lastTick: s.lastTick || null, days: s.days || {} };
  } catch {
    return { version: STATE_VERSION, lastTick: null, days: {} };
  }
}

function fingerprint(ids) {
  return createHash('sha1').update([...ids].sort().join('|')).digest('hex').slice(0, 16);
}

/**
 * A session establishes a work item once and keeps it. Events that mention no
 * key inherit the session's current one, and the events before the first
 * mention are backfilled, because the key usually appears a few turns in.
 */
export function propagateKeys(events) {
  const bySession = new Map();
  for (const e of events) {
    if (!bySession.has(e.session)) bySession.set(e.session, []);
    bySession.get(e.session).push(e);
  }
  const out = [];
  for (const list of bySession.values()) {
    const sorted = [...list].sort((a, b) => (a.ts || '').localeCompare(b.ts || ''));
    let current = [];
    const filled = sorted.map((e) => {
      if (e.keys?.length) current = e.keys;
      return { ...e, keys: e.keys?.length ? e.keys : [...current] };
    });
    const firstKeyed = filled.find((e) => e.keys.length)?.keys || [];
    for (const e of filled) if (!e.keys.length) e.keys = [...firstKeyed];
    out.push(...filled);
  }
  return out.sort((a, b) => (a.ts || '').localeCompare(b.ts || ''));
}

/**
 * Pre and Post fire for the same call. Prefer Post (it knows whether the call
 * succeeded) and keep a Pre only when no Post ever arrived for it.
 */
export function dedupeToolCalls(events) {
  const post = new Set();
  for (const e of events) {
    if (e.event === 'PostToolUse') post.add(`${e.session}|${e.tool}|${e.summary}`);
  }
  return events.filter((e) => {
    if (e.event !== 'PreToolUse') return true;
    return !post.has(`${e.session}|${e.tool}|${e.summary}`);
  });
}

export function statsFor(events) {
  const tools = {};
  const files = new Set();
  const sessions = new Set();
  let failures = 0;
  for (const e of events) {
    if (e.tool) tools[e.tool] = (tools[e.tool] || 0) + 1;
    if (e.kind === 'file' && e.summary) files.add(e.summary);
    if (e.session) sessions.add(e.session);
    if (e.ok === false) failures += 1;
  }
  return { events: events.length, tools, files: files.size, sessions: sessions.size, failures };
}

function groupByKey(events) {
  const byKey = new Map();
  const unattributed = [];
  for (const e of events) {
    if (!e.keys?.length) { unattributed.push(e); continue; }
    for (const key of e.keys) {
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(e);
    }
  }
  return { byKey, unattributed };
}

/** Everything the model could usefully read: prompts and real tool calls. */
function significant(events) {
  return events.filter((e) => e.event === 'UserPromptSubmit' || e.tool);
}

function mergeActivity(ticket, day, events) {
  const fileCounts = new Map();
  for (const e of events) {
    if (e.branch && !ticket.branches.includes(e.branch)) ticket.branches.push(e.branch);
    if (e.kind === 'file' && e.summary) {
      fileCounts.set(e.summary, (fileCounts.get(e.summary) || 0) + 1);
    }
    if (e.kind === 'artifact' && e.summary) {
      addArtifact(ticket, { kind: e.tool, body: e.summary, date: day });
    }
  }
  for (const [filePath, count] of fileCounts) {
    addFileTouch(ticket, { path: filePath, date: day, count });
  }
  const sessions = new Set(events.map((e) => e.session).filter(Boolean));
  for (const sessionId of sessions) {
    addSession(ticket, { sessionId, day });
  }
}

function mergeExtraction(ticket, day, extraction) {
  const findingIds = [];
  const decisionIds = [];
  if (extraction.title && !ticket.title) ticket.title = extraction.title;
  for (const f of extraction.findings || []) {
    findingIds.push(addFinding(ticket, { ...f, date: day, source: 'tick' }).id);
  }
  for (const d of extraction.decisions || []) {
    decisionIds.push(addDecision(ticket, { ...d, date: day, source: 'tick' }).id);
  }
  if (extraction.rca?.rootCause) ticket.rca = { ...extraction.rca, date: day };
  return { findingIds, decisionIds };
}

async function processKey(key, day, events, cfg, counters) {
  const calls = dedupeToolCalls(events);
  const digestEvents = significant(calls);
  const stats = statsFor(calls);

  let extraction = null;
  let used = 'deterministic';
  if (cfg.model?.enabled && digestEvents.length >= MIN_EVENTS_FOR_MODEL) {
    const r = runExtraction({ key, day, events: digestEvents, cfg, callsThisTick: counters.calls });
    if (r.used === 'model') {
      counters.calls += 1;
      extraction = r.result;
      used = 'model';
      if (r.dropped?.length) counters.dropped += r.dropped.length;
    } else {
      counters.reasons.add(r.reason || r.used);
    }
  }
  if (!extraction) extraction = deterministicSummary(key, day, calls);

  const ticket = await upsertTicket(key, (t) => {
    mergeActivity(t, day, calls);
    const { findingIds, decisionIds } = mergeExtraction(t, day, extraction);
    upsertDay(t, day, { summary: extraction.summary, stats, findingIds, decisionIds, used });
  });
  return { ticket, used };
}

/** Rebuild one day's entry for the note from the ticket, without re-extracting. */
function dailyEntryFor(ticket, day) {
  const entry = (ticket.days || []).find((d) => d.day === day);
  if (!entry) return null;
  const byId = (list, ids) => (ids || [])
    .map((id) => (list || []).find((x) => x.id === id))
    .filter(Boolean);
  return {
    key: ticket.key,
    title: ticket.title || '',
    // The deterministic summary is the activity line in prose; rendering both
    // says the same thing twice, so only a model summary earns a paragraph.
    summary: entry.used === 'model' ? (entry.summary || '') : '',
    findings: byId(ticket.findings, entry.findingIds),
    decisions: byId(ticket.decisions, entry.decisionIds),
    rca: ticket.rca?.date === day ? ticket.rca : null,
    stats: entry.stats
  };
}

function writeIfChanged(file, content) {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) return false;
  safety.writeFileAtomic(file, content);
  return true;
}

function pruneRaw(cfg, state) {
  const keep = cfg.capture?.retainRawDays ?? 30;
  if (!Number.isFinite(keep) || keep <= 0) return 0;
  const days = listRawDays();
  const doomed = days.slice(0, Math.max(0, days.length - keep));
  for (const day of doomed) {
    safety.removePath(getRawDayDir(day), { recursive: true });
    delete state.days[day];
  }
  return doomed.length;
}

function logTickError(err, where) {
  try {
    safety.appendLine(getErrorsLog(), JSON.stringify({
      ts: new Date().toISOString(), where: `tick:${where}`, message: String(err?.message || err)
    }));
  } catch { /* never let logging be the failure */ }
}

/**
 * One pass over everything not yet summarised. Safe to call at any frequency:
 * unchanged days are skipped, and a day that is reprocessed merges by stable
 * id rather than appending.
 */
export async function runTick({ force = false, days: onlyDays = null, now = new Date() } = {}) {
  const started = Date.now();
  const result = {
    ran: false, days: [], items: 0, modelCalls: 0, notesWritten: 0,
    pruned: 0, droppedClaims: 0, skipped: null, reasons: [], ms: 0
  };

  if (!acquireTickLock()) { result.skipped = 'another tick is running'; return result; }

  try {
    ensureDataHome();
    const cfg = loadConfig();
    if (!force && cfg.tick?.enabled === false) { result.skipped = 'tick disabled in config'; return result; }

    const state = readState();
    const counters = { calls: 0, dropped: 0, reasons: new Set() };
    const candidates = onlyDays?.length ? onlyDays : listRawDays();

    for (const day of candidates) {
      const raw = readRawDay(day);
      if (!raw.length) continue;

      const dayPrint = fingerprint(raw.map((e) => e.id));
      const prior = state.days[day] || { keys: {} };
      if (!force && prior.fingerprint === dayPrint) continue;

      const events = propagateKeys(raw);
      const { byKey, unattributed } = groupByKey(events);
      const nextKeys = {};
      const entries = [];

      for (const [key, keyEvents] of [...byKey.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        const keyPrint = fingerprint(keyEvents.map((e) => e.id));
        nextKeys[key] = keyPrint;
        let ticket;
        if (!force && prior.keys?.[key] === keyPrint) {
          ticket = readTicket(key);
        } else {
          ({ ticket } = await processKey(key, day, keyEvents, cfg, counters));
          result.items += 1;
        }
        const entry = ticket && dailyEntryFor(ticket, day);
        if (entry) entries.push(entry);
        if (ticket) {
          if (writeIfChanged(getItemNotePath(key), renderItem(ticket, cfg))) result.notesWritten += 1;
        }
      }

      const unattributedStats = unattributed.length
        ? statsFor(dedupeToolCalls(unattributed))
        : null;
      const note = renderDaily(day, entries, { unattributed: unattributedStats });
      if (writeIfChanged(getDailyNotePath(day), note)) result.notesWritten += 1;

      state.days[day] = { fingerprint: dayPrint, keys: nextKeys };
      result.days.push(day);
    }

    result.pruned = pruneRaw(cfg, state);
    result.modelCalls = counters.calls;
    result.droppedClaims = counters.dropped;
    result.reasons = [...counters.reasons];
    result.ran = true;

    if (result.days.length) buildIndex();

    state.lastTick = now.toISOString();
    safety.writeJsonAtomic(getStatePath(), state);
  } catch (err) {
    logTickError(err, 'run');
    result.error = String(err?.message || err);
  } finally {
    safety.removeDirIfEmpty(lockDir());
    result.ms = Date.now() - started;
  }
  return result;
}

/** Read a rendered note back, for `worklog today` / `worklog item <KEY>`. */
export function readDailyNote(day) {
  const p = getDailyNotePath(day);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

export function readItemNote(key) {
  const p = getItemNotePath(key);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

export function itemDir(key) { return getItemDir(key); }
