import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, getWorklogDir } from './config.mjs';
import { listTickets, readTicket } from './store.mjs';
import { readDailyNote, readItemNote, readState, runTick } from './agent.mjs';
import { readRawDay } from './capture.mjs';
import { periodDays, activitySheet } from './report.mjs';
import { diagnose } from './doctor.mjs';
import { summary as spendSummary } from './budget.mjs';
import { redact, redactionOptions } from './redact.mjs';
import { getDailyDir } from './paths.mjs';
import { isValidKey } from './keys.mjs';

// The dashboard's request handler and data layer. It never opens a socket:
// safety.serveLocal owns it and calls `createHandler(...)` with plain
// { method, url, host, origin, action } objects, so every route is testable
// without a network and rule 3 holds.
//
// Views are read-only (GET/HEAD). The single exception is POST /api/tick, the
// "Summarise now" button. It runs the same tick as `worklog tick`, which writes
// only to Worklog's own data home, and it is guarded against other websites:
// the Host must be ours, the Origin must be ours, and a custom header is
// required. Browsers will not send that header cross-site without a CORS
// preflight, and this server never answers one.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = path.resolve(HERE, '..', 'dashboard');
const PLUGIN_JSON = path.resolve(HERE, '..', '..', '.claude-plugin', 'plugin.json');

// Exact allowlist: a URL path is looked up here, never joined onto a directory,
// so no request can climb out of STATIC_DIR.
const STATIC = {
  '/':           { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.js':     { file: 'app.js',     type: 'text/javascript; charset=utf-8' },
  '/app.css':    { file: 'app.css',    type: 'text/css; charset=utf-8' },
  '/favicon.svg':{ file: 'favicon.svg', type: 'image/svg+xml' }
};

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
    "connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cache-Control': 'no-store'
};

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function dashboardVersion() {
  try { return JSON.parse(fs.readFileSync(PLUGIN_JSON, 'utf8')).version || 'dev'; } catch { return 'dev'; }
}

function localDay(d) {
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

function allTickets() {
  return listTickets().map((k) => { try { return readTicket(k); } catch { return null; } }).filter(Boolean);
}

function byIds(list, ids) {
  return (ids || []).map((id) => (list || []).find((x) => x.id === id)).filter(Boolean);
}

// --- data ----------------------------------------------------------------------

/** One day's work across items, from the ticket records (the same source as the daily note). */
export function dayItems(day, tickets = allTickets()) {
  const items = [];
  for (const t of tickets) {
    if (t.key === '_unassigned') continue;
    const d = (t.days || []).find((x) => x.day === day);
    if (!d) continue;
    items.push({
      key: t.key,
      title: t.title || '',
      summary: d.used === 'model' ? (d.summary || '') : '',
      used: d.used || 'deterministic',
      stats: d.stats || {},
      findings: byIds(t.findings, d.findingIds),
      decisions: byIds(t.decisions, d.decisionIds),
      rca: t.rca?.date === day ? t.rca : null
    });
  }
  return items.sort((a, b) => (b.stats.events || 0) - (a.stats.events || 0) || a.key.localeCompare(b.key));
}

/** Every day that has a daily note or item activity, oldest first. */
export function activeDays(tickets = allTickets()) {
  const set = new Set();
  for (const t of tickets) for (const d of t.days || []) set.add(d.day);
  try {
    for (const f of fs.readdirSync(getDailyDir())) {
      const m = f.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
      if (m) set.add(m[1]);
    }
  } catch { /* no daily dir yet */ }
  return [...set].sort();
}

export function dayView(day, tickets = allTickets()) {
  const days = activeDays(tickets);
  const prev = [...days].reverse().find((d) => d < day) || null;
  const next = days.find((d) => d > day) || null;
  return { day, prev, next, items: dayItems(day, tickets), note: readDailyNote(day) || null };
}

function ticketRow(t) {
  return {
    key: t.key,
    title: t.title || '',
    status: t.status || '',
    firstActive: t.firstActive || null,
    lastActive: t.lastActive || null,
    days: (t.activeDates || []).length,
    events: (t.days || []).reduce((n, d) => n + (d.stats?.events || 0), 0),
    findings: (t.findings || []).length,
    decisions: (t.decisions || []).length,
    commits: (t.commits || []).length,
    docs: (t.docs || []).length,
    prs: (t.prs || []).length,
    hasRca: !!(t.rca && (t.rca.rootCause || t.rca.fix || t.rca.symptom))
  };
}

export function ticketsList(tickets = allTickets()) {
  return tickets
    .filter((t) => t.key !== '_unassigned')
    .map(ticketRow)
    .sort((a, b) => (b.lastActive || '').localeCompare(a.lastActive || '') || a.key.localeCompare(b.key));
}

/** A full ticket for display. Paths and commands are masked at the configured mode, as the notes are. */
export function ticketView(key, cfg = loadConfig()) {
  const t = readTicket(key);
  if (!t) return null;
  const opts = redactionOptions(cfg);
  const mask = (s) => redact(String(s || ''), opts);
  return {
    ...ticketRow(t),
    repos: t.repos || [],
    branches: t.branches || [],
    link: t.jiraUrl || '',
    notes: t.notes || '',
    rca: t.rca || null,
    findings: [...(t.findings || [])].sort((a, b) => (b.date || '').localeCompare(a.date || '')),
    decisions: [...(t.decisions || [])].sort((a, b) => (b.date || '').localeCompare(a.date || '')),
    timeline: [...(t.days || [])].sort((a, b) => b.day.localeCompare(a.day))
      .map((d) => ({ day: d.day, summary: d.used === 'model' ? (d.summary || '') : '', stats: d.stats || {} })),
    commits: [...(t.commits || [])].sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .map((c) => ({ sha: (c.sha || '').slice(0, 9), date: (c.date || '').slice(0, 10), repo: c.repo || '', message: c.message || '' })),
    prs: (t.prs || []).map((p) => ({ id: p.id, status: p.status || '', title: p.title || '', url: p.url || '' })),
    docs: [...(t.docs || [])].sort((a, b) => (b.modified || '').localeCompare(a.modified || ''))
      .map((d) => ({ path: mask(d.path), title: d.title || '', modified: (d.modified || '').slice(0, 10) })),
    files: [...(t.files || [])].sort((a, b) => (b.count || 0) - (a.count || 0))
      .map((f) => ({ path: mask(f.path), count: f.count || 0, lastSeen: f.lastSeen || null })),
    commands: [...(t.artifacts || [])].sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .map((a) => ({ kind: a.kind || '', date: a.date || '', body: mask(a.body) })),
    note: readItemNote(key) || null
  };
}

// --- search --------------------------------------------------------------------

const TYPE_WEIGHT = { ticket: 6, rca: 5, finding: 4, decision: 4, day: 3, commit: 2, doc: 2, command: 1, file: 1 };
export const SEARCH_TYPES = Object.keys(TYPE_WEIGHT);

function* searchRecords(t, mask) {
  const base = { key: t.key, title: t.title || '' };
  yield { ...base, type: 'ticket', date: t.lastActive || '', text: t.title || t.key };
  for (const f of t.findings || []) yield { ...base, type: 'finding', kind: f.kind || 'finding', date: f.date || '', text: f.text || '' };
  for (const d of t.decisions || []) yield { ...base, type: 'decision', date: d.date || '', text: d.text || '' };
  if (t.rca && (t.rca.symptom || t.rca.rootCause || t.rca.fix)) {
    yield { ...base, type: 'rca', date: t.rca.date || '',
      text: [t.rca.symptom && `Symptom: ${t.rca.symptom}`, t.rca.rootCause && `Cause: ${t.rca.rootCause}`, t.rca.fix && `Fix: ${t.rca.fix}`].filter(Boolean).join(' · ') };
  }
  for (const d of t.days || []) if (d.used === 'model' && d.summary) yield { ...base, type: 'day', date: d.day, text: d.summary };
  for (const c of t.commits || []) yield { ...base, type: 'commit', date: (c.date || '').slice(0, 10), text: c.message || '', ref: (c.sha || '').slice(0, 9) };
  for (const d of t.docs || []) yield { ...base, type: 'doc', date: (d.modified || '').slice(0, 10), text: mask([d.title, d.path].filter(Boolean).join(' — ')) };
  for (const a of t.artifacts || []) yield { ...base, type: 'command', date: a.date || '', text: mask(a.body || '') };
  for (const f of t.files || []) yield { ...base, type: 'file', date: f.lastSeen || '', text: mask(f.path || '') };
}

export function tokenize(q) {
  return String(q || '').toLowerCase().split(/\s+/).map((s) => s.trim()).filter(Boolean).slice(0, 8);
}

function snippet(text, tokens, width = 180) {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= width) return flat;
  const lower = flat.toLowerCase();
  const at = Math.min(...tokens.map((t) => lower.indexOf(t)).filter((i) => i >= 0), flat.length);
  const start = Math.max(0, Math.min(at - 60, flat.length - width));
  return `${start > 0 ? '…' : ''}${flat.slice(start, start + width)}${start + width < flat.length ? '…' : ''}`;
}

/**
 * Every token must appear (in the text, the key or the title). Ranked by type,
 * how often the tokens occur, an exact-phrase bonus, then recency.
 */
export function search(q, { type = '', limit = 50, tickets = allTickets(), cfg = loadConfig() } = {}) {
  const tokens = tokenize(q);
  const empty = { q: String(q || ''), tokens, total: 0, counts: {}, results: [] };
  if (!tokens.length) return empty;
  const opts = redactionOptions(cfg);
  const mask = (s) => redact(s, opts);
  const phrase = tokens.join(' ');
  const types = new Set(String(type || '').split(',').filter((x) => SEARCH_TYPES.includes(x)));

  const hits = [];
  const counts = {};
  for (const t of tickets) {
    if (t.key === '_unassigned') continue;
    for (const r of searchRecords(t, mask)) {
      if (!r.text) continue;
      const lowerText = r.text.toLowerCase();
      const hay = `${lowerText} ${r.key.toLowerCase()} ${r.title.toLowerCase()}`;
      if (!tokens.every((tok) => hay.includes(tok))) continue;
      counts[r.type] = (counts[r.type] || 0) + 1;
      if (types.size && !types.has(r.type)) continue;
      let score = TYPE_WEIGHT[r.type] * 10;
      for (const tok of tokens) score += Math.min(5, lowerText.split(tok).length - 1);
      if (tokens.length > 1 && lowerText.includes(phrase)) score += 8;
      if (tokens.some((tok) => r.key.toLowerCase() === tok)) score += 15;
      hits.push({ ...r, score, snippet: snippet(r.text, tokens) });
    }
  }
  hits.sort((a, b) => b.score - a.score || (b.date || '').localeCompare(a.date || '') || a.key.localeCompare(b.key));
  return { ...empty, total: hits.length, counts, results: hits.slice(0, limit).map(({ score, ...rest }) => rest) };
}

// --- root causes ------------------------------------------------------------------

const hasRca = (r) => !!(r && (r.symptom || r.rootCause || r.fix));

/**
 * Every recorded root cause, newest first. One per ticket (the ticket record
 * holds a single RCA). `q` filters: every word must appear in the key, title,
 * symptom, cause or fix.
 */
export function rcaList(q = '', tickets = allTickets()) {
  const tokens = tokenize(q);
  const all = tickets
    .filter((t) => t.key !== '_unassigned' && hasRca(t.rca))
    .map((t) => ({
      key: t.key,
      title: t.title || '',
      status: t.status || '',
      date: t.rca.date || t.lastActive || null,
      symptom: t.rca.symptom || '',
      rootCause: t.rca.rootCause || '',
      fix: t.rca.fix || '',
      evidence: (t.rca.evidence || []).slice(0, 3)
    }))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.key.localeCompare(b.key));
  const rcas = tokens.length
    ? all.filter((r) => {
      const hay = `${r.key} ${r.title} ${r.symptom} ${r.rootCause} ${r.fix}`.toLowerCase();
      return tokens.every((tok) => hay.includes(tok));
    })
    : all;
  return { q: String(q || ''), tokens, total: all.length, count: rcas.length, rcas };
}

// --- overview, activity, health -----------------------------------------------

/** Items across a set of days, one entry per ticket, newest summary first. */
export function rangeItems(days, tickets = allTickets()) {
  const inRange = new Set(days);
  const out = [];
  for (const t of tickets) {
    if (t.key === '_unassigned') continue;
    const ds = (t.days || []).filter((d) => inRange.has(d.day)).sort((a, b) => b.day.localeCompare(a.day));
    if (!ds.length) continue;
    const stats = { events: 0, sessions: 0, files: 0, failures: 0, tools: {} };
    for (const d of ds) {
      for (const k of ['events', 'sessions', 'files', 'failures']) stats[k] += d.stats?.[k] || 0;
      for (const [tool, n] of Object.entries(d.stats?.tools || {})) stats.tools[tool] = (stats.tools[tool] || 0) + n;
    }
    const model = ds.find((d) => d.used === 'model' && d.summary);
    out.push({
      key: t.key, title: t.title || '', days: ds.map((d) => d.day),
      summary: model ? model.summary : '', used: model ? 'model' : 'deterministic', stats,
      findings: byIds(t.findings, ds.flatMap((d) => d.findingIds || [])),
      decisions: byIds(t.decisions, ds.flatMap((d) => d.decisionIds || [])),
      rca: t.rca?.date && inRange.has(t.rca.date) ? t.rca : null
    });
  }
  return out.sort((a, b) => b.stats.events - a.stats.events || a.key.localeCompare(b.key));
}

/** What the hooks recorded today, and how much of it the tick hasn't summarised yet. */
export function captureToday(today, lastTick) {
  let events = [];
  try { events = readRawDay(today); } catch { /* unreadable raw day: report zero */ }
  const last = events.at(-1)?.ts || null;
  const pending = lastTick ? events.filter((e) => (e.ts || '') > lastTick).length : events.length;
  return { events: events.length, lastEventAt: last, pending };
}

export function overview(today, tickets = allTickets(), { range = 'day' } = {}) {
  const cfg = loadConfig();
  const rows = ticketsList(tickets);
  const week = periodDays(today, 'week');
  const weekAgo = new Date(Date.parse(`${today}T00:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10);
  const state = readState();
  const span = range === 'week' ? week : [today];
  const inSpan = new Set(span);
  return {
    today,
    range: range === 'week' ? 'week' : 'day',
    from: span[0], to: span.at(-1),
    items: range === 'week' ? rangeItems(week, tickets) : dayItems(today, tickets),
    recent: rows.filter((r) => (r.lastActive || '') >= weekAgo).slice(0, 12),
    counts: {
      newTickets: rows.filter((r) => r.firstActive && inSpan.has(r.firstActive)).length,
      findings: tickets.filter((t) => t.key !== '_unassigned')
        .reduce((n, t) => n + (t.findings || []).filter((f) => inSpan.has(f.date)).length, 0)
    },
    capture: captureToday(today, state.lastTick),
    totals: {
      tickets: rows.length,
      findings: rows.reduce((n, r) => n + r.findings, 0),
      days: activeDays(tickets).length
    },
    status: {
      capture: cfg.capture?.paused ? 'paused' : cfg.capture?.enabled === false ? 'off' : 'on',
      lastTick: state.lastTick,
      model: cfg.model?.enabled === false ? 'off' : 'on',
      spend: spendSummary(today),
      budgetUsd: cfg.model?.dailyBudgetUsd ?? null
    }
  };
}

export function activity(period, date, tickets = allTickets()) {
  const days = periodDays(date, period);
  const sheet = activitySheet(tickets, days);
  const first = new Date(`${days[0]}T00:00:00Z`);
  const last = new Date(`${days.at(-1)}T00:00:00Z`);
  const prev = new Date(first); prev.setUTCDate(prev.getUTCDate() - 1);
  const next = new Date(last); next.setUTCDate(next.getUTCDate() + 1);
  return { period, unit: 'events', ...sheet, prev: prev.toISOString().slice(0, 10), next: next.toISOString().slice(0, 10) };
}

const PLATFORM = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };
let healthCache = null;

/**
 * Doctor results, cached for a minute: `diagnose()` starts git, claude and the
 * OS scheduler, which is too slow to repeat for the sidebar badge on every page.
 */
export function health({ fresh = false, maxAgeMs = 60_000 } = {}) {
  if (!fresh && healthCache && Date.now() - healthCache.at < maxAgeMs) return healthCache.value;
  const report = diagnose();
  const claude = report.checks.find((c) => c.name === 'claude cli' && c.status === 'ok');
  const value = {
    ...report,
    spend: spendSummary(),
    version: dashboardVersion(),
    os: `${PLATFORM[process.platform] || process.platform} ${process.arch}`,
    claudeVersion: claude ? (claude.detail.match(/\d+\.\d+\.\d+/) || [null])[0] : null
  };
  healthCache = { at: Date.now(), value };
  return value;
}

/** Small, cheap facts for the sidebar on every page. */
export function meta(port) {
  const cfg = loadConfig();
  const h = health();
  return {
    version: dashboardVersion(),
    dataHome: getWorklogDir(),
    port,
    capture: cfg.capture?.paused ? 'paused' : cfg.capture?.enabled === false ? 'off' : 'on',
    health: h.counts
  };
}

let tickRunning = false;
async function tickNow() {
  if (tickRunning) return { status: 409, value: { error: 'A summary is already running.' } };
  tickRunning = true;
  try {
    const r = await runTick();
    healthCache = null; // "last tick" just changed
    return { status: 200, value: r };
  } finally {
    tickRunning = false;
  }
}

// --- HTTP ----------------------------------------------------------------------

function json(status, value) {
  return { status, headers: { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(value) };
}

function text(status, body) {
  return { status, headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' }, body };
}

/**
 * Build the request handler. `ctx.port` may be filled in after listening;
 * the Host check reads it per request. Rejecting any other Host header stops a
 * hostile web page from reaching this server through DNS rebinding.
 */
export function createHandler(ctx = {}) {
  const now = ctx.now || (() => new Date());
  return async ({ method, url, host, origin = '', action = '' }) => {
    const allowedHosts = new Set([`127.0.0.1:${ctx.port}`, `localhost:${ctx.port}`]);
    if (!allowedHosts.has(String(host || '').toLowerCase())) return text(403, 'Forbidden host');

    let u;
    try { u = new URL(url, 'http://127.0.0.1'); } catch { return text(400, 'Bad request'); }
    const p = u.pathname;

    // The one write: "Summarise now". Same Origin + custom header, or nothing.
    if (method === 'POST' && p === '/api/tick') {
      const allowedOrigins = new Set([`http://127.0.0.1:${ctx.port}`, `http://localhost:${ctx.port}`]);
      if (!allowedOrigins.has(String(origin).toLowerCase()) || action !== 'tick') {
        return json(403, { error: 'Summarise is only accepted from the dashboard page itself.' });
      }
      try {
        const r = await tickNow();
        return json(r.status, r.value);
      } catch (e) {
        return json(500, { error: 'The summary failed. Run `worklog tick` to see why.' });
      }
    }
    if (method !== 'GET' && method !== 'HEAD') {
      const r = text(405, 'Views are read-only');
      r.headers.Allow = 'GET, HEAD';
      return r;
    }

    const asset = STATIC[p];
    if (asset) {
      try {
        return { status: 200, headers: { ...SECURITY_HEADERS, 'Content-Type': asset.type },
          body: fs.readFileSync(path.join(STATIC_DIR, asset.file)) };
      } catch { return text(404, 'Not found'); }
    }

    if (!p.startsWith('/api/')) return text(404, 'Not found');
    const q = (k) => u.searchParams.get(k) || '';
    const today = localDay(now());

    try {
      if (p === '/api/ping') return json(200, { app: 'worklog', version: dashboardVersion(), pid: ctx.pid ?? null, dataHome: getWorklogDir() });
      if (p === '/api/overview') return json(200, overview(today, undefined, { range: q('range') }));
      if (p === '/api/meta') return json(200, meta(ctx.port));
      if (p === '/api/days') return json(200, { today, days: activeDays() });
      if (p === '/api/tickets') return json(200, { tickets: ticketsList() });
      if (p === '/api/rcas') return json(200, rcaList(q('q')));
      if (p === '/api/health') return json(200, health({ fresh: q('fresh') === '1' }));

      if (p === '/api/search') {
        const limit = Math.min(200, Math.max(1, Number(q('limit')) || 50));
        return json(200, search(q('q'), { type: q('type'), limit }));
      }

      if (p === '/api/activity') {
        const period = q('period') === 'month' ? 'month' : 'week';
        const date = q('date') || today;
        if (!DAY_RE.test(date)) return json(400, { error: 'date must be YYYY-MM-DD' });
        try { return json(200, activity(period, date)); } catch (e) { return json(400, { error: e.message }); }
      }

      let m = p.match(/^\/api\/day\/([^/]+)$/);
      if (m) {
        const day = decodeURIComponent(m[1]) === 'today' ? today : decodeURIComponent(m[1]);
        if (!DAY_RE.test(day)) return json(400, { error: 'day must be YYYY-MM-DD' });
        return json(200, dayView(day));
      }

      m = p.match(/^\/api\/ticket\/([^/]+)$/);
      if (m) {
        const key = decodeURIComponent(m[1]).toUpperCase();
        if (!isValidKey(key)) return json(400, { error: 'not a ticket key' });
        const view = ticketView(key);
        return view ? json(200, view) : json(404, { error: `no record for ${key}` });
      }
    } catch (e) {
      return json(500, { error: 'internal error' });
    }
    return json(404, { error: 'unknown endpoint' });
  };
}
